import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import {
  assistantConversations,
  assistantTaskLinks,
  aiTasks,
  db,
} from "@workspace/db/node";
import type { RequestContext } from "../auth/request-context.js";
import { TasksService } from "../tasks/tasks.service.js";
import { AssistantService } from "./assistant.service.js";
import type { AssistantTaskDto } from "./assistant-tasks.controller.js";

@Injectable()
export class AssistantTasksService {
  constructor(
    private readonly assistant: AssistantService,
    private readonly tasks: TasksService,
  ) {}
  private scope(ctx: RequestContext) {
    return and(
      eq(assistantTaskLinks.organizationId, ctx.organizationId),
      eq(assistantTaskLinks.userId, ctx.userId),
    );
  }
  async list(ctx: RequestContext, conversationId?: string) {
    if (conversationId) await this.assistant.owned(ctx, conversationId);
    const rows = await db
      .select({
        task: aiTasks,
        conversationId: assistantTaskLinks.conversationId,
      })
      .from(assistantTaskLinks)
      .innerJoin(
        aiTasks,
        and(
          eq(aiTasks.id, assistantTaskLinks.taskId),
          eq(aiTasks.organizationId, assistantTaskLinks.organizationId),
        ),
      )
      .where(
        and(
          this.scope(ctx),
          ...(conversationId
            ? [eq(assistantTaskLinks.conversationId, conversationId)]
            : []),
        ),
      )
      .orderBy(desc(assistantTaskLinks.createdAt))
      .limit(100);
    // Deliberate public projection: do not expose execution tokens or Agent prompts.
    return rows.map(({ task, conversationId }) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      agentId: task.agentId,
      agentName: task.agentName,
      status: task.status,
      error: task.error,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      conversationId,
    }));
  }
  private async owned(ctx: RequestContext, taskId: string) {
    const [link] = await db
      .select()
      .from(assistantTaskLinks)
      .where(and(this.scope(ctx), eq(assistantTaskLinks.taskId, taskId)))
      .limit(1);
    if (!link)
      throw new NotFoundException(
        "Không tìm thấy nhiệm vụ trong trợ lý của bạn.",
      );
    return link;
  }
  async get(ctx: RequestContext, taskId: string) {
    await this.owned(ctx, taskId);
    const task = await this.tasks.get(ctx, taskId);
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      agentName: task.agentName,
      status: task.status,
      error: task.error,
      webResearchEnabled: task.webResearchEnabled,
      result: task.result,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      events: task.events,
      researchSources: task.researchSources,
    };
  }
  async resumeResearch(ctx: RequestContext, taskId: string, refreshAgentConfiguration = true) {
    await this.owned(ctx, taskId);
    const task = await this.tasks.get(ctx, taskId);
    if (!task.webResearchEnabled) {
      throw new ConflictException("Nhiệm vụ này không sử dụng Web Research nên không thể tiếp tục nghiên cứu.");
    }
    return this.tasks.resumeResearch(ctx, taskId, refreshAgentConfiguration);
  }
  async cancel(ctx: RequestContext, taskId: string) {
    await this.owned(ctx, taskId);
    return this.tasks.cancel(ctx, taskId);
  }
  async create(
    ctx: RequestContext,
    conversationId: string,
    input: AssistantTaskDto,
  ) {
    const hash = createHash("sha256")
      .update(
        JSON.stringify([
          input.title.trim(),
          input.description.trim(),
          input.agentId,
        ]),
      )
      .digest("hex");
    const result = await db.transaction(async (tx) => {
      const [conversation] = await tx
        .select()
        .from(assistantConversations)
        .where(
          and(
            eq(assistantConversations.id, conversationId),
            eq(assistantConversations.organizationId, ctx.organizationId),
            eq(assistantConversations.userId, ctx.userId),
          ),
        )
        .for("update");
      if (!conversation)
        throw new NotFoundException("Không tìm thấy cuộc trò chuyện.");
      const [existing] = await tx
        .select()
        .from(assistantTaskLinks)
        .where(
          and(
            eq(assistantTaskLinks.conversationId, conversationId),
            eq(assistantTaskLinks.requestId, input.requestId),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.requestHash !== hash)
          throw new ConflictException(
            "Mã yêu cầu đã được sử dụng cho nội dung khác.",
          );
        return { id: existing.taskId, fresh: false };
      }
      const task = await this.tasks.create(ctx, input, {
        enqueue: false,
        store: tx,
      });
      if (!task) throw new Error("Task persistence failed");
      await tx
        .insert(assistantTaskLinks)
        .values({
          id: randomUUID(),
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          conversationId,
          requestId: input.requestId,
          requestHash: hash,
          taskId: task.id,
        });
      await tx
        .update(assistantConversations)
        .set({
          updatedAt: new Date(),
          ...(conversation.title === "Cuộc trò chuyện mới"
            ? { title: input.title.trim().slice(0, 160) }
            : {}),
        })
        .where(eq(assistantConversations.id, conversationId));
      return { id: task.id, fresh: true };
    });
    // Queue only committed tasks. Duplicate requests never enqueue again. Existing
    // lease recovery handles a process crash between DB commit and queue delivery.
    if (result.fresh) {
      try {
        await this.tasks.enqueue({
          id: result.id,
          organizationId: ctx.organizationId,
        });
      } catch {
        /* enqueue persists a safe failed status; expose it via the card */
      }
    }
    return { taskId: result.id, replay: !result.fresh };
  }
}
