import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, ilike, isNull, isNotNull, or, sql } from "drizzle-orm";
import { db, crmCompanies, crmCompanyContacts, crmContacts, member } from "@workspace/db/node";
import { randomUUID } from "node:crypto";
import type { RequestContext } from "../../auth/request-context.js";
import type { CreateCompanyDto, UpdateCompanyDto, ListCompaniesDto, UpdateCompanyContactDto } from "./companies.dto.js";

@Injectable()
export class CompaniesService {
  private scope(ctx: RequestContext, id: string) {
    return and(eq(crmCompanies.organizationId, ctx.organizationId), eq(crmCompanies.id, id));
  }
  private async validateOwner(ctx: RequestContext, ownerMemberId?: string) {
    if (!ownerMemberId?.trim()) return;
    const [owner] = await db.select({id:member.id}).from(member).where(and(eq(member.id, ownerMemberId.trim()), eq(member.organizationId, ctx.organizationId))).limit(1);
    if (!owner) throw new BadRequestException("Owner must belong to the current organization");
  }
  private values(dto: UpdateCompanyDto) {
    const clean = (value: string | null | undefined) => value?.trim() || null;
    const name = dto.name === undefined ? undefined : clean(dto.name);
    if (name === null) throw new BadRequestException("Company name is required");
    return {
      ...(dto.source !== undefined ? { source: clean(dto.source) } : {}),
      ...(dto.lifecycleStage !== undefined ? { lifecycleStage: dto.lifecycleStage || null } : {}),
      ...(dto.ownerMemberId !== undefined ? { ownerMemberId: clean(dto.ownerMemberId) } : {}),
      ...(dto.industry !== undefined ? { industry: clean(dto.industry) } : {}),
      ...(dto.employeeRange !== undefined ? { employeeRange: clean(dto.employeeRange) } : {}),
      ...(dto.tags !== undefined ? { tags: [...new Set((dto.tags ?? []).map(t=>t.trim()).filter(Boolean))].slice(0,20) } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(dto.taxCode !== undefined ? { taxCode: clean(dto.taxCode) } : {}),
      ...(dto.website !== undefined ? { website: clean(dto.website) } : {}),
      ...(dto.phone !== undefined ? { phone: clean(dto.phone) } : {}),
      ...(dto.email !== undefined ? { email: clean(dto.email)?.toLowerCase() ?? null } : {}),
      ...(dto.address !== undefined ? { address: clean(dto.address) } : {}),
      ...(dto.notes !== undefined ? { notes: clean(dto.notes) } : {}),
    };
  }
  private handleWriteError(error: unknown): never {
    const e = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
    const cause = e.cause ?? e;
    if (cause.code === "23505" && cause.constraint === "crm_companies_org_tax_code_uq") throw new ConflictException("Tax code already exists in this organization");
    throw error;
  }
  async list(ctx: RequestContext, query: ListCompaniesDto) {
    const conditions = [eq(crmCompanies.organizationId, ctx.organizationId)];
    if (query.status === "archived") conditions.push(isNotNull(crmCompanies.archivedAt));
    else if (query.status !== "all") conditions.push(isNull(crmCompanies.archivedAt));
    if(query.lifecycleStage) conditions.push(eq(crmCompanies.lifecycleStage,query.lifecycleStage));
    if (query.search?.trim()) {
      const term = "%" + query.search.trim().replace(/[\\%_]/g, "\\$&") + "%";
      conditions.push(or(ilike(crmCompanies.name, term), ilike(crmCompanies.taxCode, term), ilike(crmCompanies.email, term), ilike(crmCompanies.phone, term))!);
    }
    const page = query.page ?? 1, limit = query.limit ?? 20;
    const where = and(...conditions);
    const [items, count] = await Promise.all([
      db.select().from(crmCompanies).where(where).orderBy(desc(crmCompanies.updatedAt), desc(crmCompanies.id)).limit(limit).offset((page - 1) * limit),
      db.select({ count: sql<number>`count(*)::int` }).from(crmCompanies).where(where),
    ]);
    return { items, page, limit, total: count[0]?.count ?? 0 };
  }
  private async get(ctx: RequestContext, id: string) {
    const [company] = await db.select().from(crmCompanies).where(this.scope(ctx, id)).limit(1);
    if (!company) throw new NotFoundException("Company not found");
    return company;
  }
  async detail(ctx: RequestContext, id: string) {
    const company = await this.get(ctx, id);
    const contacts = await db.select({ id: crmContacts.id, displayName: crmContacts.displayName, email: crmContacts.email, phone: crmContacts.phone, archivedAt: crmContacts.archivedAt, jobTitle: crmCompanyContacts.jobTitle, department: crmCompanyContacts.department, relationshipRole: crmCompanyContacts.relationshipRole, isPrimary: crmCompanyContacts.isPrimary })
      .from(crmCompanyContacts).innerJoin(crmContacts, and(eq(crmCompanyContacts.contactId, crmContacts.id), eq(crmCompanyContacts.organizationId, crmContacts.organizationId)))
      .where(and(eq(crmCompanyContacts.organizationId, ctx.organizationId), eq(crmCompanyContacts.companyId, id)));
    return { ...company, contacts };
  }
  async create(ctx: RequestContext, dto: CreateCompanyDto) {
    await this.validateOwner(ctx, dto.ownerMemberId);
    try {
      const [company] = await db.insert(crmCompanies).values({ ...this.values(dto), id: randomUUID(), organizationId: ctx.organizationId, name: dto.name.trim() }).returning();
      return company;
    } catch (error) { this.handleWriteError(error); }
  }
  async update(ctx: RequestContext, id: string, dto: UpdateCompanyDto) {
    await this.validateOwner(ctx, dto.ownerMemberId);
    try {
      const [company] = await db.update(crmCompanies).set({ ...this.values(dto), updatedAt: new Date() })
        .where(and(this.scope(ctx, id), isNull(crmCompanies.archivedAt))).returning();
      if (!company) throw new NotFoundException("Active company not found");
      return company;
    } catch (error) { this.handleWriteError(error); }
  }
  async archive(ctx: RequestContext, id: string, archived: boolean) {
    const [company] = await db.update(crmCompanies).set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() }).where(this.scope(ctx, id)).returning();
    if (!company) throw new NotFoundException("Company not found");
    return company;
  }
  async link(ctx: RequestContext, id: string, contactId: string) {
    return db.transaction(async (tx) => {
      const [company] = await tx.select().from(crmCompanies).where(and(this.scope(ctx, id), isNull(crmCompanies.archivedAt))).for("update");
      if (!company) throw new NotFoundException("Active company not found");
      const [contact] = await tx.select({ id: crmContacts.id }).from(crmContacts).where(and(eq(crmContacts.id, contactId), eq(crmContacts.organizationId, ctx.organizationId), isNull(crmContacts.archivedAt))).for("update");
      if (!contact) throw new NotFoundException("Contact not found");
      await tx.insert(crmCompanyContacts).values({ organizationId: ctx.organizationId, companyId: id, contactId }).onConflictDoNothing();
      return { success: true };
    });
  }
  async updateContact(ctx: RequestContext, id: string, contactId: string, dto: UpdateCompanyContactDto) {
    return db.transaction(async tx => {
      const [company] = await tx.select({id:crmCompanies.id}).from(crmCompanies).where(and(this.scope(ctx,id),isNull(crmCompanies.archivedAt))).for("update");
      if (!company) throw new NotFoundException("Active company not found");
      const scope = and(eq(crmCompanyContacts.organizationId,ctx.organizationId),eq(crmCompanyContacts.companyId,id));
      const target = and(scope,eq(crmCompanyContacts.contactId,contactId));
      const [existing] = await tx.select().from(crmCompanyContacts).where(target);
      if (!existing) throw new NotFoundException("Contact link not found");
      if (dto.isPrimary === true) await tx.update(crmCompanyContacts).set({isPrimary:false}).where(scope);
      const [updated] = await tx.update(crmCompanyContacts).set({
        jobTitle: dto.jobTitle === undefined ? existing.jobTitle : dto.jobTitle?.trim() || null,
        department: dto.department === undefined ? existing.department : dto.department?.trim() || null,
        relationshipRole: dto.relationshipRole === undefined ? existing.relationshipRole : dto.relationshipRole?.trim() || null,
        isPrimary: dto.isPrimary ?? existing.isPrimary,
      }).where(target).returning();
      return updated;
    });
  }
  async unlink(ctx: RequestContext, id: string, contactId: string) {
    return db.transaction(async (tx) => {
      const [company] = await tx.select().from(crmCompanies).where(and(this.scope(ctx, id), isNull(crmCompanies.archivedAt))).for("update");
      if (!company) throw new NotFoundException("Active company not found");
      await tx.delete(crmCompanyContacts).where(and(eq(crmCompanyContacts.organizationId, ctx.organizationId), eq(crmCompanyContacts.companyId, id), eq(crmCompanyContacts.contactId, contactId)));
      return { success: true };
    });
  }
}
