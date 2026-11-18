-- Additive: legacy progress remains visible; missing checkpoints are rebuilt.
ALTER TABLE "market_intelligence_job_steps"
  ADD COLUMN "checkpoint_version" integer,
  ADD COLUMN "input_hash" varchar(64),
  ADD COLUMN "output" jsonb,
  ADD COLUMN "attempt_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN "reused_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN "safe_error_code" varchar(64),
  ADD COLUMN "provider" varchar(32);
--> statement-breakpoint
ALTER TABLE "market_intelligence_job_steps"
  ADD CONSTRAINT "market_research_checkpoint_counts_check"
  CHECK ("attempt_count" >= 0 AND "reused_count" >= 0);
