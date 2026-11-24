import { Module } from "@nestjs/common";
import { AuthGuard } from "../../auth/auth.guard.js";
import { PermissionsGuard } from "../../common/permissions/permissions.guard.js";
import { CompanyActivitiesController, ContactActivitiesController } from "./activities.controller.js";
import { ActivitiesService } from "./activities.service.js";
@Module({controllers:[CompanyActivitiesController,ContactActivitiesController],providers:[ActivitiesService,AuthGuard,PermissionsGuard]})
export class CrmActivitiesModule {}
