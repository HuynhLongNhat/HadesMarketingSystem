import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { db, crmActivities, crmCompanies, crmContacts, crmCompanyContacts, crmLeads, user } from "@workspace/db/node";
import { randomUUID } from "node:crypto";
import type { RequestContext } from "../../auth/request-context.js";
import type { ActivityInput, CreateActivityDto, ListActivitiesDto } from "./activities.dto.js";

type Target = "company"|"contact"|"lead";
@Injectable()
export class ActivitiesService {
  private scope(ctx:RequestContext,target:Target,id:string) {
    return and(eq(crmActivities.organizationId,ctx.organizationId),eq(target==="company"?crmActivities.companyId:target==="lead"?crmActivities.leadId:crmActivities.contactId,id));
  }
  private values(dto:ActivityInput) {
    const occurredAt = new Date(dto.occurredAt);
    if(!Number.isFinite(occurredAt.getTime())||occurredAt.getTime()>Date.now()+60000) throw new BadRequestException("Activity must be in the past");
    if(!dto.subject.trim())throw new BadRequestException("Subject is required");
    return {type:dto.type,subject:dto.subject.trim(),body:dto.body?.trim()||null,outcome:dto.outcome?.trim()||null,occurredAt};
  }
  async list(ctx:RequestContext,target:Target,id:string,q:ListActivitiesDto) {
    const table=target==="company"?crmCompanies:target==="lead"?crmLeads:crmContacts;
    const [parent]=await db.select({id:table.id}).from(table).where(and(eq(table.id,id),eq(table.organizationId,ctx.organizationId)));
    if(!parent)throw new NotFoundException("CRM record not found");
    const where=and(this.scope(ctx,target,id),q.status==="archived"?isNotNull(crmActivities.archivedAt):isNull(crmActivities.archivedAt),q.type?eq(crmActivities.type,q.type):undefined);
    const page=q.page??1;
    const [items,count]=await Promise.all([
      db.select({activity:crmActivities,authorName:user.name}).from(crmActivities).leftJoin(user,eq(crmActivities.createdByUserId,user.id)).where(where).orderBy(desc(crmActivities.occurredAt),desc(crmActivities.id)).limit(20).offset((page-1)*20),
      db.select({total:sql<number>`count(*)::int`}).from(crmActivities).where(where),
    ]);
    return {items:items.map(r=>({...r.activity,authorName:r.authorName})),total:count[0]?.total??0,page,limit:20};
  }
  async create(ctx:RequestContext,target:Target,id:string,dto:CreateActivityDto) {
    return db.transaction(async tx=>{
      let companyId=target==="company"?id:target==="contact"?dto.relatedId??null:null;
      let contactId=target==="contact"?id:target==="company"?dto.relatedId??null:null;
      if(target==="lead"){const [lead]=await tx.select().from(crmLeads).where(and(eq(crmLeads.id,id),eq(crmLeads.organizationId,ctx.organizationId),isNull(crmLeads.archivedAt)));if(!lead||lead.status==="converted")throw new NotFoundException("Active lead not found");companyId=lead.companyId;contactId=lead.contactId;}
      if(companyId){const [company]=await tx.select({id:crmCompanies.id}).from(crmCompanies).where(and(eq(crmCompanies.id,companyId),eq(crmCompanies.organizationId,ctx.organizationId),isNull(crmCompanies.archivedAt))).for("update");if(!company)throw new NotFoundException("Active company not found");}
      if(contactId){const [contact]=await tx.select({id:crmContacts.id}).from(crmContacts).where(and(eq(crmContacts.id,contactId),eq(crmContacts.organizationId,ctx.organizationId),isNull(crmContacts.archivedAt))).for("update");if(!contact)throw new NotFoundException("Active contact not found");}
      if(companyId&&contactId){const [link]=await tx.select({companyId:crmCompanyContacts.companyId}).from(crmCompanyContacts).where(and(eq(crmCompanyContacts.organizationId,ctx.organizationId),eq(crmCompanyContacts.companyId,companyId),eq(crmCompanyContacts.contactId,contactId)));if(!link)throw new BadRequestException("Contact is not linked to this company");}
      if(target==="lead"){const [lead]=await tx.select().from(crmLeads).where(and(eq(crmLeads.id,id),eq(crmLeads.organizationId,ctx.organizationId),isNull(crmLeads.archivedAt))).for("update");if(!lead||lead.status==="converted"||lead.companyId!==companyId||lead.contactId!==contactId)throw new BadRequestException("Lead changed; reload and retry");}
      const [row]=await tx.insert(crmActivities).values({...this.values(dto),id:randomUUID(),organizationId:ctx.organizationId,companyId,contactId,leadId:target==="lead"?id:null,createdByUserId:ctx.userId}).returning();return row;
    });
  }
  async mutate(ctx:RequestContext,target:Target,id:string,activityId:string,change:ActivityInput|boolean) {
    return db.transaction(async tx=>{
      const scope=and(this.scope(ctx,target,id),eq(crmActivities.id,activityId));
      const [existing]=await tx.select().from(crmActivities).where(scope);
      if(!existing)throw new NotFoundException("Activity not found");
      // Preserve historical associations; only active parent records permit mutations.
      if(existing.companyId){const [parent]=await tx.select({id:crmCompanies.id}).from(crmCompanies).where(and(eq(crmCompanies.id,existing.companyId),eq(crmCompanies.organizationId,ctx.organizationId),isNull(crmCompanies.archivedAt))).for("update");if(!parent)throw new NotFoundException("Active company not found");}
      if(existing.contactId){const [parent]=await tx.select({id:crmContacts.id}).from(crmContacts).where(and(eq(crmContacts.id,existing.contactId),eq(crmContacts.organizationId,ctx.organizationId),isNull(crmContacts.archivedAt))).for("update");if(!parent)throw new NotFoundException("Active contact not found");}
      if(existing.leadId){const [lead]=await tx.select().from(crmLeads).where(and(eq(crmLeads.id,existing.leadId),eq(crmLeads.organizationId,ctx.organizationId),isNull(crmLeads.archivedAt))).for("update");if(!lead||lead.status==="converted")throw new NotFoundException("Active lead not found");}
      const [row]=await tx.update(crmActivities).set({...(typeof change==="boolean"?{archivedAt:change?new Date():null}:this.values(change)),updatedAt:new Date()}).where(and(scope,typeof change==="boolean"?undefined:isNull(crmActivities.archivedAt))).returning();
      if(!row)throw new NotFoundException("Active activity not found");return row;
    });
  }
}
