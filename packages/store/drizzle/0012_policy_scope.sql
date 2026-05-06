ALTER TABLE "agent_policies" ADD COLUMN "scope" jsonb NOT NULL DEFAULT '{}';

-- Migrate existing sandbox_alias/mode into scope
UPDATE "agent_policies"
SET "scope" = jsonb_strip_nulls(jsonb_build_object(
  'sandboxAlias', "sandbox_alias",
  'mode', "mode"
))
WHERE "sandbox_alias" IS NOT NULL OR "mode" IS NOT NULL;

-- Drop old unique index
DROP INDEX IF EXISTS "uq_agent_policies_resource";

-- Deduplicate before creating stricter unique index
DELETE FROM "agent_policies" a
USING "agent_policies" b
WHERE a.agent_id = b.agent_id
  AND a.resource_type = b.resource_type
  AND a.resource_key = b.resource_key
  AND a.updated_at < b.updated_at;

-- Drop old columns
ALTER TABLE "agent_policies" DROP COLUMN "sandbox_alias";
ALTER TABLE "agent_policies" DROP COLUMN "mode";

-- New unique index
CREATE UNIQUE INDEX "uq_agent_policies_resource"
  ON "agent_policies" ("agent_id", "resource_type", "resource_key");
