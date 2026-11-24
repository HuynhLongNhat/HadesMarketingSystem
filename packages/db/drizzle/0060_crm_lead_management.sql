ALTER TABLE "crm_leads" ALTER COLUMN "contact_id" DROP NOT NULL, ADD COLUMN "company_id" text, ADD COLUMN "title" text NOT NULL DEFAULT 'Lead chưa đặt tên', ADD COLUMN "description" text, ADD COLUMN "budget_min" numeric(18,2), ADD COLUMN "budget_max" numeric(18,2), ADD COLUMN "currency" text NOT NULL DEFAULT 'VND', ADD COLUMN "expected_start_date" date, ADD COLUMN "priority" text NOT NULL DEFAULT 'medium', ADD COLUMN "source" text, ADD COLUMN "owner_member_id" text, ADD COLUMN "disqualified_reason" text, ADD COLUMN "archived_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_company_org_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "crm_companies"("id","organization_id"), ADD CONSTRAINT "crm_leads_target_check" CHECK ("contact_id" IS NOT NULL OR "company_id" IS NOT NULL), ADD CONSTRAINT "crm_leads_budget_check" CHECK (("budget_min" IS NULL OR "budget_min">=0) AND ("budget_max" IS NULL OR "budget_max">=0) AND ("budget_min" IS NULL OR "budget_max" IS NULL OR "budget_min"<="budget_max"));
--> statement-breakpoint
CREATE INDEX "crm_leads_company_idx" ON "crm_leads" ("organization_id","company_id");
--> statement-breakpoint
ALTER TABLE "crm_activities" ADD COLUMN "lead_id" text, ADD CONSTRAINT "crm_activities_lead_org_fk" FOREIGN KEY ("lead_id","organization_id") REFERENCES "crm_leads"("id","organization_id");
--> statement-breakpoint
CREATE INDEX "crm_activities_lead_idx" ON "crm_activities" ("organization_id","lead_id","occurred_at");
