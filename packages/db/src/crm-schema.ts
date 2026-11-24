import {
  boolean,
  date,
  numeric,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { sql } from "drizzle-orm";
import { conversations, organization, user } from "./schema.js";

export const CRM_LIFECYCLE_STAGES = ["prospect", "qualified", "customer", "former_customer"] as const;
export const CRM_CHANNEL_TYPES = [
  "widget",
  "zalo_oa",
  "facebook_messenger",
] as const;

export type CrmChannelType = (typeof CRM_CHANNEL_TYPES)[number];

export const CRM_LEAD_STATUSES = [
  "new",
  "attempting",
  "connected",
  "qualified",
  "disqualified",
  "converted",
] as const;

export type CrmLeadStatus = (typeof CRM_LEAD_STATUSES)[number];

/** A customer record. It is deliberately separate from Better Auth users and widget sessions. */
export const crmContacts = pgTable(
  "crm_contacts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    source: text("source"),
    lifecycleStage: text("lifecycle_stage", { enum: CRM_LIFECYCLE_STAGES }),
    ownerMemberId: text("owner_member_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    displayName: text("display_name"),
    phone: text("phone"),
    email: text("email"),
    avatarUrl: text("avatar_url"),
    notes: text("notes"),
    tags: text("tags").array().notNull().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("crm_contacts_lifecycle_check", sql`${table.lifecycleStage} IN (\'prospect\',\'qualified\',\'customer\',\'former_customer\')`),
    index("crm_contacts_org_updated_idx").on(table.organizationId, table.updatedAt),
    index("crm_contacts_org_email_idx").on(table.organizationId, table.email),
    index("crm_contacts_org_phone_idx").on(table.organizationId, table.phone),
    uniqueIndex("crm_contacts_id_org_uq").on(table.id, table.organizationId),
  ],
);

/**
 * A verified identity on one customer channel. `channelConnectionId` is scoped
 * to an organization; `default` represents the organization's website widget.
 */
export const crmChannelIdentities = pgTable(
  "crm_channel_identities",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id").notNull(),
    channelType: text("channel_type", { enum: CRM_CHANNEL_TYPES }).notNull(),
    channelConnectionId: text("channel_connection_id").notNull().default("default"),
    externalUserId: text("external_user_id").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "crm_channel_identities_contact_org_fk",
      columns: [table.contactId, table.organizationId],
      foreignColumns: [crmContacts.id, crmContacts.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("crm_channel_identity_external_uq").on(
      table.organizationId,
      table.channelType,
      table.channelConnectionId,
      table.externalUserId,
    ),
    index("crm_channel_identities_contact_idx").on(table.organizationId, table.contactId),
    uniqueIndex("crm_channel_identities_id_org_uq").on(table.id, table.organizationId),
  ],
);

/** Links legacy and future conversations to a CRM contact without guessing historic identities. */
export const crmConversationContacts = pgTable(
  "crm_conversation_contacts",
  {
    conversationId: text("conversation_id").notNull(),
    organizationId: text("organization_id").notNull(),
    contactId: text("contact_id").notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
    linkedByUserId: text("linked_by_user_id").references(() => user.id, { onDelete: "set null" }),
  },
  (table) => [
    foreignKey({
      name: "crm_conversation_contacts_conversation_org_fk",
      columns: [table.conversationId, table.organizationId],
      foreignColumns: [conversations.id, conversations.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "crm_conversation_contacts_contact_org_fk",
      columns: [table.contactId, table.organizationId],
      foreignColumns: [crmContacts.id, crmContacts.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("crm_conversation_contacts_conversation_org_uq").on(
      table.conversationId,
      table.organizationId,
    ),
    index("crm_conversation_contacts_contact_idx").on(table.organizationId, table.contactId),
  ],
);

/** A sales need is explicit: no lead is auto-created from an inbound message. */
export type CrmContact = typeof crmContacts.$inferSelect;
export type NewCrmContact = typeof crmContacts.$inferInsert;
export type CrmChannelIdentity = typeof crmChannelIdentities.$inferSelect;
export type NewCrmChannelIdentity = typeof crmChannelIdentities.$inferInsert;
export type CrmLead = typeof crmLeads.$inferSelect;
export type NewCrmLead = typeof crmLeads.$inferInsert;

export const crmCompanies = pgTable("crm_companies", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
    source: text("source"),
    lifecycleStage: text("lifecycle_stage", { enum: CRM_LIFECYCLE_STAGES }),
    ownerMemberId: text("owner_member_id"),
  industry: text("industry"),
  employeeRange: text("employee_range"),
  tags: text("tags").array().notNull().default([]),
  taxCode: text("tax_code"),
  website: text("website"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  notes: text("notes"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("crm_companies_lifecycle_check", sql`${table.lifecycleStage} IN (\'prospect\',\'qualified\',\'customer\',\'former_customer\')`),
  uniqueIndex("crm_companies_id_org_uq").on(table.id, table.organizationId),
  uniqueIndex("crm_companies_org_tax_code_uq").on(table.organizationId, table.taxCode),
  index("crm_companies_org_archived_updated_idx").on(table.organizationId, table.archivedAt, table.updatedAt),
]);

export const crmCompanyContacts = pgTable("crm_company_contacts", {
  companyId: text("company_id").notNull(),
  jobTitle: text("job_title"),
  department: text("department"),
  relationshipRole: text("relationship_role"),
  isPrimary: boolean("is_primary").notNull().default(false),
  contactId: text("contact_id").notNull(),
  organizationId: text("organization_id").notNull(),
}, (table) => [
  foreignKey({ name: "crm_company_contacts_company_org_fk", columns: [table.companyId, table.organizationId], foreignColumns: [crmCompanies.id, crmCompanies.organizationId] }).onDelete("cascade"),
  foreignKey({ name: "crm_company_contacts_contact_org_fk", columns: [table.contactId, table.organizationId], foreignColumns: [crmContacts.id, crmContacts.organizationId] }).onDelete("cascade"),
  uniqueIndex("crm_company_contacts_primary_uq").on(table.organizationId,table.companyId).where(sql`${table.isPrimary}`),
  uniqueIndex("crm_company_contacts_org_company_contact_uq").on(table.organizationId, table.companyId, table.contactId),
  index("crm_company_contacts_org_contact_idx").on(table.organizationId, table.contactId),
]);

export type CrmCompany = typeof crmCompanies.$inferSelect;

export const crmLeads = pgTable(
  "crm_leads",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id"),
    companyId: text("company_id"),
    title: text("title").notNull().default("Lead chưa đặt tên"),
    description: text("description"),
    budgetMin: numeric("budget_min",{precision:18,scale:2}),
    budgetMax: numeric("budget_max",{precision:18,scale:2}),
    currency: text("currency").notNull().default("VND"),
    expectedStartDate: date("expected_start_date"),
    priority: text("priority",{enum:["low","medium","high"]}).notNull().default("medium"),
    source: text("source"),
    ownerMemberId: text("owner_member_id"),
    disqualifiedReason: text("disqualified_reason"),
    archivedAt: timestamp("archived_at",{withTimezone:true}),
    sourceChannel: text("source_channel", { enum: CRM_CHANNEL_TYPES }),
    status: text("status", { enum: CRM_LEAD_STATUSES }).notNull().default("new"),
    ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "crm_leads_contact_org_fk",
      columns: [table.contactId, table.organizationId],
      foreignColumns: [crmContacts.id, crmContacts.organizationId],
    }).onDelete("cascade"),
    foreignKey({name:"crm_leads_company_org_fk",columns:[table.companyId,table.organizationId],foreignColumns:[crmCompanies.id,crmCompanies.organizationId]}),
    check("crm_leads_target_check",sql`${table.contactId} IS NOT NULL OR ${table.companyId} IS NOT NULL`),
    check("crm_leads_budget_check",sql`(${table.budgetMin} IS NULL OR ${table.budgetMin} >= 0) AND (${table.budgetMax} IS NULL OR ${table.budgetMax} >= 0) AND (${table.budgetMin} IS NULL OR ${table.budgetMax} IS NULL OR ${table.budgetMin} <= ${table.budgetMax})`),
    index("crm_leads_company_idx").on(table.organizationId,table.companyId),
    index("crm_leads_org_status_updated_idx").on(table.organizationId, table.status, table.updatedAt),
    index("crm_leads_org_contact_idx").on(table.organizationId, table.contactId),
    index("crm_leads_org_owner_idx").on(table.organizationId, table.ownerUserId),
    uniqueIndex("crm_leads_id_org_uq").on(table.id, table.organizationId),
  ],
);

export const CRM_ACTIVITY_TYPES = ["note","call","meeting","email","message"] as const;
export const crmActivities = pgTable("crm_activities", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(()=>organization.id,{onDelete:"cascade"}),
  companyId: text("company_id"),
  contactId: text("contact_id"),
  leadId: text("lead_id"),
  type: text("type",{enum:CRM_ACTIVITY_TYPES}).notNull(),
  subject: text("subject").notNull(),
  body: text("body"),
  outcome: text("outcome"),
  occurredAt: timestamp("occurred_at",{withTimezone:true}).notNull(),
  createdByUserId: text("created_by_user_id").references(()=>user.id,{onDelete:"set null"}),
  createdAt: timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
  updatedAt: timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
  archivedAt: timestamp("archived_at",{withTimezone:true}),
}, table=>[
  check("crm_activities_target_check",sql`${table.companyId} IS NOT NULL OR ${table.contactId} IS NOT NULL`),
  check("crm_activities_type_check",sql`${table.type} IN ('note','call','meeting','email','message')`),
  foreignKey({name:"crm_activities_company_org_fk",columns:[table.companyId,table.organizationId],foreignColumns:[crmCompanies.id,crmCompanies.organizationId]}),
  foreignKey({name:"crm_activities_contact_org_fk",columns:[table.contactId,table.organizationId],foreignColumns:[crmContacts.id,crmContacts.organizationId]}),
  foreignKey({name:"crm_activities_lead_org_fk",columns:[table.leadId,table.organizationId],foreignColumns:[crmLeads.id,crmLeads.organizationId]}),
  index("crm_activities_lead_idx").on(table.organizationId,table.leadId,table.occurredAt),
  index("crm_activities_company_idx").on(table.organizationId,table.companyId,table.occurredAt),
  index("crm_activities_contact_idx").on(table.organizationId,table.contactId,table.occurredAt),
]);
export type CrmActivity = typeof crmActivities.$inferSelect;
