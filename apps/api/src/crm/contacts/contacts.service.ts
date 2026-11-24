import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, ilike, isNull, isNotNull, or, sql } from "drizzle-orm";
import { db, conversations, crmChannelIdentities, crmContacts, crmConversationContacts, crmCompanyContacts, crmCompanies, member } from "@workspace/db/node";
import { randomUUID } from "node:crypto";
import type { RequestContext } from "../../auth/request-context.js";
import type { CreateContactDto, ListContactsQueryDto, UpdateContactDto } from "./contacts.dto.js";

@Injectable()
export class ContactsService {
  private async validateOwner(ctx: RequestContext, ownerMemberId?: string) {
    if (!ownerMemberId?.trim()) return;
    const [owner] = await db.select({id:member.id}).from(member).where(and(eq(member.id, ownerMemberId.trim()), eq(member.organizationId, ctx.organizationId))).limit(1);
    if (!owner) throw new BadRequestException("Owner must belong to the current organization");
  }
  private clean(value: string | undefined, max: number) { const result = value?.trim(); return result ? result.slice(0, max) : null; }
  private tags(tags: string[] | undefined) { return [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))].slice(0, 20); }
  private values(dto: CreateContactDto | UpdateContactDto) {
    const displayName = dto.displayName === undefined ? undefined : this.clean(dto.displayName, 200);
    if (dto.displayName !== undefined && !displayName) throw new BadRequestException("Contact name cannot be empty");
    return { ...(dto.source !== undefined ? {source:this.clean(dto.source,120)} : {}), ...(dto.lifecycleStage !== undefined ? {lifecycleStage:dto.lifecycleStage || null} : {}), ...(dto.ownerMemberId !== undefined ? {ownerMemberId:this.clean(dto.ownerMemberId,128)} : {}), ...(displayName !== undefined ? { displayName } : {}), ...(dto.phone !== undefined ? { phone: this.clean((dto.phone ?? "").replace(/[^+\d\s().-]/g, ""), 40) } : {}), ...(dto.email !== undefined ? { email: this.clean((dto.email ?? "").toLowerCase(), 320) } : {}), ...(dto.notes !== undefined ? { notes: this.clean(dto.notes, 2000) } : {}), ...(dto.tags !== undefined ? { tags: this.tags(dto.tags) } : {}) };
  }
  async list(ctx: RequestContext, query: ListContactsQueryDto) {
    const conditions = [eq(crmContacts.organizationId, ctx.organizationId)];
    if(query.status==="archived") conditions.push(isNotNull(crmContacts.archivedAt)); else if(query.status!=="all") conditions.push(isNull(crmContacts.archivedAt));
    if (query.search?.trim()) { const term = `%${query.search.trim().replace(/[\\%_]/g, "\\$&")}%`; conditions.push(or(ilike(crmContacts.displayName, term), ilike(crmContacts.phone, term), ilike(crmContacts.email, term))!); }
    if (query.tag?.trim()) conditions.push(sql`${query.tag.trim()} = ANY(${crmContacts.tags})`);
    const page = query.page ?? 1, limit = query.limit ?? 20;
    const order = query.sort === "name" ? asc(crmContacts.displayName) : query.sort === "created" ? desc(crmContacts.createdAt) : desc(crmContacts.updatedAt);
    const [items, count] = await Promise.all([db.select().from(crmContacts).where(and(...conditions)).orderBy(order, desc(crmContacts.id)).limit(limit).offset((page - 1) * limit), db.select({ count: sql<number>`count(*)::int` }).from(crmContacts).where(and(...conditions))]);
    return { items, page, limit, total: count[0]?.count ?? 0 };
  }
  async get(ctx: RequestContext, id: string) { const [contact] = await db.select().from(crmContacts).where(and(eq(crmContacts.organizationId, ctx.organizationId), eq(crmContacts.id, id))).limit(1); if (!contact) throw new NotFoundException("Contact not found"); return contact; }
  async create(ctx: RequestContext, dto: CreateContactDto) { await this.validateOwner(ctx,dto.ownerMemberId); const values = this.values(dto); const [contact] = await db.insert(crmContacts).values({ id: randomUUID(), organizationId: ctx.organizationId, ...values }).returning(); return contact; }
  async update(ctx: RequestContext, id: string, dto: UpdateContactDto) { await this.validateOwner(ctx,dto.ownerMemberId); const [contact] = await db.update(crmContacts).set({ ...this.values(dto), updatedAt: new Date() }).where(and(eq(crmContacts.organizationId, ctx.organizationId), eq(crmContacts.id, id),isNull(crmContacts.archivedAt))).returning(); if(!contact) throw new NotFoundException("Active contact not found"); return contact; }
  async archive(ctx:RequestContext,id:string,archived:boolean) { const [contact]=await db.update(crmContacts).set({archivedAt:archived?new Date():null,updatedAt:new Date()}).where(and(eq(crmContacts.organizationId,ctx.organizationId),eq(crmContacts.id,id))).returning(); if(!contact) throw new NotFoundException("Contact not found"); return contact; }
  async remove(ctx:RequestContext,id:string) { await this.archive(ctx,id,true); return {success:true,id}; }
  async duplicates(ctx:RequestContext,email?:string,phone?:string,excludeId?:string) {
    const normalizedEmail=email?.trim().toLowerCase(), normalizedPhone=phone?.replace(/[^0-9]/g,"");
    const terms=[]; if(normalizedEmail) terms.push(eq(sql<string>`lower(trim(${crmContacts.email}))`,normalizedEmail)); if(normalizedPhone) terms.push(eq(sql<string>`regexp_replace(${crmContacts.phone}, '[^0-9]', '', 'g')`,normalizedPhone));
    if(!terms.length) return [];
    return db.select({id:crmContacts.id,displayName:crmContacts.displayName,archivedAt:crmContacts.archivedAt}).from(crmContacts).where(and(eq(crmContacts.organizationId,ctx.organizationId),or(...terms),excludeId?sql`${crmContacts.id} <> ${excludeId}`:undefined)).limit(20);
  }
  async detail(ctx: RequestContext, id: string) { const contact = await this.get(ctx, id); const [identities, linked] = await Promise.all([db.select().from(crmChannelIdentities).where(and(eq(crmChannelIdentities.organizationId, ctx.organizationId), eq(crmChannelIdentities.contactId, id))), db.select({ id: conversations.id, status: conversations.status, createdAt: conversations.createdAt, updatedAt: conversations.updatedAt }).from(crmConversationContacts).innerJoin(conversations, and(eq(crmConversationContacts.conversationId, conversations.id), eq(crmConversationContacts.organizationId, conversations.organizationId))).where(and(eq(crmConversationContacts.organizationId, ctx.organizationId), eq(crmConversationContacts.contactId, id))).orderBy(desc(conversations.updatedAt))]); const companies = await db.select({id:crmCompanies.id,name:crmCompanies.name,jobTitle:crmCompanyContacts.jobTitle,department:crmCompanyContacts.department,relationshipRole:crmCompanyContacts.relationshipRole,isPrimary:crmCompanyContacts.isPrimary}).from(crmCompanyContacts).innerJoin(crmCompanies,and(eq(crmCompanyContacts.companyId,crmCompanies.id),eq(crmCompanyContacts.organizationId,crmCompanies.organizationId))).where(and(eq(crmCompanyContacts.organizationId,ctx.organizationId),eq(crmCompanyContacts.contactId,id))); return { ...contact, identities, conversations: linked, companies }; }
  async link(ctx: RequestContext, conversationId: string, contactId: string) { const contact=await this.get(ctx, contactId); if(contact.archivedAt) throw new ConflictException("Contact is archived"); const [conversation] = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.organizationId, ctx.organizationId), eq(conversations.id, conversationId))).limit(1); if (!conversation) throw new NotFoundException("Conversation not found"); const [existing] = await db.select().from(crmConversationContacts).where(and(eq(crmConversationContacts.organizationId, ctx.organizationId), eq(crmConversationContacts.conversationId, conversationId))).limit(1); if (existing && existing.contactId !== contactId) throw new ConflictException("Conversation is already linked to another contact"); if (existing) return existing; const [link] = await db.insert(crmConversationContacts).values({ organizationId: ctx.organizationId, conversationId, contactId, linkedByUserId: ctx.userId }).returning(); return link; }
  async unlink(ctx: RequestContext, conversationId: string) { const [deleted] = await db.delete(crmConversationContacts).where(and(eq(crmConversationContacts.organizationId, ctx.organizationId), eq(crmConversationContacts.conversationId, conversationId))).returning(); if (!deleted) throw new NotFoundException("Contact link not found"); return { success: true }; }
  async conversationContact(ctx: RequestContext, conversationId: string) { const [row] = await db.select({ link: crmConversationContacts, contact: crmContacts }).from(crmConversationContacts).innerJoin(crmContacts, and(eq(crmConversationContacts.contactId, crmContacts.id), eq(crmConversationContacts.organizationId, crmContacts.organizationId))).where(and(eq(crmConversationContacts.organizationId, ctx.organizationId), eq(crmConversationContacts.conversationId, conversationId))).limit(1); return row ?? null; }
}
