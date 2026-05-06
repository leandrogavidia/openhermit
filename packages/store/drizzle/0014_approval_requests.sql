CREATE TABLE "approval_requests" (
  "id"            TEXT PRIMARY KEY,
  "agent_id"      TEXT NOT NULL,
  "session_id"    TEXT NOT NULL,
  "requester_id"  TEXT NOT NULL,
  "resource_type" TEXT NOT NULL,
  "resource_key"  TEXT NOT NULL,
  "scope"         JSONB NOT NULL DEFAULT '{}',
  "status"        TEXT NOT NULL DEFAULT 'pending',
  "resolution"    TEXT,
  "resolved_by"   TEXT,
  "reason"        TEXT,
  "created_at"    TEXT NOT NULL,
  "resolved_at"   TEXT,
  "ttl_minutes"   INTEGER NOT NULL DEFAULT 60
);

CREATE INDEX "idx_approval_requests_agent" ON "approval_requests" ("agent_id", "status");
CREATE INDEX "idx_approval_requests_lookup" ON "approval_requests" ("agent_id", "requester_id", "resource_type", "resource_key", "status");
