import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { aiAgents, aiModelDefaults, aiProviderConnections, aiTaskEvents, aiTaskReportCitations, aiTaskResearchRuns, aiTaskResearchSources, aiTasks, db, departmentTaskSteps } from "@workspace/db/node";
import type { RequestContext } from "../auth/request-context.js";
import { JobsService } from "../jobs/jobs.service.js";
import type { CreateTaskDto } from "./tasks.dto.js";
import { isDepartmentWorkflowWaitingToken, isReleasedDepartmentStep } from "../departments/department-workflow-state.js";
import { MAX_TASK_EXECUTIONS } from "./task-execution-state.js";

const QUEUE_CLAIM_TIMEOUT_MS = 120_000;

@Injectable()
export class TasksService {
  constructor(private readonly jobs: JobsService) {}

  private queueLeaseExpiresAt() { return new Date(Date.now() + QUEUE_CLAIM_TIMEOUT_MS); }
  private async event(taskId: string, organizationId: string, type: string, message: string) {
    await db.insert(aiTaskEvents).values({ id: randomUUID(), taskId, organizationId, type, message });
  }

  async create(ctx: RequestContext, dto: CreateTaskDto, options: { enqueue?: boolean; webResearchEnabled?: boolean; researchProvider?: string; runtime?: { connectionId: string; modelId: string }; deferredExecutionToken?: string } = {}) {
    const title = dto.title.trim(), description = dto.description.trim();
    if (!title || !description) throw new BadRequestException("Task title and description are required");
    // New Agent tasks let the configured model decide at execution time whether
    // current public evidence is needed. General-model tasks retain UC-00 behavior.
    const webResearchEnabled = options.webResearchEnabled ?? Boolean(dto.agentId);
    let connectionId: string, modelId: string;
    let agentSnapshot: Pick<typeof aiTasks.$inferInsert, "agentId" | "agentName" | "agentRole" | "agentSystemPrompt" | "agentConnectionId" | "agentModelId"> = {};
    if (options.runtime) {
      const [connection] = await db.select({ id: aiProviderConnections.id }).from(aiProviderConnections).where(and(eq(aiProviderConnections.organizationId, ctx.organizationId), eq(aiProviderConnections.id, options.runtime.connectionId), eq(aiProviderConnections.enabled, true))).limit(1);
      if (!connection) throw new BadRequestException("Reviewer AI provider connection is unavailable");
      connectionId = options.runtime.connectionId;
      modelId = options.runtime.modelId;
    } else if (dto.agentId) {
      const [agent] = await db.select().from(aiAgents).where(and(eq(aiAgents.id, dto.agentId), eq(aiAgents.organizationId, ctx.organizationId))).limit(1);
      if (!agent) throw new BadRequestException("Selected AI agent does not belong to this organization");
      if (agent.status !== "active") throw new BadRequestException("Selected AI agent is not active");
      if (!agent.connectionId || !agent.modelId) throw new BadRequestException("Selected AI agent must have its own provider connection and model");
      const [connection] = await db.select({ id: aiProviderConnections.id }).from(aiProviderConnections).where(and(eq(aiProviderConnections.organizationId, ctx.organizationId), eq(aiProviderConnections.id, agent.connectionId), eq(aiProviderConnections.enabled, true))).limit(1);
      if (!connection) throw new BadRequestException("Selected AI agent provider connection is unavailable");
      connectionId = agent.connectionId;
      modelId = agent.modelId;
      agentSnapshot = { agentId: agent.id, agentName: agent.name, agentRole: agent.role, agentSystemPrompt: agent.systemPrompt, agentConnectionId: agent.connectionId, agentModelId: agent.modelId };
    } else {
      const [model] = await db.select().from(aiModelDefaults).where(and(eq(aiModelDefaults.organizationId, ctx.organizationId), eq(aiModelDefaults.purpose, "general"))).limit(1);
      if (!model) throw new BadRequestException("Configure a General AI model before creating a task");
      const [connection] = await db.select().from(aiProviderConnections).where(and(eq(aiProviderConnections.organizationId, ctx.organizationId), eq(aiProviderConnections.id, model.connectionId), eq(aiProviderConnections.enabled, true))).limit(1);
      if (!connection) throw new BadRequestException("Configured AI provider connection is unavailable");
      connectionId = connection.id;
      modelId = model.modelId;
    }
    const id = randomUUID();
    const [task] = await db.insert(aiTasks).values({ id, organizationId: ctx.organizationId, createdBy: ctx.userId, title, description, connectionId, modelId, ...agentSnapshot, webResearchEnabled, researchProvider: webResearchEnabled ? options.researchProvider ?? "hybrid" : null, researchPolicyVersion: webResearchEnabled ? "v2" : null, executionToken: options.deferredExecutionToken ?? null, leaseExpiresAt: options.deferredExecutionToken ? null : this.queueLeaseExpiresAt() }).returning();
    await this.event(id, ctx.organizationId, "queued", webResearchEnabled ? `Task đang chờ Worker xử lý bởi Agent ${agentSnapshot.agentName}; Agent sẽ tự quyết định có cần Web Research.` : "Task đang chờ Worker xử lý.");
    if (options.enqueue !== false) await this.enqueue(task);
    return task;
  }

  /** Enqueue only after a caller has persisted its own record that references this task. */
  async enqueue(task: Pick<typeof aiTasks.$inferSelect, "id" | "organizationId">) {
    try { await this.jobs.enqueueAiTask({ taskId: task.id, organizationId: task.organizationId }); }
    catch (error) {
      await db.update(aiTasks).set({ status: "failed", error: "Không thể đưa task vào hàng đợi xử lý.", completedAt: new Date(), updatedAt: new Date() }).where(and(eq(aiTasks.id, task.id), eq(aiTasks.organizationId, task.organizationId)));
      await this.event(task.id, task.organizationId, "failed", "Không thể đưa task vào hàng đợi xử lý.");
      throw error;
    }
  }

  /** Explicit user resume; keep the original task, evidence, events and usage. */
  async resumeResearch(ctx: RequestContext, taskId: string, refreshAgentConfiguration = false) {
    const task = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(aiTasks).where(and(eq(aiTasks.id, taskId), eq(aiTasks.organizationId, ctx.organizationId))).for("update");
      if (!current) throw new NotFoundException("Không tìm thấy nhiệm vụ nghiên cứu.");
      if (current.status !== "failed") throw new ConflictException("Nghiên cứu đang xử lý hoặc chưa thất bại; không thể thử lại đồng thời.");
      if (current.attemptCount >= MAX_TASK_EXECUTIONS) throw new BadRequestException("Đã đạt giới hạn 4 lần thực thi. Hãy kiểm tra cấu hình và tạo nghiên cứu mới.");
      let snapshot: Partial<typeof aiTasks.$inferInsert> = {};
      if (refreshAgentConfiguration) {
        const [agent] = await tx.select().from(aiAgents).where(and(eq(aiAgents.id, current.agentId ?? ""), eq(aiAgents.organizationId, ctx.organizationId)));
        if (!agent || agent.status !== "active" || !agent.connectionId || !agent.modelId) throw new BadRequestException("Nhân viên phải đang hoạt động và có cấu hình AI hợp lệ.");
        const [connection] = await tx.select().from(aiProviderConnections).where(and(eq(aiProviderConnections.id, agent.connectionId), eq(aiProviderConnections.organizationId, ctx.organizationId), eq(aiProviderConnections.enabled, true)));
        if (!connection) throw new BadRequestException("Kết nối AI của nhân viên không khả dụng.");
        snapshot = { connectionId: agent.connectionId, modelId: agent.modelId, agentConnectionId: agent.connectionId, agentModelId: agent.modelId, agentName: agent.name, agentRole: agent.role, agentSystemPrompt: agent.systemPrompt };
      }
      const [resumed] = await tx.update(aiTasks).set({ ...snapshot, status: "queued", error: null, completedAt: null, executionToken: null, leaseExpiresAt: this.queueLeaseExpiresAt(), updatedAt: new Date() }).where(and(eq(aiTasks.id, taskId), eq(aiTasks.organizationId, ctx.organizationId), eq(aiTasks.status, "failed"))).returning();
      await tx.insert(aiTaskEvents).values({ id: randomUUID(), taskId, organizationId: ctx.organizationId, type: "research_resumed", message: refreshAgentConfiguration ? "Người dùng yêu cầu tiếp tục với cấu hình Agent hiện tại. Giữ dữ liệu nguồn; kết quả phân tích cũ sẽ được kiểm tra lại theo cấu hình mới." : "Người dùng yêu cầu tiếp tục từ checkpoint hợp lệ. Giữ lịch sử lỗi và dữ liệu nguồn." });
      return resumed!;
    });
    try { await this.jobs.enqueueAiTask({ taskId, organizationId: ctx.organizationId, recovery: true }); }
    catch (error) {
      await db.update(aiTasks).set({ status: "failed", error: "Không thể enqueue lượt tiếp tục. Dữ liệu checkpoint vẫn được giữ.", leaseExpiresAt: null, completedAt: new Date() }).where(and(eq(aiTasks.id, taskId), eq(aiTasks.organizationId, ctx.organizationId), eq(aiTasks.status, "queued"), isNull(aiTasks.executionToken)));
      throw error;
    }
    return task;
  }

  /** A task that was deliberately created without enqueueing can be safely discarded. */
  async discardUnqueued(task: Pick<typeof aiTasks.$inferSelect, "id" | "organizationId">) {
    await db.delete(aiTasks).where(and(eq(aiTasks.id, task.id), eq(aiTasks.organizationId, task.organizationId), eq(aiTasks.status, "queued")));
  }

  /** Recover only expired leases; a live Worker renews its lease while generating. */
  private async canRecoverTask(task: { id: string; organizationId: string; executionToken: string | null; description: string }) {
    if (isDepartmentWorkflowWaitingToken(task.executionToken)) return false;
    const [step] = await db.select({ runId: departmentTaskSteps.runId, sequence: departmentTaskSteps.sequence }).from(departmentTaskSteps).where(and(eq(departmentTaskSteps.organizationId, task.organizationId), eq(departmentTaskSteps.taskId, task.id))).limit(1);
    if (!step || step.sequence === 1) return true;
    const [previous] = await db.select({ status: departmentTaskSteps.status }).from(departmentTaskSteps).where(and(eq(departmentTaskSteps.organizationId, task.organizationId), eq(departmentTaskSteps.runId, step.runId), eq(departmentTaskSteps.sequence, step.sequence - 1))).limit(1);
    return isReleasedDepartmentStep({ sequence: step.sequence, description: task.description, previousStepStatus: previous?.status });
  }

  async recoverExpiredTasks(organizationId: string) {
    const now = new Date(), nextQueueLease = this.queueLeaseExpiresAt();
    const candidates = await db.select({ id: aiTasks.id, organizationId: aiTasks.organizationId, status: aiTasks.status, executionToken: aiTasks.executionToken, description: aiTasks.description }).from(aiTasks).where(and(eq(aiTasks.organizationId, organizationId), or(eq(aiTasks.status, "running"), eq(aiTasks.status, "queued")), or(isNull(aiTasks.leaseExpiresAt), lt(aiTasks.leaseExpiresAt, now))));
    for (const candidate of candidates) {
      // Later Department steps are intentionally queued but not runnable. They
      // must never be mistaken for abandoned work by dashboard polling.
      if (!await this.canRecoverTask(candidate)) continue;
      const recovered = candidate.status === "running"
        ? await db.update(aiTasks).set({ status: "queued", executionToken: null, leaseExpiresAt: nextQueueLease, updatedAt: now }).where(and(eq(aiTasks.id, candidate.id), eq(aiTasks.organizationId, organizationId), eq(aiTasks.status, "running"), or(isNull(aiTasks.leaseExpiresAt), lt(aiTasks.leaseExpiresAt, now)))).returning({ id: aiTasks.id })
        : await db.update(aiTasks).set({ leaseExpiresAt: nextQueueLease, updatedAt: now }).where(and(eq(aiTasks.id, candidate.id), eq(aiTasks.organizationId, organizationId), eq(aiTasks.status, "queued"), isNull(aiTasks.executionToken), or(isNull(aiTasks.leaseExpiresAt), lt(aiTasks.leaseExpiresAt, now)))).returning({ id: aiTasks.id });
      if (!recovered.length) continue;
      const wasRunning = candidate.status === "running";
      const task = recovered[0]!;
      await this.event(task.id, organizationId, "recovered", wasRunning ? "Lease của Worker đã hết hạn; task được đưa lại vào hàng đợi." : "Task chưa được Worker claim đúng hạn; đã enqueue lại.");
      try { await this.jobs.enqueueAiTask({ taskId: task.id, organizationId, recovery: true }); }
      catch { await this.event(task.id, organizationId, "recovery_queue_error", "Không thể enqueue recovery; hệ thống sẽ thử lại sau khi lease hết hạn."); }
    }
  }

  async list(ctx: RequestContext, status?: string, agentId?: string) {
    await this.recoverExpiredTasks(ctx.organizationId);
    return db.select().from(aiTasks).where(and(eq(aiTasks.organizationId, ctx.organizationId), ...(status ? [eq(aiTasks.status, status as typeof aiTasks.status.enumValues[number])] : []), ...(agentId ? [eq(aiTasks.agentId, agentId)] : []))).orderBy(desc(aiTasks.updatedAt)).limit(100);
  }

  async get(ctx: RequestContext, id: string) {
    await this.recoverExpiredTasks(ctx.organizationId);
    const [task] = await db.select().from(aiTasks).where(and(eq(aiTasks.organizationId, ctx.organizationId), eq(aiTasks.id, id))).limit(1);
    if (!task) throw new NotFoundException("Task not found");
    const [events, researchRuns, researchSources] = await Promise.all([
      db.select().from(aiTaskEvents).where(and(eq(aiTaskEvents.organizationId, ctx.organizationId), eq(aiTaskEvents.taskId, id))).orderBy(aiTaskEvents.createdAt),
      db.select().from(aiTaskResearchRuns).where(and(eq(aiTaskResearchRuns.organizationId, ctx.organizationId), eq(aiTaskResearchRuns.taskId, id))).orderBy(desc(aiTaskResearchRuns.createdAt)),
      db.select({ id: aiTaskResearchSources.id, ordinal: aiTaskResearchSources.ordinal, title: aiTaskResearchSources.title, canonicalUrl: aiTaskResearchSources.canonicalUrl, displayUrl: aiTaskResearchSources.displayUrl, domain: aiTaskResearchSources.domain, excerpt: aiTaskResearchSources.excerpt, status: aiTaskResearchSources.status, retrievedAt: aiTaskResearchSources.retrievedAt, citationNumber: aiTaskReportCitations.citationNumber }).from(aiTaskResearchSources).leftJoin(aiTaskReportCitations, and(eq(aiTaskReportCitations.sourceId, aiTaskResearchSources.id), eq(aiTaskReportCitations.taskId, aiTaskResearchSources.taskId), eq(aiTaskReportCitations.organizationId, aiTaskResearchSources.organizationId))).where(and(eq(aiTaskResearchSources.organizationId, ctx.organizationId), eq(aiTaskResearchSources.taskId, id))).orderBy(aiTaskResearchSources.ordinal),
    ]);
    return { ...task, events, researchRuns, researchSources };
  }

  async cancel(ctx: RequestContext, id: string) {
    const [cancelled] = await db.update(aiTasks).set({ status: "cancelled", executionToken: null, leaseExpiresAt: null, updatedAt: new Date(), completedAt: new Date() }).where(and(eq(aiTasks.organizationId, ctx.organizationId), eq(aiTasks.id, id), or(eq(aiTasks.status, "queued"), eq(aiTasks.status, "running")))).returning({ id: aiTasks.id });
    if (!cancelled) {
      const [task] = await db.select({ id: aiTasks.id }).from(aiTasks).where(and(eq(aiTasks.organizationId, ctx.organizationId), eq(aiTasks.id, id))).limit(1);
      if (!task) throw new NotFoundException("Task not found");
      throw new BadRequestException("Task cannot be cancelled");
    }
    await this.event(id, ctx.organizationId, "cancelled", "Task cancelled by user");
    return { cancelled: true };
  }
}
