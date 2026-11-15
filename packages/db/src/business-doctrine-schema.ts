import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organization, user } from "./schema.js";

export const businessDoctrines = pgTable("business_doctrines", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  principles: jsonb("principles").$type<string[]>().notNull().default([]),
  version: integer("version").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("business_doctrines_org_created_idx").on(table.organizationId, table.createdAt), uniqueIndex("business_doctrines_org_version_uq").on(table.organizationId, table.version)]);
export type BusinessDoctrine = typeof businessDoctrines.$inferSelect;
