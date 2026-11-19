import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { assistantConversations } from "./assistant-schema.js";
import { aiTasks } from "./tasks-schema.js";

// Deleting a conversation removes the link, never the independently running task.
export const assistantTaskLinks = pgTable(
  "assistant_task_links",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    userId: text("user_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    requestId: text("request_id").notNull(),
    requestHash: text("request_hash").notNull(),
    taskId: text("task_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.conversationId, t.organizationId, t.userId],
      foreignColumns: [
        assistantConversations.id,
        assistantConversations.organizationId,
        assistantConversations.userId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.taskId, t.organizationId],
      foreignColumns: [aiTasks.id, aiTasks.organizationId],
    }).onDelete("restrict"),
    uniqueIndex("assistant_task_links_request_uq").on(
      t.conversationId,
      t.requestId,
    ),
    uniqueIndex("assistant_task_links_task_uq").on(t.taskId),
    index("assistant_task_links_owner_idx").on(
      t.organizationId,
      t.userId,
      t.createdAt,
    ),
  ],
);
