import {Body,Controller,Get,Param,Patch,Post,Query,UseGuards} from "@nestjs/common";
import {AuthGuard} from "../../auth/auth.guard.js";
import {CurrentContext} from "../../auth/current-context.decorator.js";
import type {RequestContext} from "../../auth/request-context.js";
import {PermissionsGuard} from "../../common/permissions/permissions.guard.js";
import {RequirePermissions} from "../../common/permissions/permissions.decorator.js";
import {PERMISSIONS} from "../../common/permissions/permissions.js";
import {LeadInput,LeadStatusInput,ListLeadsDto} from "./leads.dto.js";
import {LeadsService} from "./leads.service.js";
@Controller("crm/leads") @UseGuards(AuthGuard,PermissionsGuard)
export class LeadsController {
 constructor(private readonly service:LeadsService){}
 @Get() @RequirePermissions(PERMISSIONS.CRM_LEAD_READ)
 list(@CurrentContext()ctx:RequestContext,@Query()q:ListLeadsDto){return this.service.list(ctx,q)}
 @Get(":id") @RequirePermissions(PERMISSIONS.CRM_LEAD_READ)
 detail(@CurrentContext()ctx:RequestContext,@Param("id")id:string){return this.service.detail(ctx,id)}
 @Post() @RequirePermissions(PERMISSIONS.CRM_LEAD_CREATE)
 create(@CurrentContext()ctx:RequestContext,@Body()dto:LeadInput){return this.service.create(ctx,dto)}
 @Patch(":id") @RequirePermissions(PERMISSIONS.CRM_LEAD_UPDATE)
 update(@CurrentContext()ctx:RequestContext,@Param("id")id:string,@Body()dto:LeadInput){return this.service.update(ctx,id,dto)}
 @Patch(":id/status") @RequirePermissions(PERMISSIONS.CRM_LEAD_UPDATE)
 status(@CurrentContext()ctx:RequestContext,@Param("id")id:string,@Body()dto:LeadStatusInput){return this.service.status(ctx,id,dto)}
 @Post(":id/archive") @RequirePermissions(PERMISSIONS.CRM_LEAD_ARCHIVE)
 archive(@CurrentContext()ctx:RequestContext,@Param("id")id:string){return this.service.archive(ctx,id,true)}
 @Post(":id/restore") @RequirePermissions(PERMISSIONS.CRM_LEAD_ARCHIVE)
 restore(@CurrentContext()ctx:RequestContext,@Param("id")id:string){return this.service.archive(ctx,id,false)}
}
