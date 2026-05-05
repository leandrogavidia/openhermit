CREATE TABLE IF NOT EXISTS "agent_policies" (
  "id" TEXT PRIMARY KEY,
  "agent_id" TEXT NOT NULL,
  "sandbox_alias" TEXT,
  "resource_type" TEXT NOT NULL,
  "mode" TEXT,
  "resource_key" TEXT NOT NULL,
  "grants" JSONB NOT NULL DEFAULT '[]',
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);

CREATE INDEX "idx_agent_policies_agent_type"
  ON "agent_policies" ("agent_id", "resource_type");

CREATE UNIQUE INDEX "uq_agent_policies_resource"
  ON "agent_policies" (
    "agent_id",
    COALESCE("sandbox_alias", ''),
    "resource_type",
    COALESCE("mode", ''),
    "resource_key"
  );
