import { Module } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { PermissionsGuard } from "../common/permissions/permissions.guard.js";
import { TasksModule } from "../tasks/tasks.module.js";
import { MarketIntelligenceController } from "./market-intelligence.controller.js";
import { MarketIntelligenceService } from "./market-intelligence.service.js";
import { ResearchServiceClient } from "./research-service.client.js";
@Module({ imports: [TasksModule], controllers: [MarketIntelligenceController], providers: [MarketIntelligenceService, ResearchServiceClient, AuthGuard, PermissionsGuard], exports: [ResearchServiceClient] }) export class MarketIntelligenceModule {}
