import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { IsString, IsUUID, MaxLength, MinLength } from "class-validator";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentContext } from "../auth/current-context.decorator.js";
import type { RequestContext } from "../auth/request-context.js";
import { RequirePermissions } from "../common/permissions/permissions.decorator.js";
import { PermissionsGuard } from "../common/permissions/permissions.guard.js";
import { PERMISSIONS } from "../common/permissions/permissions.js";
import { AssistantOriginGuard } from "./assistant.controller.js";
import { AssistantTasksService } from "./assistant-tasks.service.js";

export class AssistantTaskDto {
  @IsUUID() requestId!: string;
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsString() @MinLength(1) @MaxLength(12000) description!: string;
  @IsUUID() agentId!: string;
}
@Controller("assistant")
@UseGuards(AuthGuard, PermissionsGuard, AssistantOriginGuard)
@RequirePermissions(PERMISSIONS.ASSISTANT_USE, PERMISSIONS.AGENT_READ)
export class AssistantTasksController {
  constructor(private readonly service: AssistantTasksService) {}
  @Get("tasks") list(@CurrentContext() ctx: RequestContext) {
    return this.service.list(ctx);
  }
  @Get("conversations/:id/tasks") conversation(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
  ) {
    return this.service.list(ctx, id);
  }
  @Get("tasks/:id") get(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
  ) {
    return this.service.get(ctx, id);
  }
  @Post("conversations/:id/tasks")
  @RequirePermissions(PERMISSIONS.ASSISTANT_USE, PERMISSIONS.AGENT_MANAGE)
  create(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() input: AssistantTaskDto,
  ) {
    return this.service.create(ctx, id, input);
  }
  @Post("tasks/:id/resume-research")
  @RequirePermissions(PERMISSIONS.ASSISTANT_USE, PERMISSIONS.AGENT_MANAGE)
  resumeResearch(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.service.resumeResearch(ctx, id);
  }
  @Post("tasks/:id/cancel")
  @RequirePermissions(PERMISSIONS.ASSISTANT_USE, PERMISSIONS.AGENT_MANAGE)
  cancel(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.service.cancel(ctx, id);
  }
}
