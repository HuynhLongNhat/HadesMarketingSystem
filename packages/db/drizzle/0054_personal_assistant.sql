CREATE TABLE "assistant_conversations" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "title" varchar(160) NOT NULL DEFAULT 'Cuộc trò chuyện mới',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "assistant_conversations_owner_uq" UNIQUE ("id", "organization_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX "assistant_conversations_owner_updated_idx" ON "assistant_conversations" ("organization_id", "user_id", "updated_at");
--> statement-breakpoint
CREATE TABLE "assistant_turns" (
  "id" text PRIMARY KEY, "organization_id" text NOT NULL, "user_id" text NOT NULL,
  "conversation_id" text NOT NULL, "request_id" text NOT NULL, "sequence" integer NOT NULL,
  "user_content" text NOT NULL, "assistant_content" text NOT NULL DEFAULT '',
  "connection_id" text NOT NULL, "provider" text NOT NULL, "model_id" varchar(200) NOT NULL,
  "status" varchar(16) NOT NULL CHECK ("status" IN ('running', 'completed', 'failed', 'cancelled')),
  "execution_token" text, "lease_expires_at" timestamptz,
  "attempt_count" integer NOT NULL DEFAULT 1 CHECK ("attempt_count" BETWEEN 1 AND 3),
  "safe_error" text, "error_code" varchar(64), "input_tokens" integer, "output_tokens" integer, "total_tokens" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(), "completed_at" timestamptz,
  CONSTRAINT "assistant_turns_owner_fk" FOREIGN KEY ("conversation_id", "organization_id", "user_id")
    REFERENCES "assistant_conversations" ("id", "organization_id", "user_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_turns_request_uq" ON "assistant_turns" ("conversation_id", "request_id");
CREATE UNIQUE INDEX "assistant_turns_sequence_uq" ON "assistant_turns" ("conversation_id", "sequence");
CREATE UNIQUE INDEX "assistant_turns_one_running_uq" ON "assistant_turns" ("conversation_id") WHERE "status" = 'running';
CREATE INDEX "assistant_turns_owner_idx" ON "assistant_turns" ("organization_id", "user_id", "conversation_id");
