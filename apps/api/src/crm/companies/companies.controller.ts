import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../auth/auth.guard.js";
import { CurrentContext } from "../../auth/current-context.decorator.js";
import type { RequestContext } from "../../auth/request-context.js";
import { RequirePermissions } from "../../common/permissions/permissions.decorator.js";
import { PermissionsGuard } from "../../common/permissions/permissions.guard.js";
import { PERMISSIONS } from "../../common/permissions/permissions.js";
import { CreateCompanyDto, UpdateCompanyDto, ListCompaniesDto, LinkCompanyContactDto } from "./companies.dto.js";
import { CompaniesService } from "./companies.service.js";

@Controller("crm/companies")
@UseGuards(AuthGuard, PermissionsGuard)
export class CompaniesController {
  constructor(private readonly service: CompaniesService) {}
  @Get() @RequirePermissions(PERMISSIONS.CRM_COMPANY_READ)
  list(@CurrentContext() ctx: RequestContext, @Query() query: ListCompaniesDto) { return this.service.list(ctx, query); }
  @Post() @RequirePermissions(PERMISSIONS.CRM_COMPANY_CREATE)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateCompanyDto) { return this.service.create(ctx, dto); }
  @Get(":id") @RequirePermissions(PERMISSIONS.CRM_COMPANY_READ)
  detail(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.service.detail(ctx, id); }
  @Patch(":id") @RequirePermissions(PERMISSIONS.CRM_COMPANY_UPDATE)
  update(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() dto: UpdateCompanyDto) { return this.service.update(ctx, id, dto); }
  @Post(":id/archive") @RequirePermissions(PERMISSIONS.CRM_COMPANY_ARCHIVE)
  archive(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.service.archive(ctx, id, true); }
  @Post(":id/restore") @RequirePermissions(PERMISSIONS.CRM_COMPANY_ARCHIVE)
  restore(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.service.archive(ctx, id, false); }
  @Post(":id/contacts") @RequirePermissions(PERMISSIONS.CRM_COMPANY_UPDATE)
  link(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() dto: LinkCompanyContactDto) { return this.service.link(ctx, id, dto.contactId); }
  @Delete(":id/contacts/:contactId") @RequirePermissions(PERMISSIONS.CRM_COMPANY_UPDATE)
  unlink(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Param("contactId") contactId: string) { return this.service.unlink(ctx, id, contactId); }
}
