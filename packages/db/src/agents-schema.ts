import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization, user } from "./schema.js";
import { aiProviderConnections } from "./ai-schema.js";
import { aiTasks } from "./tasks-schema.js";

export const AGENT_STATUSES = [
  "draft",
  "active",
  "paused",
  "archived",
] as const;

export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AGENT_CATEGORIES = [
  "marketing",
  "sales",
  "support",
  "research",
  "operations",
  "other",
] as const;

export type AgentCategory = (typeof AGENT_CATEGORIES)[number];

export type AgentToolConfig = {
  enabledTools: string[];
  fallbackModels?: string[];
};

export const departments = pgTable(
  "departments",
  {
    id: text("id").primaryKey(),

    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, {
        onDelete: "cascade",
      }),

    name: text("name").notNull(),

    slug: text("slug").notNull(),

    description: text("description"),

    // The service validates this Agent belongs to the same Organization and
    // Department; the database FK is added by the compatible migration.
    leadAgentId: text("lead_agent_id"),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("departments_org_slug_unique").on(
      table.organizationId,
      table.slug,
    ),

    uniqueIndex("departments_id_org_unique").on(table.id, table.organizationId),

    index("departments_org_idx").on(table.organizationId),
  ],
);

export const agentTemplates = pgTable(
  "agent_templates",
  {
    id: text("id").primaryKey(),

    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),

    name: text("name").notNull(),

    slug: text("slug").notNull(),

    category: text("category", {
      enum: AGENT_CATEGORIES,
    })
      .notNull()
      .default("other"),

    description: text("description"),

    systemPrompt: text("system_prompt").notNull(),

    version: text("version").notNull().default("1.0.0"),

    isPublished: boolean("is_published").notNull().default(false),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("agent_templates_org_idx").on(table.organizationId),

    index("agent_templates_category_idx").on(table.category),

    uniqueIndex("agent_templates_id_org_unique").on(
      table.id,
      table.organizationId,
    ),
  ],
);

export const aiAgents = pgTable(
  "ai_agents",
  {
    id: text("id").primaryKey(),

    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, {
        onDelete: "cascade",
      }),

    departmentId: text("department_id"),

    templateId: text("template_id"),

    name: text("name").notNull(),

    description: text("description"),

    role: text("role").notNull(),

    status: text("status", {
      enum: AGENT_STATUSES,
    })
      .notNull()
      .default("draft"),

    systemPrompt: text("system_prompt").notNull(),

    connectionId: text("connection_id"),

    modelId: text("model_id"),

    toolConfig: jsonb("tool_config")
      .$type<AgentToolConfig>()
      .notNull()
      .default({ enabledTools: [] }),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "ai_agents_department_org_fk",
      columns: [table.departmentId, table.organizationId],
      foreignColumns: [departments.id, departments.organizationId],
    }).onDelete("restrict"),

    foreignKey({
      name: "ai_agents_connection_fk",
      columns: [table.connectionId],
      foreignColumns: [aiProviderConnections.id],
    }).onDelete("set null"),

    index("ai_agents_org_idx").on(table.organizationId),

    index("ai_agents_org_status_idx").on(table.organizationId, table.status),

    index("ai_agents_department_idx").on(table.departmentId),

    index("ai_agents_template_idx").on(table.templateId),
  ],
);

export const DEPARTMENT_TASK_RUN_STATUSES = ["queued", "running", "completed", "failed", "cancelled"] as const;
export const departmentTaskRuns = pgTable("department_task_runs", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull(), departmentId: text("department_id").notNull(), createdBy: text("created_by").notNull(), title: text("title").notNull(), input: text("input").notNull(), status: text("status", { enum: DEPARTMENT_TASK_RUN_STATUSES }).notNull().default("queued"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(), completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [foreignKey({ name:"department_task_runs_org_fk", columns:[t.organizationId], foreignColumns:[organization.id] }).onDelete("cascade"), foreignKey({ name:"department_task_runs_department_fk", columns:[t.departmentId], foreignColumns:[departments.id] }).onDelete("restrict"), foreignKey({ name:"department_task_runs_created_by_fk", columns:[t.createdBy], foreignColumns:[user.id] }).onDelete("restrict"), index("department_task_runs_org_department_updated_idx").on(t.organizationId,t.departmentId,t.updatedAt)]);
export const departmentTaskSteps = pgTable("department_task_steps", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull(), runId: text("run_id").notNull(), sequence: integer("sequence").notNull(), taskId: text("task_id").notNull(), agentId: text("agent_id"), agentName: text("agent_name"), role: text("role").notNull(), status: text("status", { enum: DEPARTMENT_TASK_RUN_STATUSES }).notNull().default("queued"), input: text("input").notNull(), output: text("output"), error: text("error"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(), completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [foreignKey({ name:"department_task_steps_run_fk",columns:[t.runId],foreignColumns:[departmentTaskRuns.id] }).onDelete("cascade"), foreignKey({ name:"department_task_steps_task_fk",columns:[t.taskId],foreignColumns:[aiTasks.id] }).onDelete("restrict"), uniqueIndex("department_task_steps_task_uq").on(t.taskId), uniqueIndex("department_task_steps_run_sequence_uq").on(t.runId,t.sequence), index("department_task_steps_org_run_idx").on(t.organizationId,t.runId)]);

export type Department = typeof departments.$inferSelect;

export type NewDepartment = typeof departments.$inferInsert;

export type AgentTemplate = typeof agentTemplates.$inferSelect;

export type NewAgentTemplate = typeof agentTemplates.$inferInsert;

export type AiAgent = typeof aiAgents.$inferSelect;

export type NewAiAgent = typeof aiAgents.$inferInsert;
export type DepartmentTaskRun = typeof departmentTaskRuns.$inferSelect;
export type DepartmentTaskStep = typeof departmentTaskSteps.$inferSelect;
