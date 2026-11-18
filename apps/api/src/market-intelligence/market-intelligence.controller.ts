import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentContext } from "../auth/current-context.decorator.js";
import type { RequestContext } from "../auth/request-context.js";
import { PermissionsGuard } from "../common/permissions/permissions.guard.js";
import { RequirePermissions } from "../common/permissions/permissions.decorator.js";
import { PERMISSIONS } from "../common/permissions/permissions.js";
import { CreateMarketIntelligenceProjectDto, ResumeMarketResearchDto } from "./market-intelligence.dto.js";
import { MarketIntelligenceService } from "./market-intelligence.service.js";
@Controller("market-intelligence") @UseGuards(AuthGuard, PermissionsGuard)
export class MarketIntelligenceController {
  constructor(private readonly service: MarketIntelligenceService) {}
  @Get() @RequirePermissions(PERMISSIONS.AGENT_READ)
  list(@CurrentContext() ctx: RequestContext) { return this.service.list(ctx); }
  @Get(":id") @RequirePermissions(PERMISSIONS.AGENT_READ)
  get(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.service.get(ctx, id); }
  @Post() @RequirePermissions(PERMISSIONS.AGENT_MANAGE)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateMarketIntelligenceProjectDto) { return this.service.create(ctx, dto); }
  @Post(":id/cancel") @RequirePermissions(PERMISSIONS.AGENT_MANAGE)
  cancel(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.service.cancel(ctx, id); }
  @Post(":id/retry") @RequirePermissions(PERMISSIONS.AGENT_MANAGE)
  retry(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.service.retry(ctx, id); }
  @Post(":id/resume") @RequirePermissions(PERMISSIONS.AGENT_MANAGE)
  resume(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() dto: ResumeMarketResearchDto) { return this.service.retry(ctx, id, dto.refreshAgentConfiguration ?? false); }
}
