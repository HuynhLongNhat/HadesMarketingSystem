import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../auth/auth.guard.js";
import { CurrentContext } from "../../auth/current-context.decorator.js";
import type { RequestContext } from "../../auth/request-context.js";
import { PermissionsGuard } from "../../common/permissions/permissions.guard.js";
import { RequirePermissions } from "../../common/permissions/permissions.decorator.js";
import { PERMISSIONS } from "../../common/permissions/permissions.js";
import { ActivitiesService } from "./activities.service.js";
import { ActivityInput, CreateActivityDto, ListActivitiesDto } from "./activities.dto.js";
@Controller("crm/companies/:id/activities")
@UseGuards(AuthGuard,PermissionsGuard)
export class CompanyActivitiesController {
 constructor(private readonly service:ActivitiesService){}
 @Get() @RequirePermissions(PERMISSIONS.CRM_COMPANY_READ)
 list(@CurrentContext() ctx:RequestContext,@Param("id") id:string,@Query() q:ListActivitiesDto){return this.service.list(ctx,"company",id,q)}
 @Post() @RequirePermissions(PERMISSIONS.CRM_COMPANY_UPDATE)
 create(@CurrentContext() ctx:RequestContext,@Param("id") id:string,@Body() dto:CreateActivityDto){return this.service.create(ctx,"company",id,dto)}
 @Patch(":activityId") @RequirePermissions(PERMISSIONS.CRM_COMPANY_UPDATE)
 update(@CurrentContext() ctx:RequestContext,@Param("id") id:string,@Param("activityId") activityId:string,@Body() dto:ActivityInput){return this.service.mutate(ctx,"company",id,activityId,dto)}
 @Post(":activityId/archive") @RequirePermissions(PERMISSIONS.CRM_COMPANY_UPDATE)
 archive(@CurrentContext() ctx:RequestContext,@Param("id") id:string,@Param("activityId") activityId:string){return this.service.mutate(ctx,"company",id,activityId,true)}
 @Post(":activityId/restore") @RequirePermissions(PERMISSIONS.CRM_COMPANY_UPDATE)
 restore(@CurrentContext() ctx:RequestContext,@Param("id") id:string,@Param("activityId") activityId:string){return this.service.mutate(ctx,"company",id,activityId,false)}
}

@Controller("crm/contacts/:id/activities")
@UseGuards(AuthGuard,PermissionsGuard)
export class ContactActivitiesController {
 constructor(private readonly service:ActivitiesService){}
 @Get() @RequirePermissions(PERMISSIONS.CRM_CONTACT_READ)
 list(@CurrentContext() ctx:RequestContext,@Param("id") id:string,@Query() q:ListActivitiesDto){return this.service.list(ctx,"contact",id,q)}
 @Post() @RequirePermissions(PERMISSIONS.CRM_CONTACT_UPDATE)
 create(@CurrentContext() ctx:RequestContext,@Param("id") id:string,@Body() dto:CreateActivityDto){return this.service.create(ctx,"contact",id,dto)}
 @Patch(":activityId") @RequirePermissions(PERMISSIONS.CRM_CONTACT_UPDATE)
 update(@CurrentContext() ctx:RequestContext,@Param("id") id:string,@Param("activityId") activityId:string,@Body() dto:ActivityInput){return this.service.mutate(ctx,"contact",id,activityId,dto)}
 @Post(":activityId/archive") @RequirePermissions(PERMISSIONS.CRM_CONTACT_UPDATE)
 archive(@CurrentContext() ctx:RequestContext,@Param("id") id:string,@Param("activityId") activityId:string){return this.service.mutate(ctx,"contact",id,activityId,true)}
 @Post(":activityId/restore") @RequirePermissions(PERMISSIONS.CRM_CONTACT_UPDATE)
 restore(@CurrentContext() ctx:RequestContext,@Param("id") id:string,@Param("activityId") activityId:string){return this.service.mutate(ctx,"contact",id,activityId,false)}
}

@Controller("crm/leads/:id/activities")
@UseGuards(AuthGuard,PermissionsGuard)
export class LeadActivitiesController {
 constructor(private readonly service:ActivitiesService){}
 @Get() @RequirePermissions(PERMISSIONS.CRM_LEAD_READ)
 list(@CurrentContext() ctx:RequestContext,@Param("id") id:string,@Query() q:ListActivitiesDto){return this.service.list(ctx,"lead",id,q)}
 @Post() @RequirePermissions(PERMISSIONS.CRM_LEAD_UPDATE)
 create(@CurrentContext() ctx:RequestContext,@Param("id") id:string,@Body() dto:CreateActivityDto){return this.service.create(ctx,"lead",id,dto)}
 @Patch(":activityId") @RequirePermissions(PERMISSIONS.CRM_LEAD_UPDATE)
 update(@CurrentContext() ctx:RequestContext,@Param("id") id:string,@Param("activityId") activityId:string,@Body() dto:ActivityInput){return this.service.mutate(ctx,"lead",id,activityId,dto)}
 @Post(":activityId/archive") @RequirePermissions(PERMISSIONS.CRM_LEAD_UPDATE)
 archive(@CurrentContext() ctx:RequestContext,@Param("id") id:string,@Param("activityId") activityId:string){return this.service.mutate(ctx,"lead",id,activityId,true)}
 @Post(":activityId/restore") @RequirePermissions(PERMISSIONS.CRM_LEAD_UPDATE)
 restore(@CurrentContext() ctx:RequestContext,@Param("id") id:string,@Param("activityId") activityId:string){return this.service.mutate(ctx,"lead",id,activityId,false)}
}
