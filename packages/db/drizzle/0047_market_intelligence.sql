CREATE TABLE "market_intelligence_projects" (
 "id" text PRIMARY KEY NOT NULL, "organization_id" text NOT NULL, "created_by" text NOT NULL, "task_id" text NOT NULL, "title" varchar(200) NOT NULL, "industry" varchar(200) NOT NULL, "market" varchar(200) NOT NULL, "objective" text NOT NULL, "keywords" jsonb DEFAULT '[]'::jsonb NOT NULL, "status" varchar(16) DEFAULT 'queued' NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_intelligence_source_configs" ("id" text PRIMARY KEY NOT NULL, "organization_id" text NOT NULL, "project_id" text NOT NULL, "kind" varchar(16) NOT NULL, "url" varchar(2048) NOT NULL, "status" varchar(24) DEFAULT 'pending' NOT NULL, "safe_error_code" varchar(128), "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE TABLE "market_intelligence_reports" ("id" text PRIMARY KEY NOT NULL, "organization_id" text NOT NULL, "project_id" text NOT NULL, "task_id" text NOT NULL, "content" text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE TABLE "market_intelligence_findings" ("id" text PRIMARY KEY NOT NULL, "organization_id" text NOT NULL, "project_id" text NOT NULL, "source_id" text, "kind" varchar(32) NOT NULL, "statement" text NOT NULL, "confidence" varchar(16) DEFAULT 'low' NOT NULL, "evidence_count" integer DEFAULT 1 NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
ALTER TABLE "market_intelligence_projects" ADD CONSTRAINT "market_intelligence_projects_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "market_intelligence_projects" ADD CONSTRAINT "market_intelligence_projects_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "market_intelligence_projects" ADD CONSTRAINT "market_intelligence_projects_task_org_fk" FOREIGN KEY ("task_id","organization_id") REFERENCES "public"."ai_tasks"("id","organization_id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "market_intelligence_source_configs" ADD CONSTRAINT "market_intelligence_source_configs_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "market_intelligence_source_configs" ADD CONSTRAINT "market_intelligence_source_configs_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."market_intelligence_projects"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "market_intelligence_reports" ADD CONSTRAINT "market_intelligence_reports_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "market_intelligence_reports" ADD CONSTRAINT "market_intelligence_reports_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."market_intelligence_projects"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "market_intelligence_reports" ADD CONSTRAINT "market_intelligence_reports_task_org_fk" FOREIGN KEY ("task_id","organization_id") REFERENCES "public"."ai_tasks"("id","organization_id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "market_intelligence_findings" ADD CONSTRAINT "market_intelligence_findings_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "market_intelligence_findings" ADD CONSTRAINT "market_intelligence_findings_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."market_intelligence_projects"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "market_intelligence_findings" ADD CONSTRAINT "market_intelligence_findings_source_fk" FOREIGN KEY ("source_id") REFERENCES "public"."ai_task_research_sources"("id") ON DELETE set null;--> statement-breakpoint
CREATE UNIQUE INDEX "market_intelligence_projects_task_uq" ON "market_intelligence_projects" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "market_intelligence_projects_org_updated_idx" ON "market_intelligence_projects" USING btree ("organization_id","updated_at");--> statement-breakpoint
CREATE INDEX "market_intelligence_source_configs_org_project_idx" ON "market_intelligence_source_configs" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "market_intelligence_source_configs_project_url_uq" ON "market_intelligence_source_configs" USING btree ("project_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "market_intelligence_reports_project_uq" ON "market_intelligence_reports" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "market_intelligence_findings_org_project_idx" ON "market_intelligence_findings" USING btree ("organization_id","project_id");
