ALTER TABLE "departments" ADD COLUMN "lead_agent_id" text;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_lead_agent_fk" FOREIGN KEY ("lead_agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE set null;--> statement-breakpoint
CREATE TABLE "department_task_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "department_id" text NOT NULL,
  "created_by" text NOT NULL,
  "title" varchar(200) NOT NULL,
  "input" text NOT NULL,
  "status" varchar(16) DEFAULT 'queued' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE "department_task_steps" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "run_id" text NOT NULL,
  "sequence" integer NOT NULL,
  "task_id" text NOT NULL,
  "agent_id" text,
  "agent_name" text,
  "role" text NOT NULL,
  "status" varchar(16) DEFAULT 'queued' NOT NULL,
  "input" text NOT NULL,
  "output" text,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "department_task_runs" ADD CONSTRAINT "department_task_runs_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "department_task_runs" ADD CONSTRAINT "department_task_runs_department_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "department_task_runs" ADD CONSTRAINT "department_task_runs_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "department_task_steps" ADD CONSTRAINT "department_task_steps_run_fk" FOREIGN KEY ("run_id") REFERENCES "public"."department_task_runs"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "department_task_steps" ADD CONSTRAINT "department_task_steps_task_fk" FOREIGN KEY ("task_id") REFERENCES "public"."ai_tasks"("id") ON DELETE restrict;--> statement-breakpoint
CREATE INDEX "department_task_runs_org_department_updated_idx" ON "department_task_runs" USING btree ("organization_id","department_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "department_task_steps_task_uq" ON "department_task_steps" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "department_task_steps_run_sequence_uq" ON "department_task_steps" USING btree ("run_id","sequence");
