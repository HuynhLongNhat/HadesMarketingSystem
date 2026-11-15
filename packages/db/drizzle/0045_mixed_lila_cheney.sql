CREATE TABLE "business_doctrines" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text NOT NULL,
	"title" text NOT NULL,
	"principles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_doctrines" ADD CONSTRAINT "business_doctrines_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_doctrines" ADD CONSTRAINT "business_doctrines_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_doctrines_org_created_idx" ON "business_doctrines" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "business_doctrines_org_version_uq" ON "business_doctrines" USING btree ("organization_id","version");