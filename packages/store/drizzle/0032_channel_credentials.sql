CREATE TABLE "agent_channel_credentials" (
  "agent_id" text NOT NULL,
  "channel_type" text NOT NULL,
  "profile" text NOT NULL,
  "key" text NOT NULL,
  "value_ciphertext" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "agent_channel_credentials_agent_id_channel_type_profile_key_pk"
    PRIMARY KEY("agent_id", "channel_type", "profile", "key")
);

CREATE INDEX "idx_agent_channel_credentials_agent_channel"
  ON "agent_channel_credentials" ("agent_id", "channel_type");
