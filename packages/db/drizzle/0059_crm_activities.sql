CREATE TABLE "crm_activities" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "company_id" text,
  "contact_id" text,
  "type" text NOT NULL,
  "subject" text NOT NULL,
  "body" text,
  "outcome" text,
  "occurred_at" timestamptz NOT NULL,
  "created_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "archived_at" timestamptz,
  CONSTRAINT "crm_activities_target_check" CHECK ("company_id" IS NOT NULL OR "contact_id" IS NOT NULL),
  CONSTRAINT "crm_activities_type_check" CHECK ("type" IN ('note','call','meeting','email','message')),
  CONSTRAINT "crm_activities_company_org_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "crm_companies"("id","organization_id"),
  CONSTRAINT "crm_activities_contact_org_fk" FOREIGN KEY ("contact_id","organization_id") REFERENCES "crm_contacts"("id","organization_id")
);
--> statement-breakpoint
CREATE INDEX "crm_activities_company_idx" ON "crm_activities" ("organization_id","company_id","occurred_at");
--> statement-breakpoint
CREATE INDEX "crm_activities_contact_idx" ON "crm_activities" ("organization_id","contact_id","occurred_at");
