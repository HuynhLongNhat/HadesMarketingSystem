CREATE TABLE "ceo_plan_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"task_id" text NOT NULL,
	"created_by" text NOT NULL,
	"provider_connection_id" text NOT NULL,
	"model_id" text NOT NULL,
	"plan_version" varchar(32),
	"report" jsonb,
	"report_version" varchar(32),
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ceo_plan_reviews" ADD CONSTRAINT "ceo_plan_reviews_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ceo_plan_reviews" ADD CONSTRAINT "ceo_plan_reviews_plan_id_ceo_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."ceo_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ceo_plan_reviews" ADD CONSTRAINT "ceo_plan_reviews_task_id_ai_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."ai_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ceo_plan_reviews" ADD CONSTRAINT "ceo_plan_reviews_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ceo_plan_reviews_task_unique" ON "ceo_plan_reviews" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "ceo_plan_reviews_org_plan_created_idx" ON "ceo_plan_reviews" USING btree ("organization_id","plan_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ceo_plan_reviews_id_org_unique" ON "ceo_plan_reviews" USING btree ("id","organization_id");