CREATE TABLE "crm_companies" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "tax_code" text,
  "website" text,
  "phone" text,
  "email" text,
  "address" text,
  "notes" text,
  "archived_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "crm_companies_id_org_uq" ON "crm_companies" ("id", "organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "crm_companies_org_tax_code_uq" ON "crm_companies" ("organization_id", "tax_code");
--> statement-breakpoint
CREATE INDEX "crm_companies_org_archived_updated_idx" ON "crm_companies" ("organization_id", "archived_at", "updated_at");
--> statement-breakpoint
CREATE TABLE "crm_company_contacts" (
  "company_id" text NOT NULL,
  "contact_id" text NOT NULL,
  "organization_id" text NOT NULL,
  CONSTRAINT "crm_company_contacts_company_org_fk" FOREIGN KEY ("company_id", "organization_id") REFERENCES "crm_companies"("id", "organization_id") ON DELETE CASCADE,
  CONSTRAINT "crm_company_contacts_contact_org_fk" FOREIGN KEY ("contact_id", "organization_id") REFERENCES "crm_contacts"("id", "organization_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "crm_company_contacts_org_company_contact_uq" ON "crm_company_contacts" ("organization_id", "company_id", "contact_id");
--> statement-breakpoint
CREATE INDEX "crm_company_contacts_org_contact_idx" ON "crm_company_contacts" ("organization_id", "contact_id");
