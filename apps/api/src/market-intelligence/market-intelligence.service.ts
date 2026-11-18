import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { aiTaskEvents, aiTaskResearchSources, aiTasks, db, marketIntelligenceFindings, marketIntelligenceJobSteps, marketIntelligenceProjects, marketIntelligenceReports, marketIntelligenceSourceConfigs } from "@workspace/db/node";
import type { RequestContext } from "../auth/request-context.js";
import { TasksService } from "../tasks/tasks.service.js";
import type { CreateMarketIntelligenceProjectDto } from "./market-intelligence.dto.js";
import { createMarketIntelligenceSteps } from "./market-intelligence-progress.js";

@Injectable()
export class MarketIntelligenceService {
  constructor(private readonly tasks: TasksService) {}
  async create(ctx: RequestContext, dto: CreateMarketIntelligenceProjectDto) {
    const title = dto.title.trim(), industry = dto.industry.trim(), market = dto.market.trim(), objective = dto.objective.trim(), targetAudience = dto.targetAudience?.trim() || null, maxSources = dto.maxSources ?? 8, researchProvider = dto.researchProvider ?? "searxng";
    if (!title || !industry || !market || !objective) throw new BadRequestException("Hãy nhập đầy đủ thông tin nghiên cứu thị trường.");
    const keywords = [...new Set((dto.keywords ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, 8);
    const task = await this.tasks.create(ctx, { title: `Tình báo thị trường: ${title}`, description: objective, agentId: dto.researchAgentId }, { enqueue: false, webResearchEnabled: true, researchProvider });
    let persistedProjectId: string | null = null;
    try {
      const [project] = await db.insert(marketIntelligenceProjects).values({ id: randomUUID(), organizationId: ctx.organizationId, createdBy: ctx.userId, taskId: task.id, title, industry, market, targetAudience, objective, keywords, maxSources, researchProvider }).returning();
      if (!project) throw new Error("Không thể lưu dự án nghiên cứu.");
      persistedProjectId = project.id;
      await createMarketIntelligenceSteps({ projectId: project.id, organizationId: ctx.organizationId, agentName: task.agentName });
      const sourceConfigs = (dto.sourceUrls ?? []).map((value) => value.trim()).filter(Boolean).map((url) => {
        let host = ""; try { host = new URL(url).hostname.toLowerCase(); } catch { throw new BadRequestException("URL nguồn không hợp lệ."); }
        return { id: randomUUID(), organizationId: ctx.organizationId, projectId: project.id, kind: host === "facebook.com" || host.endsWith(".facebook.com") ? "facebook" as const : "web" as const, url, status: host === "facebook.com" || host.endsWith(".facebook.com") ? "permission_required" as const : "pending" as const, safeErrorCode: host === "facebook.com" || host.endsWith(".facebook.com") ? "FACEBOOK_OFFICIAL_ACCESS_REQUIRED" : null };
      });
      if (sourceConfigs.length) await db.insert(marketIntelligenceSourceConfigs).values(sourceConfigs);
      await this.tasks.enqueue(task);
      return project;
    } catch (error) {
      // Creating the project and its persisted checkpoints happens before
      // enqueueing. Roll back the project first so its FK cannot prevent the
      // deliberately unqueued Task from being discarded.
      if (persistedProjectId) await db.delete(marketIntelligenceProjects).where(and(eq(marketIntelligenceProjects.id, persistedProjectId), eq(marketIntelligenceProjects.organizationId, ctx.organizationId)));
      await this.tasks.discardUnqueued(task);
      throw error;
    }
  }
  async list(ctx: RequestContext) {
    // Uses the same lease-based recovery as Tasks. It never treats a merely
    // slow browser poll as a failed job.
    await this.tasks.recoverExpiredTasks(ctx.organizationId);
    return db.select({ project: marketIntelligenceProjects, taskStatus: aiTasks.status, taskError: aiTasks.error }).from(marketIntelligenceProjects).innerJoin(aiTasks, and(eq(aiTasks.id, marketIntelligenceProjects.taskId), eq(aiTasks.organizationId, marketIntelligenceProjects.organizationId))).where(eq(marketIntelligenceProjects.organizationId, ctx.organizationId)).orderBy(desc(marketIntelligenceProjects.updatedAt));
  }
  async get(ctx: RequestContext, id: string) {
    await this.tasks.recoverExpiredTasks(ctx.organizationId);
    const [project] = await db.select().from(marketIntelligenceProjects).where(and(eq(marketIntelligenceProjects.id, id), eq(marketIntelligenceProjects.organizationId, ctx.organizationId))).limit(1);
    if (!project) throw new NotFoundException("Không tìm thấy dự án tình báo thị trường.");
    const [taskRows, sources, configuredSources, report, findings, steps, events] = await Promise.all([
      db.select().from(aiTasks).where(and(eq(aiTasks.id, project.taskId), eq(aiTasks.organizationId, ctx.organizationId))).limit(1),
      db.select().from(aiTaskResearchSources).where(and(eq(aiTaskResearchSources.taskId, project.taskId), eq(aiTaskResearchSources.organizationId, ctx.organizationId))).orderBy(aiTaskResearchSources.ordinal),
      db.select().from(marketIntelligenceSourceConfigs).where(and(eq(marketIntelligenceSourceConfigs.projectId, id), eq(marketIntelligenceSourceConfigs.organizationId, ctx.organizationId))),
      db.select().from(marketIntelligenceReports).where(and(eq(marketIntelligenceReports.projectId, id), eq(marketIntelligenceReports.organizationId, ctx.organizationId))).limit(1),
      db.select().from(marketIntelligenceFindings).where(and(eq(marketIntelligenceFindings.projectId, id), eq(marketIntelligenceFindings.organizationId, ctx.organizationId))),
      db.select().from(marketIntelligenceJobSteps).where(and(eq(marketIntelligenceJobSteps.projectId, id), eq(marketIntelligenceJobSteps.organizationId, ctx.organizationId))).orderBy(marketIntelligenceJobSteps.sequence),
      db.select().from(aiTaskEvents).where(and(eq(aiTaskEvents.taskId, project.taskId), eq(aiTaskEvents.organizationId, ctx.organizationId))).orderBy(aiTaskEvents.createdAt),
    ]);
    return { ...project, task: taskRows[0] ?? null, sources, configuredSources, report: report[0] ?? null, findings, steps, events };
  }
  async cancel(ctx: RequestContext, id: string) {
    const [project] = await db.select().from(marketIntelligenceProjects).where(and(eq(marketIntelligenceProjects.id, id), eq(marketIntelligenceProjects.organizationId, ctx.organizationId))).limit(1);
    if (!project) throw new NotFoundException("Không tìm thấy dự án tình báo thị trường.");
    await this.tasks.cancel(ctx, project.taskId);
    await db.update(marketIntelligenceProjects).set({ status: "cancelled", completedAt: new Date(), updatedAt: new Date() }).where(and(eq(marketIntelligenceProjects.id, id), eq(marketIntelligenceProjects.organizationId, ctx.organizationId)));
    return { cancelled: true };
  }
  async retry(ctx: RequestContext, id: string) {
    const detail = await this.get(ctx, id);
    if (detail.task?.status !== "failed") throw new BadRequestException("Chỉ có thể thử lại dự án đã thất bại.");
    if (!detail.task.agentId) throw new BadRequestException("Dự án cũ không có Research Agent để thử lại an toàn.");
    return this.create(ctx, { title: detail.title, industry: detail.industry, market: detail.market, targetAudience: detail.targetAudience ?? undefined, objective: detail.objective, maxSources: detail.maxSources, researchProvider: detail.researchProvider as "searxng" | "tavily", researchAgentId: detail.task.agentId, keywords: detail.keywords, sourceUrls: detail.configuredSources.map((source) => source.url) });
  }
}
