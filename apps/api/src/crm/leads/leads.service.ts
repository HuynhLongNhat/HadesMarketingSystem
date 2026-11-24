import {BadRequestException,ConflictException,Injectable,NotFoundException} from "@nestjs/common";
import {and,asc,desc,eq,ilike,isNull,isNotNull,or,sql} from "drizzle-orm";
import {db,crmLeads,crmCompanies,crmContacts,crmCompanyContacts,crmActivities,member,user} from "@workspace/db/node";
import {randomUUID} from "node:crypto";
import type {RequestContext} from "../../auth/request-context.js";
import type {LeadInput,LeadStatusInput,ListLeadsDto} from "./leads.dto.js";
@Injectable()
export class LeadsService {
 private scope(ctx:RequestContext,id:string){return and(eq(crmLeads.organizationId,ctx.organizationId),eq(crmLeads.id,id))}
 private clean(v?:string|null){return v?.trim()||null}
 private values(dto:LeadInput){
  const companyId=this.clean(dto.companyId),contactId=this.clean(dto.contactId);
  if(!companyId&&!contactId)throw new BadRequestException("Company or contact is required");
  if(!dto.title.trim())throw new BadRequestException("Title is required");
  const budgetMin=this.clean(dto.budgetMin),budgetMax=this.clean(dto.budgetMax);
  const cents=(v:string)=>{const [a,b=""]=v.split(".");return BigInt(a)*100n+BigInt(b.padEnd(2,"0"))};
  if(budgetMin!==null&&budgetMax!==null&&cents(budgetMin)>cents(budgetMax))throw new BadRequestException("Minimum budget exceeds maximum");
  return {companyId,contactId,title:dto.title.trim(),description:this.clean(dto.description),budgetMin,budgetMax,currency:dto.currency??"VND",expectedStartDate:dto.expectedStartDate??null,priority:dto.priority??"medium",source:this.clean(dto.source),ownerMemberId:this.clean(dto.ownerMemberId),notes:this.clean(dto.notes)};
 }
 private async validate(ctx:RequestContext,v:ReturnType<LeadsService["values"]>,tx:Parameters<Parameters<typeof db.transaction>[0]>[0]){
  if(v.companyId){const [r]=await tx.select({id:crmCompanies.id}).from(crmCompanies).where(and(eq(crmCompanies.id,v.companyId),eq(crmCompanies.organizationId,ctx.organizationId),isNull(crmCompanies.archivedAt))).for("update");if(!r)throw new BadRequestException("Active company not found")}
  if(v.contactId){const [r]=await tx.select({id:crmContacts.id}).from(crmContacts).where(and(eq(crmContacts.id,v.contactId),eq(crmContacts.organizationId,ctx.organizationId),isNull(crmContacts.archivedAt))).for("update");if(!r)throw new BadRequestException("Active contact not found")}
  if(v.companyId&&v.contactId){const [r]=await tx.select({id:crmCompanyContacts.companyId}).from(crmCompanyContacts).where(and(eq(crmCompanyContacts.organizationId,ctx.organizationId),eq(crmCompanyContacts.companyId,v.companyId),eq(crmCompanyContacts.contactId,v.contactId)));if(!r)throw new BadRequestException("Contact is not linked to company")}
  if(v.ownerMemberId){const [r]=await tx.select({id:member.id}).from(member).where(and(eq(member.id,v.ownerMemberId),eq(member.organizationId,ctx.organizationId)));if(!r)throw new BadRequestException("Owner must belong to organization")}
 }
 async list(ctx:RequestContext,q:ListLeadsDto){
  const term=q.search?.trim().replace(/[\\%_]/g,"\\$&");
  const where=and(eq(crmLeads.organizationId,ctx.organizationId),q.archive==="archived"?isNotNull(crmLeads.archivedAt):isNull(crmLeads.archivedAt),q.status?eq(crmLeads.status,q.status):undefined,q.priority?eq(crmLeads.priority,q.priority):undefined,q.companyId?eq(crmLeads.companyId,q.companyId):undefined,q.contactId?eq(crmLeads.contactId,q.contactId):undefined,term?or(ilike(crmLeads.title,"%"+term+"%"),ilike(crmLeads.description,"%"+term+"%"),ilike(crmCompanies.name,"%"+term+"%"),ilike(crmContacts.displayName,"%"+term+"%")):undefined);
  const query=()=>db.select({lead:crmLeads,companyName:crmCompanies.name,contactName:crmContacts.displayName,ownerName:user.name}).from(crmLeads).leftJoin(crmCompanies,and(eq(crmLeads.companyId,crmCompanies.id),eq(crmLeads.organizationId,crmCompanies.organizationId))).leftJoin(crmContacts,and(eq(crmLeads.contactId,crmContacts.id),eq(crmLeads.organizationId,crmContacts.organizationId))).leftJoin(member,and(eq(crmLeads.ownerMemberId,member.id),eq(crmLeads.organizationId,member.organizationId))).leftJoin(user,eq(member.userId,user.id));
  const page=q.page??1;
  const [rows,count]=await Promise.all([query().where(where).orderBy(q.sort==="title"?asc(crmLeads.title):q.sort==="created"?desc(crmLeads.createdAt):desc(crmLeads.updatedAt),desc(crmLeads.id)).limit(20).offset((page-1)*20),db.select({total:sql<number>`count(*)::int`}).from(crmLeads).leftJoin(crmCompanies,and(eq(crmLeads.companyId,crmCompanies.id),eq(crmLeads.organizationId,crmCompanies.organizationId))).leftJoin(crmContacts,and(eq(crmLeads.contactId,crmContacts.id),eq(crmLeads.organizationId,crmContacts.organizationId))).where(where)]);
  return {items:rows.map(r=>({...r.lead,companyName:r.companyName,contactName:r.contactName,ownerName:r.ownerName})),total:count[0]?.total??0,page,limit:20};
 }
 async detail(ctx:RequestContext,id:string){const [r]=await db.select({lead:crmLeads,companyName:crmCompanies.name,contactName:crmContacts.displayName,ownerName:user.name}).from(crmLeads).leftJoin(crmCompanies,and(eq(crmLeads.companyId,crmCompanies.id),eq(crmLeads.organizationId,crmCompanies.organizationId))).leftJoin(crmContacts,and(eq(crmLeads.contactId,crmContacts.id),eq(crmLeads.organizationId,crmContacts.organizationId))).leftJoin(member,and(eq(crmLeads.ownerMemberId,member.id),eq(crmLeads.organizationId,member.organizationId))).leftJoin(user,eq(member.userId,user.id)).where(this.scope(ctx,id));if(!r)throw new NotFoundException("Lead not found");return {...r.lead,companyName:r.companyName,contactName:r.contactName,ownerName:r.ownerName}}
 async create(ctx:RequestContext,dto:LeadInput){const v=this.values(dto);return db.transaction(async tx=>{await this.validate(ctx,v,tx);const [r]=await tx.insert(crmLeads).values({...v,id:randomUUID(),organizationId:ctx.organizationId}).returning();return r})}
 async update(ctx:RequestContext,id:string,dto:LeadInput){const v=this.values(dto);return db.transaction(async tx=>{await this.validate(ctx,v,tx);const [old]=await tx.select().from(crmLeads).where(and(this.scope(ctx,id),isNull(crmLeads.archivedAt))).for("update");if(!old||old.status==="converted")throw new ConflictException("Lead cannot be edited");if(old.companyId!==v.companyId||old.contactId!==v.contactId){const [activity]=await tx.select({id:crmActivities.id}).from(crmActivities).where(and(eq(crmActivities.organizationId,ctx.organizationId),eq(crmActivities.leadId,id))).limit(1);if(activity)throw new ConflictException("Cannot change associations after activity is recorded")}const [r]=await tx.update(crmLeads).set({...v,updatedAt:new Date()}).where(this.scope(ctx,id)).returning();return r})}
 async status(ctx:RequestContext,id:string,dto:LeadStatusInput){const reason=this.clean(dto.disqualifiedReason);if(dto.status==="disqualified"&&!reason)throw new BadRequestException("Disqualification reason is required");return db.transaction(async tx=>{const [old]=await tx.select().from(crmLeads).where(and(this.scope(ctx,id),isNull(crmLeads.archivedAt))).for("update");if(!old||old.status==="converted")throw new ConflictException("Lead cannot be updated");const [r]=await tx.update(crmLeads).set({status:dto.status,disqualifiedReason:dto.status==="disqualified"?reason:null,updatedAt:new Date()}).where(this.scope(ctx,id)).returning();return r})}
 async archive(ctx:RequestContext,id:string,archived:boolean){const [r]=await db.update(crmLeads).set({archivedAt:archived?new Date():null,updatedAt:new Date()}).where(this.scope(ctx,id)).returning();if(!r)throw new NotFoundException("Lead not found");return r}
}
