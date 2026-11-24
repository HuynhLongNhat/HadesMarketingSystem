ALTER TABLE "crm_companies" ADD COLUMN "source" text, ADD COLUMN "lifecycle_stage" text, ADD COLUMN "owner_member_id" text, ADD COLUMN "industry" text, ADD COLUMN "employee_range" text, ADD COLUMN "tags" text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD COLUMN "source" text, ADD COLUMN "lifecycle_stage" text, ADD COLUMN "owner_member_id" text, ADD COLUMN "archived_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "crm_company_contacts" ADD COLUMN "job_title" text, ADD COLUMN "department" text, ADD COLUMN "relationship_role" text, ADD COLUMN "is_primary" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_lifecycle_check" CHECK ("lifecycle_stage" IN ('prospect','qualified','customer','former_customer'));
--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_lifecycle_check" CHECK ("lifecycle_stage" IN ('prospect','qualified','customer','former_customer'));
--> statement-breakpoint
CREATE UNIQUE INDEX "crm_company_contacts_primary_uq" ON "crm_company_contacts" ("organization_id","company_id") WHERE "is_primary";
