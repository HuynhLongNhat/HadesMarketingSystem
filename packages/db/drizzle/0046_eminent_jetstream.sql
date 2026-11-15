ALTER TABLE "ceo_plan_reviews" ADD COLUMN "reviewer_agent_id" text;--> statement-breakpoint
ALTER TABLE "ceo_plan_reviews" ADD COLUMN "reviewer_agent_name" text;--> statement-breakpoint
ALTER TABLE "ceo_plan_reviews" ADD COLUMN "reviewer_agent_role" text;--> statement-breakpoint
ALTER TABLE "ceo_plan_reviews" ADD CONSTRAINT "ceo_plan_reviews_reviewer_agent_id_ai_agents_id_fk" FOREIGN KEY ("reviewer_agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ceo_plan_reviews_org_reviewer_created_idx" ON "ceo_plan_reviews" USING btree ("organization_id","reviewer_agent_id","created_at");