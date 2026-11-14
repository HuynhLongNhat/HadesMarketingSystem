ALTER TABLE "ceo_plans"
  ADD COLUMN "additional_context" text,
  ADD COLUMN "business_profile_snapshot" jsonb,
  ADD COLUMN "business_profile_snapshot_at" timestamp with time zone,
  ADD COLUMN "context_version" varchar(32);
