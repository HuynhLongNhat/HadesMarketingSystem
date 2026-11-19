import { Module } from "@nestjs/common";
import { TasksModule } from "../tasks/tasks.module.js";
import { AssistantTasksService } from "./assistant-tasks.service.js";
import { AssistantTasksController } from "./assistant-tasks.controller.js";
import {
  AssistantController,
  AssistantOriginGuard,
} from "./assistant.controller.js";
import { AssistantService } from "./assistant.service.js";
import { AssistantChatRuntimeService } from "../ai-providers/assistant-chat-runtime.service.js";
import { AiUsageQuotaService } from "../conversations/ai-usage-quota.service.js";
import { AiUsageRecorder } from "../conversations/ai-usage-recorder.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { PermissionsGuard } from "../common/permissions/permissions.guard.js";

@Module({
  imports: [TasksModule],
  controllers: [AssistantController, AssistantTasksController],
  providers: [
    AssistantService,
    AssistantTasksService,
    AssistantChatRuntimeService,
    AiUsageQuotaService,
    AiUsageRecorder,
    AuthGuard,
    PermissionsGuard,
    AssistantOriginGuard,
  ],
})
export class AssistantModule {}
