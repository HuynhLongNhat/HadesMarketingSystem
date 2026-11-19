import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization, user } from "./schema.js";

export const ASSISTANT_TURN_STATUSES = [
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export const assistantConversations = pgTable(
  "assistant_conversations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 160 })
      .notNull()
      .default("Cuộc trò chuyện mới"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("assistant_conversations_owner_uq").on(
      t.id,
      t.organizationId,
      t.userId,
    ),
    index("assistant_conversations_owner_updated_idx").on(
      t.organizationId,
      t.userId,
      t.updatedAt,
    ),
  ],
);

// A turn stores one user message and its response. Retry reuses this row and
// request ID; these conversations never enter the customer-support inbox.
export const assistantTurns = pgTable(
  "assistant_turns",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    userId: text("user_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    requestId: text("request_id").notNull(),
    sequence: integer("sequence").notNull(),
    userContent: text("user_content").notNull(),
    assistantContent: text("assistant_content").notNull().default(""),
    connectionId: text("connection_id").notNull(),
    provider: text("provider").notNull(),
    modelId: varchar("model_id", { length: 200 }).notNull(),
    status: varchar("status", {
      length: 16,
      enum: ASSISTANT_TURN_STATUSES,
    }).notNull(),
    executionToken: text("execution_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(1),
    safeError: text("safe_error"),
    errorCode: varchar("error_code", { length: 64 }),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "assistant_turns_owner_fk",
      columns: [t.conversationId, t.organizationId, t.userId],
      foreignColumns: [
        assistantConversations.id,
        assistantConversations.organizationId,
        assistantConversations.userId,
      ],
    }).onDelete("cascade"),
    uniqueIndex("assistant_turns_request_uq").on(t.conversationId, t.requestId),
    uniqueIndex("assistant_turns_sequence_uq").on(t.conversationId, t.sequence),
    uniqueIndex("assistant_turns_one_running_uq")
      .on(t.conversationId)
      .where(sql`${t.status} = 'running'`),
    index("assistant_turns_owner_idx").on(
      t.organizationId,
      t.userId,
      t.conversationId,
    ),
    check(
      "assistant_turns_status_check",
      sql`${t.status} in ('running', 'completed', 'failed', 'cancelled')`,
    ),
    check(
      "assistant_turns_attempt_check",
      sql`${t.attemptCount} between 1 and 3`,
    ),
  ],
);
export type AssistantConversation = typeof assistantConversations.$inferSelect;
export type AssistantTurn = typeof assistantTurns.$inferSelect;
