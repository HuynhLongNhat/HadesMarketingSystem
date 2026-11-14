ALTER TABLE "ceo_plans" ADD COLUMN "structured_plan" jsonb;--> statement-breakpoint
ALTER TABLE "ceo_plans" ADD COLUMN "structured_plan_version" varchar(32);
