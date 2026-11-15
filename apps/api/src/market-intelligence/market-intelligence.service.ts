import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { aiTaskResearchSources, aiTasks, db, marketIntelligenceFindings, marketIntelligenceProjects, marketIntelligenceReports, marketIntelligenceSourceConfigs } from "@workspace/db/node";
import type { RequestContext } from "../auth/request-context.js";
import { TasksService } from "../tasks/tasks.service.js";
import type { CreateMarketIntelligenceProjectDto } from "./market-intelligence.dto.js";

@Injectable()
export class MarketIntelligenceService {
  constructor(private readonly tasks: TasksService) {}
  async create(ctx: RequestContext, dto: CreateMarketIntelligenceProjectDto) {
    const title = dto.title.trim(), industry = dto.industry.trim(), market = dto.market.trim(), objective = dto.objective.trim();
    if (!title || !industry || !market || !objective) throw new BadRequestException("Hãy nhập đầy đủ thông tin nghiên cứu thị trường.");
    const keywords = [...new Set((dto.keywords ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, 8);
    const task = await this.tasks.create(ctx, { title: `Tình báo thị trường: ${title}`, description: objective, agentId: dto.researchAgentId }, { enqueue: false, webResearchEnabled: true });
    try {
      const [project] = await db.insert(marketIntelligenceProjects).values({ id: randomUUID(), organizationId: ctx.organizationId, createdBy: ctx.userId, taskId: task.id, title, industry, market, objective, keywords }).returning();
      if (!project) throw new Error("Không thể lưu dự án nghiên cứu.");
      const sourceConfigs = (dto.sourceUrls ?? []).map((value) => value.trim()).filter(Boolean).map((url) => {
        let host = ""; try { host = new URL(url).hostname.toLowerCase(); } catch { throw new BadRequestException("URL nguồn không hợp lệ."); }
        return { id: randomUUID(), organizationId: ctx.organizationId, projectId: project.id, kind: host === "facebook.com" || host.endsWith(".facebook.com") ? "facebook" as const : "web" as const, url, status: host === "facebook.com" || host.endsWith(".facebook.com") ? "permission_required" as const : "pending" as const, safeErrorCode: host === "facebook.com" || host.endsWith(".facebook.com") ? "FACEBOOK_OFFICIAL_ACCESS_REQUIRED" : null };
      });
      if (sourceConfigs.length) await db.insert(marketIntelligenceSourceConfigs).values(sourceConfigs);
      await this.tasks.enqueue(task);
      return project;
    } catch (error) { await this.tasks.discardUnqueued(task); throw error; }
  }
  async list(ctx: RequestContext) { return db.select({ project: marketIntelligenceProjects, taskStatus: aiTasks.status, taskError: aiTasks.error }).from(marketIntelligenceProjects).innerJoin(aiTasks, and(eq(aiTasks.id, marketIntelligenceProjects.taskId), eq(aiTasks.organizationId, marketIntelligenceProjects.organizationId))).where(eq(marketIntelligenceProjects.organizationId, ctx.organizationId)).orderBy(desc(marketIntelligenceProjects.updatedAt)); }
  async get(ctx: RequestContext, id: string) {
    const [project] = await db.select().from(marketIntelligenceProjects).where(and(eq(marketIntelligenceProjects.id, id), eq(marketIntelligenceProjects.organizationId, ctx.organizationId))).limit(1);
    if (!project) throw new NotFoundException("Không tìm thấy dự án tình báo thị trường.");
    const [task, sources, configuredSources, report, findings] = await Promise.all([
      db.select().from(aiTasks).where(and(eq(aiTasks.id, project.taskId), eq(aiTasks.organizationId, ctx.organizationId))).limit(1),
      db.select().from(aiTaskResearchSources).where(and(eq(aiTaskResearchSources.taskId, project.taskId), eq(aiTaskResearchSources.organizationId, ctx.organizationId))).orderBy(aiTaskResearchSources.ordinal),
      db.select().from(marketIntelligenceSourceConfigs).where(and(eq(marketIntelligenceSourceConfigs.projectId, id), eq(marketIntelligenceSourceConfigs.organizationId, ctx.organizationId))),
      db.select().from(marketIntelligenceReports).where(and(eq(marketIntelligenceReports.projectId, id), eq(marketIntelligenceReports.organizationId, ctx.organizationId))).limit(1),
      db.select().from(marketIntelligenceFindings).where(and(eq(marketIntelligenceFindings.projectId, id), eq(marketIntelligenceFindings.organizationId, ctx.organizationId))),
    ]);
    return { ...project, task: task ?? null, sources, configuredSources, report: report[0] ?? null, findings };
  }
}
