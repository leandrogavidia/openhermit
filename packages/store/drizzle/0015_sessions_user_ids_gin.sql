-- GIN index on sessions.user_ids supports `WHERE user_ids @> '["..."]'`
-- containment lookups used to find every session a given user has touched.
-- Without it the planner falls back to a full table scan once `sessions`
-- grows large.
CREATE INDEX IF NOT EXISTS "idx_sessions_user_ids_gin"
  ON "sessions" USING gin ("user_ids");
