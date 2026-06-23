/** Runtime config persisted on the Vexa channel row (`agent_channels.config`). */
export interface VexaRuntimeConfig {
  enabled?: boolean;
  /**
   * Shared secret authenticating Vexa -> OpenHermit webhook deliveries. Set
   * the SAME value in Vexa via `PUT /user/webhook` (`webhook_secret`). Stored
   * here as the `${{VEXA_WEBHOOK_SECRET}}` placeholder and expanded from the
   * agent secret store at start.
   */
  webhook_secret?: string;
}
