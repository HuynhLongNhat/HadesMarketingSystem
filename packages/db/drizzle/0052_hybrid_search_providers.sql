-- Hybrid Search Phase 1. SearXNG is self-hosted and intentionally needs no
-- credential; Tavily and Brave credentials remain encrypted per organization.
ALTER TABLE "search_provider_connections" ALTER COLUMN "encrypted_api_key" DROP NOT NULL;
ALTER TABLE "search_provider_connections" ALTER COLUMN "key_iv" DROP NOT NULL;
ALTER TABLE "search_provider_connections" ALTER COLUMN "key_auth_tag" DROP NOT NULL;
ALTER TABLE "search_provider_connections" ADD COLUMN IF NOT EXISTS "priority" integer NOT NULL DEFAULT 100;
ALTER TABLE "search_provider_connections" ADD COLUMN IF NOT EXISTS "consecutive_failures" integer NOT NULL DEFAULT 0;
ALTER TABLE "search_provider_connections" ADD COLUMN IF NOT EXISTS "circuit_open_until" timestamptz;
--> statement-breakpoint
ALTER TABLE "search_provider_connections" ADD CONSTRAINT "search_provider_connections_priority_check" CHECK ("priority" >= 1 AND "priority" <= 1000) NOT VALID;
--> statement-breakpoint
ALTER TABLE "search_provider_connections" VALIDATE CONSTRAINT "search_provider_connections_priority_check";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_provider_connections_org_enabled_priority_idx" ON "search_provider_connections" ("organization_id", "enabled", "priority", "created_at");
