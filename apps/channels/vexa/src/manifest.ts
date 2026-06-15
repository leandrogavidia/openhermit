/**
 * Channel plugin manifest for Vexa meeting transcription.
 *
 * Loaded by the gateway when `@openhermit/channel-vexa` is listed under
 * `channelPackages` in gateway config. See `docs/channel-plugin-design.md`
 * and `docs/vexa-meetings.md`.
 *
 * Unlike conversational channels this adapter has no outbound surface and no
 * background loop: it only exposes a `handleWebhook` that the gateway routes
 * Vexa events to. A finished meeting triggers an owner-scoped agent turn that
 * captures the transcript into memory via the `vexa-meetings` skill + the Vexa
 * MCP tools (`mcp__vexa__*`).
 */
import type { ChannelManifest } from '@openhermit/protocol';

import { VexaBridge } from './bridge.js';
import { VexaWebhookReceiver } from './bot.js';
import type { VexaRuntimeConfig } from './config.js';

const manifest: ChannelManifest = {
  manifestVersion: 1,
  key: 'vexa',
  namespace: 'vexa',
  displayName: 'Vexa Meetings',

  secretKeys: [
    {
      key: 'VEXA_WEBHOOK_SECRET',
      label: 'Vexa webhook secret',
      placeholder: 'shared secret you configure in Vexa (PUT /user/webhook)',
    },
  ],

  configFields: [
    {
      kind: 'webhook_url',
      label: 'Webhook URL',
      help:
        'Configure this URL in Vexa (PUT /user/webhook with your webhook_secret) so finished ' +
        'meetings are captured into memory automatically.',
    },
  ],

  defaultConfig: {
    enabled: true,
    webhook_secret: '${{VEXA_WEBHOOK_SECRET}}',
  },

  start: async (rawConfig, context) => {
    const config = (rawConfig ?? {}) as VexaRuntimeConfig;
    const log = (msg: string): void => context.logger('vexa', msg);

    const webhookSecret = (config.webhook_secret ?? '').trim();
    // An empty value or an unexpanded placeholder means the agent secret isn't
    // set yet — disable until configured (mirrors Signal's missing-credential
    // behaviour). The webhook handler also refuses unauthenticated requests.
    if (!webhookSecret || webhookSecret.includes('${{')) {
      log('VEXA_WEBHOOK_SECRET not set — channel disabled until the secret is configured');
      return undefined;
    }

    const token = context.agentTokens['vexa'] ?? '';
    const bridge = new VexaBridge({ baseUrl: context.agentBaseUrl, token }, log);
    const receiver = new VexaWebhookReceiver(bridge, webhookSecret, log, context.reportRuntimeError);

    log('vexa meeting-capture channel ready (webhook mode)');
    return {
      name: 'vexa',
      stop: async () => {
        // Webhook-only: the gateway owns the HTTP route; nothing to tear down.
      },
      handleWebhook: (req) => receiver.handleWebhook(req),
    };
  },
};

export default manifest;
