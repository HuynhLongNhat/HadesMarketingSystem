CREATE TABLE "assistant_task_links" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL,
  "user_id" text NOT NULL,
  "conversation_id" text NOT NULL,
  "request_id" text NOT NULL,
  "request_hash" text NOT NULL,
  "task_id" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  FOREIGN KEY ("conversation_id", "organization_id", "user_id") REFERENCES "assistant_conversations" ("id", "organization_id", "user_id") ON DELETE CASCADE,
  FOREIGN KEY ("task_id", "organization_id") REFERENCES "ai_tasks" ("id", "organization_id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_task_links_request_uq" ON "assistant_task_links" ("conversation_id", "request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_task_links_task_uq" ON "assistant_task_links" ("task_id");
--> statement-breakpoint
CREATE INDEX "assistant_task_links_owner_idx" ON "assistant_task_links" ("organization_id", "user_id", "created_at");
