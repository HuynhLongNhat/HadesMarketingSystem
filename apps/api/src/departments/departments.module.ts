
import { Module } from "@nestjs/common";

import { AuthGuard } from "../auth/auth.guard.js";
import { PermissionsGuard } from "../common/permissions/permissions.guard.js";
import { TasksModule } from "../tasks/tasks.module.js";

import { DepartmentsController } from "./departments.controller.js";
import { DepartmentsService } from "./departments.service.js";

@Module({
  imports: [TasksModule],
  controllers: [DepartmentsController],
  providers: [
    DepartmentsService,
    AuthGuard,
    PermissionsGuard,
  ],
  exports: [DepartmentsService],
})
export class DepartmentsModule {}
