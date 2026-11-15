import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, max } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { businessDoctrines, db } from "@workspace/db/node";
import type { RequestContext } from "../auth/request-context.js";
import type { CreateBusinessDoctrineDto, ToggleBusinessDoctrineDto } from "./business-doctrine.dto.js";
@Injectable()
export class BusinessDoctrineService {
  list(ctx: RequestContext) { return db.select().from(businessDoctrines).where(eq(businessDoctrines.organizationId, ctx.organizationId)).orderBy(desc(businessDoctrines.version)); }
  async create(ctx: RequestContext, dto: CreateBusinessDoctrineDto) { const title=dto.title.trim(); const principles=[...new Set(dto.principles.map(x=>x.trim()).filter(Boolean))]; if(!title||!principles.length) throw new BadRequestException("Tên và ít nhất một nguyên tắc là bắt buộc."); const [current]=await db.select({ value:max(businessDoctrines.version) }).from(businessDoctrines).where(eq(businessDoctrines.organizationId,ctx.organizationId)); if(dto.enabled!==false) await db.update(businessDoctrines).set({enabled:false}).where(eq(businessDoctrines.organizationId,ctx.organizationId)); const [created]=await db.insert(businessDoctrines).values({id:randomUUID(),organizationId:ctx.organizationId,createdBy:ctx.userId,title,principles,version:(current?.value??0)+1,enabled:dto.enabled!==false}).returning(); return created!; }
  async toggle(ctx: RequestContext,id:string,dto:ToggleBusinessDoctrineDto){if(dto.enabled) await db.update(businessDoctrines).set({enabled:false}).where(eq(businessDoctrines.organizationId,ctx.organizationId));const [updated]=await db.update(businessDoctrines).set({enabled:dto.enabled}).where(and(eq(businessDoctrines.id,id),eq(businessDoctrines.organizationId,ctx.organizationId))).returning();if(!updated)throw new NotFoundException("Không tìm thấy phiên bản triết lý.");return updated;}
}
