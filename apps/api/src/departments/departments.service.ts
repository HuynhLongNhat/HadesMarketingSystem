
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, departments, aiAgents, aiTaskEvents, aiTasks, departmentTaskRuns, departmentTaskSteps } from "@workspace/db/node";

import type { RequestContext } from "../auth/request-context.js";
import {
  CreateDepartmentDto,
  UpdateDepartmentDto,
  CreateDepartmentTaskRunDto,
} from "./departments.dto.js";
import { TasksService } from "../tasks/tasks.service.js";
import { departmentWorkflowWaitingToken, isReleasedDepartmentStep } from "./department-workflow-state.js";

@Injectable()
export class DepartmentsService {
  constructor(private readonly tasks: TasksService) {}
  private normalizeName(name: string): string {
    const value = name.trim();

    if (!value) {
      throw new BadRequestException("Department name cannot be empty");
    }

    return value;
  }

  private normalizeSlug(slug: string): string {
    const value = slug.trim();

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
      throw new BadRequestException("Invalid department slug");
    }

    return value;
  }

  private async ensureSlugAvailable(
    organizationId: string,
    slug: string,
    excludeId?: string,
  ): Promise<void> {
    const [existing] = await db
      .select({ id: departments.id })
      .from(departments)
      .where(
        and(
          eq(departments.organizationId, organizationId),
          eq(departments.slug, slug),
        ),
      )
      .limit(1);

    if (existing && existing.id !== excludeId) {
      throw new ConflictException(
        "Department slug already exists in this organization",
      );
    }
  }

  list(context: RequestContext) {
    return db
      .select()
      .from(departments)
      .where(eq(departments.organizationId, context.organizationId))
      .orderBy(desc(departments.createdAt))
      .limit(100);
  }

  async getById(context: RequestContext, id: string) {
    const [department] = await db
      .select()
      .from(departments)
      .where(
        and(
          eq(departments.organizationId, context.organizationId),
          eq(departments.id, id),
        ),
      )
      .limit(1);

    if (!department) {
      throw new NotFoundException("Department not found");
    }

    return department;
  }

  async create(context: RequestContext, dto: CreateDepartmentDto) {
    const name = this.normalizeName(dto.name);
    const slug = this.normalizeSlug(dto.slug);

    await this.ensureSlugAvailable(context.organizationId, slug);

    try {
      const [department] = await db
        .insert(departments)
        .values({
          id: randomUUID(),
          organizationId: context.organizationId,
          name,
          slug,
          description: dto.description?.trim() || null,
        })
        .returning();

      return department;
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException("Department slug already exists");
      }

      throw error;
    }
  }

  async update(
    context: RequestContext,
    id: string,
    dto: UpdateDepartmentDto,
  ) {
    await this.getById(context, id);

    const changes: {
      name?: string;
      slug?: string;
      description?: string | null;
      leadAgentId?: string | null;
      updatedAt: Date;
    } = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) {
      changes.name = this.normalizeName(dto.name);
    }

    if (dto.slug !== undefined) {
      changes.slug = this.normalizeSlug(dto.slug);

      await this.ensureSlugAvailable(
        context.organizationId,
        changes.slug,
        id,
      );
    }

    if (dto.description !== undefined) {
      changes.description = dto.description.trim() || null;
    }

    if (dto.leadAgentId !== undefined) {
      if (dto.leadAgentId === null) changes.leadAgentId = null;
      else {
        const [agent] = await db.select({ id: aiAgents.id }).from(aiAgents).where(and(eq(aiAgents.id, dto.leadAgentId), eq(aiAgents.organizationId, context.organizationId), eq(aiAgents.departmentId, id), eq(aiAgents.status, "active"))).limit(1);
        if (!agent) throw new BadRequestException("Trưởng phòng phải là nhân viên đang hoạt động thuộc chính phòng ban này");
        changes.leadAgentId = agent.id;
      }
    }

    try {
      const [department] = await db
        .update(departments)
        .set(changes)
        .where(
          and(
            eq(departments.organizationId, context.organizationId),
            eq(departments.id, id),
          ),
        )
        .returning();

      if (!department) {
        throw new NotFoundException("Department not found");
      }

      return department;
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException("Department slug already exists");
      }

      throw error;
    }
  }

  async remove(context: RequestContext, id: string) {
    await this.getById(context, id);

    const [assignedAgent] = await db
      .select({ id: aiAgents.id })
      .from(aiAgents)
      .where(
        and(
          eq(aiAgents.organizationId, context.organizationId),
          eq(aiAgents.departmentId, id),
        ),
      )
      .limit(1);

    if (assignedAgent) {
      throw new ConflictException(
        "Cannot delete a department with assigned AI agents",
      );
    }

    try {
      const [deleted] = await db
        .delete(departments)
        .where(
          and(
            eq(departments.organizationId, context.organizationId),
            eq(departments.id, id),
          ),
        )
        .returning({ id: departments.id });

      if (!deleted) {
        throw new NotFoundException("Department not found");
      }

      return { success: true, id: deleted.id };
    } catch (error) {
      if (this.isForeignKeyViolation(error)) {
        throw new ConflictException(
          "Cannot delete a department with assigned AI agents",
        );
      }

      throw error;
    }
  }

  async detail(context: RequestContext, id: string) {
    const department = await this.getById(context, id);
    const [members, runs] = await Promise.all([
      db.select().from(aiAgents).where(and(eq(aiAgents.organizationId, context.organizationId), eq(aiAgents.departmentId, id))),
      db.select().from(departmentTaskRuns).where(and(eq(departmentTaskRuns.organizationId, context.organizationId), eq(departmentTaskRuns.departmentId, id))).orderBy(desc(departmentTaskRuns.updatedAt)).limit(50),
    ]);
    return { ...department, members, runs };
  }

  async getRun(context: RequestContext, departmentId: string, runId: string) {
    await this.getById(context, departmentId);
    // This recovers only an expired *released* task. Held later steps are
    // excluded by TasksService and are never auto-enqueued from a page view.
    await this.tasks.recoverExpiredTasks(context.organizationId);
    const [run] = await db.select().from(departmentTaskRuns).where(and(eq(departmentTaskRuns.id, runId), eq(departmentTaskRuns.departmentId, departmentId), eq(departmentTaskRuns.organizationId, context.organizationId))).limit(1);
    if (!run) throw new NotFoundException("Không tìm thấy lượt thực thi phòng ban.");
    let rows = await db.select({ step: departmentTaskSteps, task: aiTasks }).from(departmentTaskSteps).innerJoin(aiTasks, and(eq(aiTasks.id, departmentTaskSteps.taskId), eq(aiTasks.organizationId, departmentTaskSteps.organizationId))).where(and(eq(departmentTaskSteps.runId, runId), eq(departmentTaskSteps.organizationId, context.organizationId))).orderBy(departmentTaskSteps.sequence);
    // Recovery for a Worker process that completed/persisted a Task but died
    // before its finally block advanced the Department workflow.
    for (const row of rows) if (["completed", "failed", "cancelled"].includes(row.task.status) && !["completed", "failed", "cancelled"].includes(row.step.status)) await this.advanceTask(context.organizationId, row.task.id);
    rows = await db.select({ step: departmentTaskSteps, task: aiTasks }).from(departmentTaskSteps).innerJoin(aiTasks, and(eq(aiTasks.id, departmentTaskSteps.taskId), eq(aiTasks.organizationId, departmentTaskSteps.organizationId))).where(and(eq(departmentTaskSteps.runId, runId), eq(departmentTaskSteps.organizationId, context.organizationId))).orderBy(departmentTaskSteps.sequence);
    const taskIds = rows.map(({ task }) => task.id);
    const events = taskIds.length ? await db.select({ taskId: aiTaskEvents.taskId, type: aiTaskEvents.type, message: aiTaskEvents.message, createdAt: aiTaskEvents.createdAt }).from(aiTaskEvents).where(and(eq(aiTaskEvents.organizationId, context.organizationId), inArray(aiTaskEvents.taskId, taskIds))).orderBy(desc(aiTaskEvents.createdAt)) : [];
    const latestEvent = new Map<string, typeof events[number]>();
    for (const event of events) if (!latestEvent.has(event.taskId)) latestEvent.set(event.taskId, event);
    const steps = rows.map(({ step, task }) => ({ ...step, status: task.status, startedAt: task.startedAt, taskCompletedAt: task.completedAt, updatedAt: task.updatedAt, attemptCount: task.attemptCount, leaseExpiresAt: task.leaseExpiresAt, lastEvent: latestEvent.get(task.id) ?? null, output: step.output ?? task.result, error: step.error ?? task.error }));
    const final = steps.at(-1);
    return { ...run, steps, finalReport: run.status === "completed" ? final?.output ?? null : null };
  }

  async markTaskRunning(organizationId: string, taskId: string) {
    const [step] = await db.select({ id: departmentTaskSteps.id, runId: departmentTaskSteps.runId }).from(departmentTaskSteps).where(and(eq(departmentTaskSteps.organizationId, organizationId), eq(departmentTaskSteps.taskId, taskId))).limit(1);
    if (!step) return;
    await db.transaction(async (tx) => {
      await tx.update(departmentTaskSteps).set({ status: "running", updatedAt: new Date() }).where(and(eq(departmentTaskSteps.id, step.id), eq(departmentTaskSteps.status, "queued")));
      await tx.update(departmentTaskRuns).set({ status: "running", updatedAt: new Date() }).where(and(eq(departmentTaskRuns.id, step.runId), eq(departmentTaskRuns.organizationId, organizationId), eq(departmentTaskRuns.status, "queued")));
    });
  }

  /** Deterministic Market Intelligence assignments; never infer a role from list order. */
  private pickWorkflow(department: typeof departments.$inferSelect, agents: Array<typeof aiAgents.$inferSelect>) {
    const active = agents.filter((agent) => agent.status === "active" && agent.connectionId && agent.modelId);
    const lead = active.find((agent) => agent.id === department.leadAgentId);
    if (!lead) throw new BadRequestException("Phòng ban chưa có Trưởng phòng đang hoạt động với cấu hình AI.");
    if (department.slug !== "market-intelligence") return [{ agent: lead, role: "Trưởng phòng", webResearch: false }];
    const role = (agent: typeof aiAgents.$inferSelect) => `${agent.role} ${agent.name}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const research = active.find((agent) => /research|nghien cuu|market analyst/.test(role(agent)) && agent.toolConfig.enabledTools.includes("web_research"));
    if (!research) throw new BadRequestException("Phòng Market Intelligence cần một Research Agent đang hoạt động, có vai trò Nghiên cứu và công cụ web_research.");
    const insights = active.find((agent) => /customer insights|insights|phan tich khach hang|customer analyst/.test(role(agent)));
    if (!insights) throw new BadRequestException("Phòng Market Intelligence cần một Customer Insights Agent đang hoạt động với vai trò phân tích khách hàng.");
    return [{ agent: lead, role: "Intelligence Manager", webResearch: false }, { agent: research, role: "Research Agent", webResearch: true }, { agent: insights, role: "Customer Insights Agent", webResearch: false }, { agent: lead, role: "Intelligence Manager", webResearch: false }];
  }

  async createRun(context: RequestContext, id: string, dto: CreateDepartmentTaskRunDto) {
    const department = await this.getById(context, id);
    const members = await db.select().from(aiAgents).where(and(eq(aiAgents.organizationId, context.organizationId), eq(aiAgents.departmentId, id)));
    const workflow = this.pickWorkflow(department, members);
    const runId = randomUUID(); const title = dto.title.trim(); const input = dto.input.trim();
    if (!title || !input) throw new BadRequestException("Tiêu đề và yêu cầu là bắt buộc.");
    const prepared: Array<{ task: typeof aiTasks.$inferSelect; agent: typeof aiAgents.$inferSelect; role: string; webResearch: boolean }> = [];
    try {
      for (let index = 0; index < workflow.length; index++) {
        const step = workflow[index]!;
        const prior = index ? `\n\nKết quả bước trước sẽ được chuyển tự động sau khi hoàn tất.` : "";
        const task = await this.tasks.create(context, { title: `[${department.name}] ${title} · Bước ${index + 1}`, description: `${input}${prior}\n\nVai trò trong workflow phòng ban: ${step.role}. Hoàn thành đúng phần việc của bạn, không tự giao bước khác.`, agentId: step.agent.id }, { enqueue: false, webResearchEnabled: step.webResearch, deferredExecutionToken: index ? departmentWorkflowWaitingToken(runId, index + 1) : undefined });
        prepared.push({ task, ...step });
      }
      const [run] = await db.insert(departmentTaskRuns).values({ id: runId, organizationId: context.organizationId, departmentId: id, createdBy: context.userId, title, input, status: "queued" }).returning();
      await db.insert(departmentTaskSteps).values(prepared.map((step, sequence) => ({ id: randomUUID(), organizationId: context.organizationId, runId, sequence: sequence + 1, taskId: step.task.id, agentId: step.agent.id, agentName: step.agent.name, role: step.role, input })));
      await this.tasks.enqueue(prepared[0]!.task);
      return run;
    } catch (error) { await Promise.all(prepared.map(({ task }) => this.tasks.discardUnqueued(task))); throw error; }
  }

  /** Called by JobsProcessor only after a terminal AI Task execution. */
  async advanceTask(organizationId: string, taskId: string) {
    const [step] = await db.select().from(departmentTaskSteps).where(and(eq(departmentTaskSteps.organizationId, organizationId), eq(departmentTaskSteps.taskId, taskId))).limit(1);
    if (!step) return;
    const [task] = await db.select().from(aiTasks).where(and(eq(aiTasks.id, taskId), eq(aiTasks.organizationId, organizationId))).limit(1);
    if (!task) return;
    const terminal = task.status === "completed" ? "completed" : task.status === "cancelled" ? "cancelled" : task.status === "failed" ? "failed" : null;
    if (!terminal) return;
    const [changed] = await db.update(departmentTaskSteps).set({ status: terminal, output: task.result, error: task.error, completedAt: new Date(), updatedAt: new Date() }).where(and(eq(departmentTaskSteps.id, step.id), inArray(departmentTaskSteps.status, ["queued", "running"]))).returning({ id: departmentTaskSteps.id });
    if (!changed) return;
    if (terminal !== "completed") { await db.update(departmentTaskRuns).set({ status: terminal, completedAt: new Date(), updatedAt: new Date() }).where(and(eq(departmentTaskRuns.id, step.runId), eq(departmentTaskRuns.organizationId, organizationId))); return; }
    const [next] = await db.select().from(departmentTaskSteps).where(and(eq(departmentTaskSteps.runId, step.runId), eq(departmentTaskSteps.organizationId, organizationId), eq(departmentTaskSteps.sequence, step.sequence + 1))).limit(1);
    if (!next) { await db.update(departmentTaskRuns).set({ status: "completed", completedAt: new Date(), updatedAt: new Date() }).where(and(eq(departmentTaskRuns.id, step.runId), eq(departmentTaskRuns.organizationId, organizationId))); return; }
    // Pass only the persisted previous output to the next Agent. This is real
    // orchestration state, not an instruction pretending another Agent ran.
    const [nextTask] = await db.select({ description: aiTasks.description }).from(aiTasks).where(and(eq(aiTasks.id, next.taskId), eq(aiTasks.organizationId, organizationId))).limit(1);
    if (!nextTask) return;
    const releasedDescription = `${nextTask.description}\n\n--- OUTPUT BƯỚC ${step.sequence} (${step.role}) ---\n${task.result ?? "Không có output."}\n--- END OUTPUT ---`;
    // The conditional release is the sequential-workflow gate. A stale job
    // for a future step cannot claim it while it holds the waiting token.
    const [released] = await db.update(aiTasks).set({ description: releasedDescription, executionToken: null, leaseExpiresAt: new Date(Date.now() + 120_000), updatedAt: new Date() }).where(and(eq(aiTasks.id, next.taskId), eq(aiTasks.organizationId, organizationId), eq(aiTasks.status, "queued"))).returning({ id: aiTasks.id });
    if (!released || !isReleasedDepartmentStep({ sequence: next.sequence, description: releasedDescription, previousStepStatus: terminal })) return;
    await db.update(departmentTaskRuns).set({ status: "running", updatedAt: new Date() }).where(and(eq(departmentTaskRuns.id, step.runId), eq(departmentTaskRuns.organizationId, organizationId)));
    await this.tasks.enqueue(next);
  }

  private getDatabaseErrorCode(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null) {
      return undefined;
    }

    const candidate = error as {
      code?: string;
      cause?: unknown;
    };

    if (candidate.code === "23505" || candidate.code === "23503") {
      return candidate.code;
    }

    return this.getDatabaseErrorCode(candidate.cause);
  }

  private isUniqueViolation(error: unknown): boolean {
    return this.getDatabaseErrorCode(error) === "23505";
  }

  private isForeignKeyViolation(error: unknown): boolean {
    return this.getDatabaseErrorCode(error) === "23503";
  }
}
