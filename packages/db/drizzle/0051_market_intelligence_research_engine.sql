-- Market Intelligence V1 evidence and request metadata. Existing Tasks and
-- reports remain readable; every addition is nullable or has a safe default.
-- 0047 was historically recorded in some development journals before every
-- Market Intelligence table was physically created. 0050 repairs projects and
-- steps; these guards complete the dependent baseline without altering a
-- healthy 0047 installation.
CREATE TABLE IF NOT EXISTS "market_intelligence_source_configs" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "project_id" text NOT NULL REFERENCES "market_intelligence_projects"("id") ON DELETE cascade,
  "kind" varchar(16) NOT NULL,
  "url" varchar(2048) NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'pending',
  "safe_error_code" varchar(128),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "market_intelligence_source_configs_project_url_uq" UNIQUE ("project_id", "url")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_intelligence_source_configs_org_project_idx" ON "market_intelligence_source_configs" ("organization_id", "project_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_intelligence_reports" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "project_id" text NOT NULL REFERENCES "market_intelligence_projects"("id") ON DELETE cascade,
  "task_id" text NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "market_intelligence_reports_project_uq" UNIQUE ("project_id"),
  CONSTRAINT "market_intelligence_reports_task_org_fk" FOREIGN KEY ("task_id", "organization_id") REFERENCES "ai_tasks"("id", "organization_id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_intelligence_reports_org_project_idx" ON "market_intelligence_reports" ("organization_id", "project_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_intelligence_findings" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "project_id" text NOT NULL REFERENCES "market_intelligence_projects"("id") ON DELETE cascade,
  "source_id" text REFERENCES "ai_task_research_sources"("id") ON DELETE set null,
  "kind" varchar(32) NOT NULL,
  "statement" text NOT NULL,
  "confidence" varchar(16) NOT NULL DEFAULT 'low',
  "evidence_count" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_intelligence_findings_org_project_idx" ON "market_intelligence_findings" ("organization_id", "project_id");
--> statement-breakpoint
ALTER TABLE "market_intelligence_projects" ADD COLUMN IF NOT EXISTS "target_audience" varchar(500);
ALTER TABLE "market_intelligence_projects" ADD COLUMN IF NOT EXISTS "max_sources" integer NOT NULL DEFAULT 8;
ALTER TABLE "market_intelligence_projects" ADD COLUMN IF NOT EXISTS "research_provider" varchar(32) NOT NULL DEFAULT 'searxng';
ALTER TABLE "market_intelligence_reports" ADD COLUMN IF NOT EXISTS "structured_report" jsonb;
ALTER TABLE "ai_task_research_sources" ADD COLUMN IF NOT EXISTS "extracted_content" text;
ALTER TABLE "ai_task_research_sources" ADD COLUMN IF NOT EXISTS "extraction_status" varchar(16) NOT NULL DEFAULT 'pending';
ALTER TABLE "ai_task_research_sources" ADD COLUMN IF NOT EXISTS "extraction_error" varchar(256);
--> statement-breakpoint
ALTER TABLE "market_intelligence_projects" ADD CONSTRAINT "market_intelligence_projects_max_sources_check" CHECK ("max_sources" >= 1 AND "max_sources" <= 20) NOT VALID;
--> statement-breakpoint
ALTER TABLE "market_intelligence_projects" VALIDATE CONSTRAINT "market_intelligence_projects_max_sources_check";
