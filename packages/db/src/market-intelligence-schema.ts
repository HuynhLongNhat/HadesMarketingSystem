import { foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { organization, user } from "./schema.js";
import { aiTasks, aiTaskResearchSources } from "./tasks-schema.js";

export const MARKET_INTELLIGENCE_PROJECT_STATUSES = ["queued", "running", "completed", "failed", "cancelled"] as const;
export const MARKET_INTELLIGENCE_JOB_STEP_STATUSES = ["pending", "running", "completed", "failed", "skipped"] as const;
export const MARKET_INTELLIGENCE_SOURCE_KINDS = ["web", "facebook"] as const;
export const MARKET_INTELLIGENCE_SOURCE_STATUSES = ["pending", "retrieved", "permission_required", "unsupported", "unavailable", "failed"] as const;

export const marketIntelligenceProjects = pgTable("market_intelligence_projects", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }), taskId: text("task_id").notNull(),
  title: varchar("title", { length: 200 }).notNull(), industry: varchar("industry", { length: 200 }).notNull(), market: varchar("market", { length: 200 }).notNull(), targetAudience: varchar("target_audience", { length: 500 }), objective: text("objective").notNull(), keywords: jsonb("keywords").$type<string[]>().notNull().default([]), maxSources: integer("max_sources").notNull().default(8), researchProvider: varchar("research_provider", { length: 32 }).notNull().default("searxng"),
  status: varchar("status", { length: 16, enum: MARKET_INTELLIGENCE_PROJECT_STATUSES }).notNull().default("queued"),
  progressPercent: integer("progress_percent").notNull().default(0), currentStep: varchar("current_step", { length: 64 }), totalSteps: integer("total_steps").notNull().default(0), completedSteps: integer("completed_steps").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }), completedAt: timestamp("completed_at", { withTimezone: true }), lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }), attemptCount: integer("attempt_count").notNull().default(0), maxAttempts: integer("max_attempts").notNull().default(4), lastError: text("last_error"), executionTimeoutAt: timestamp("execution_timeout_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [foreignKey({ name: "market_intelligence_projects_task_org_fk", columns: [t.taskId, t.organizationId], foreignColumns: [aiTasks.id, aiTasks.organizationId] }).onDelete("restrict"), uniqueIndex("market_intelligence_projects_task_uq").on(t.taskId), index("market_intelligence_projects_org_updated_idx").on(t.organizationId, t.updatedAt)]);

export const marketIntelligenceJobSteps = pgTable("market_intelligence_job_steps", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }), projectId: text("project_id").notNull().references(() => marketIntelligenceProjects.id, { onDelete: "cascade" }),
  stepKey: varchar("step_key", { length: 64 }).notNull(), title: varchar("title", { length: 160 }).notNull(), weight: integer("weight").notNull(), sequence: integer("sequence").notNull(), status: varchar("status", { length: 16, enum: MARKET_INTELLIGENCE_JOB_STEP_STATUSES }).notNull().default("pending"), agentName: varchar("agent_name", { length: 160 }),
  startedAt: timestamp("started_at", { withTimezone: true }), completedAt: timestamp("completed_at", { withTimezone: true }), resultCount: integer("result_count"), safeError: text("safe_error"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  checkpointVersion: integer("checkpoint_version"), inputHash: varchar("input_hash", { length: 64 }),
  output: jsonb("output").$type<Record<string, unknown> | null>(),
  attemptCount: integer("attempt_count").notNull().default(0), reusedCount: integer("reused_count").notNull().default(0),
  safeErrorCode: varchar("safe_error_code", { length: 64 }), provider: varchar("provider", { length: 32 }),
}, (t) => [uniqueIndex("market_intelligence_job_steps_project_key_uq").on(t.projectId, t.stepKey), uniqueIndex("market_intelligence_job_steps_project_sequence_uq").on(t.projectId, t.sequence), index("market_intelligence_job_steps_org_project_idx").on(t.organizationId, t.projectId)]);

export const marketIntelligenceSourceConfigs = pgTable("market_intelligence_source_configs", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }), projectId: text("project_id").notNull().references(() => marketIntelligenceProjects.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 16, enum: MARKET_INTELLIGENCE_SOURCE_KINDS }).notNull(), url: varchar("url", { length: 2048 }).notNull(), status: varchar("status", { length: 24, enum: MARKET_INTELLIGENCE_SOURCE_STATUSES }).notNull().default("pending"), safeErrorCode: varchar("safe_error_code", { length: 128 }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("market_intelligence_source_configs_org_project_idx").on(t.organizationId, t.projectId), uniqueIndex("market_intelligence_source_configs_project_url_uq").on(t.projectId, t.url)]);

export const marketIntelligenceReports = pgTable("market_intelligence_reports", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }), projectId: text("project_id").notNull().references(() => marketIntelligenceProjects.id, { onDelete: "cascade" }), taskId: text("task_id").notNull(), content: text("content").notNull(), structuredReport: jsonb("structured_report").$type<Record<string, unknown> | null>(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [foreignKey({ name: "market_intelligence_reports_task_org_fk", columns: [t.taskId, t.organizationId], foreignColumns: [aiTasks.id, aiTasks.organizationId] }).onDelete("cascade"), uniqueIndex("market_intelligence_reports_project_uq").on(t.projectId), index("market_intelligence_reports_org_project_idx").on(t.organizationId, t.projectId)]);

export const marketIntelligenceFindings = pgTable("market_intelligence_findings", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }), projectId: text("project_id").notNull().references(() => marketIntelligenceProjects.id, { onDelete: "cascade" }), sourceId: text("source_id"),
  kind: varchar("kind", { length: 32 }).notNull(), statement: text("statement").notNull(), confidence: varchar("confidence", { length: 16 }).notNull().default("low"), evidenceCount: integer("evidence_count").notNull().default(1), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [foreignKey({ name: "market_intelligence_findings_source_fk", columns: [t.sourceId], foreignColumns: [aiTaskResearchSources.id] }).onDelete("set null"), index("market_intelligence_findings_org_project_idx").on(t.organizationId, t.projectId)]);

export type MarketIntelligenceProject = typeof marketIntelligenceProjects.$inferSelect;
export type MarketIntelligenceJobStep = typeof marketIntelligenceJobSteps.$inferSelect;
