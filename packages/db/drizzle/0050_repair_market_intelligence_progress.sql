-- Repair-safe baseline for environments where the older 0047 journal entry
-- exists but its Market Intelligence tables were not actually applied.
CREATE TABLE IF NOT EXISTS "market_intelligence_projects" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "created_by" text NOT NULL REFERENCES "user"("id") ON DELETE restrict,
  "task_id" text NOT NULL,
  "title" varchar(200) NOT NULL,
  "industry" varchar(200) NOT NULL,
  "market" varchar(200) NOT NULL,
  "objective" text NOT NULL,
  "keywords" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" varchar(16) NOT NULL DEFAULT 'queued',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "market_intelligence_projects" ADD COLUMN IF NOT EXISTS "progress_percent" integer NOT NULL DEFAULT 0;
ALTER TABLE "market_intelligence_projects" ADD COLUMN IF NOT EXISTS "current_step" varchar(64);
ALTER TABLE "market_intelligence_projects" ADD COLUMN IF NOT EXISTS "total_steps" integer NOT NULL DEFAULT 0;
ALTER TABLE "market_intelligence_projects" ADD COLUMN IF NOT EXISTS "completed_steps" integer NOT NULL DEFAULT 0;
ALTER TABLE "market_intelligence_projects" ADD COLUMN IF NOT EXISTS "started_at" timestamptz;
ALTER TABLE "market_intelligence_projects" ADD COLUMN IF NOT EXISTS "completed_at" timestamptz;
ALTER TABLE "market_intelligence_projects" ADD COLUMN IF NOT EXISTS "last_heartbeat_at" timestamptz;
ALTER TABLE "market_intelligence_projects" ADD COLUMN IF NOT EXISTS "attempt_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "market_intelligence_projects" ADD COLUMN IF NOT EXISTS "max_attempts" integer NOT NULL DEFAULT 4;
ALTER TABLE "market_intelligence_projects" ADD COLUMN IF NOT EXISTS "last_error" text;
ALTER TABLE "market_intelligence_projects" ADD COLUMN IF NOT EXISTS "execution_timeout_at" timestamptz;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "market_intelligence_projects" ADD CONSTRAINT "market_intelligence_projects_task_org_fk" FOREIGN KEY ("task_id", "organization_id") REFERENCES "ai_tasks"("id", "organization_id") ON DELETE restrict;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "market_intelligence_projects_task_uq" ON "market_intelligence_projects" ("task_id");
CREATE INDEX IF NOT EXISTS "market_intelligence_projects_org_updated_idx" ON "market_intelligence_projects" ("organization_id", "updated_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_intelligence_job_steps" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "project_id" text NOT NULL REFERENCES "market_intelligence_projects"("id") ON DELETE cascade,
  "step_key" varchar(64) NOT NULL,
  "title" varchar(160) NOT NULL,
  "weight" integer NOT NULL,
  "sequence" integer NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'pending',
  "agent_name" varchar(160),
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "result_count" integer,
  "safe_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "market_intelligence_job_steps_project_key_uq" UNIQUE ("project_id", "step_key"),
  CONSTRAINT "market_intelligence_job_steps_project_sequence_uq" UNIQUE ("project_id", "sequence")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_intelligence_job_steps_org_project_idx" ON "market_intelligence_job_steps" ("organization_id", "project_id");
