import { Module } from "@nestjs/common";
import { AuthGuard } from "../../auth/auth.guard.js";
import { PermissionsGuard } from "../../common/permissions/permissions.guard.js";
import { CompaniesController } from "./companies.controller.js";
import { CompaniesService } from "./companies.service.js";

@Module({ controllers: [CompaniesController], providers: [CompaniesService, AuthGuard, PermissionsGuard] })
export class CrmCompaniesModule {}
