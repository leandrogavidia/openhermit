/**
 * Persisted runtime config for the Vexa channel. The webhook secret is
 * referenced via the `${{VEXA_WEBHOOK_SECRET}}` placeholder in the manifest's
 * `defaultConfig`; the gateway expands it against the agent's secret store
 * before `start()` is called.
 */
export interface VexaRuntimeConfig {
  enabled?: boolean;
  /** Shared secret used to verify inbound Vexa webhooks. */
  webhook_secret?: string;
}
