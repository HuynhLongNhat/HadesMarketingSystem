ALTER TABLE "ai_tasks" ADD COLUMN IF NOT EXISTS "agent_fallback_models" jsonb NOT NULL DEFAULT '[]'::jsonb;
