import type { WebhookRequest, WebhookResponse } from '@openhermit/protocol';

import type { VexaBridge } from './bridge.js';
import type { VexaWebhookEvent } from './types.js';
import { normalizeEvent } from './events.js';
import { verifyVexaSignature } from './signature.js';

const ack = (): WebhookResponse => ({
  status: 200,
  body: '{"ok":true}',
  headers: { 'content-type': 'application/json' },
});

/**
 * Receives Vexa webhooks forwarded by the gateway at
 * `POST /api/agents/:agentId/channels/vexa/webhook`. Verifies the signature,
 * acks immediately, and dispatches finalization asynchronously — Vexa retries
 * any non-2xx with backoff, so the response must not block on the agent turn.
 */
export class VexaWebhookReceiver {
  constructor(
    private readonly bridge: VexaBridge,
    private readonly webhookSecret: string,
    private readonly log: (message: string) => void,
    private readonly reportRuntimeError?: (error: string | null) => void,
  ) {}

  async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
    if (!verifyVexaSignature(req.rawBody, req.headers, this.webhookSecret)) {
      this.log('rejected webhook: signature verification failed');
      return { status: 401, body: 'unauthorized' };
    }

    let event: VexaWebhookEvent;
    try {
      event = JSON.parse(req.rawBody) as VexaWebhookEvent;
    } catch {
      return { status: 400, body: 'invalid json' };
    }

    // A verified, well-formed delivery proves the wiring works; clear any
    // stale error the channels UI may be showing.
    this.reportRuntimeError?.(null);

    const normalized = normalizeEvent(event);
    if (!normalized) {
      // Not a completion we act on (started, status_change != completed,
      // bot.failed, …): ack so Vexa stops retrying, and ignore.
      return ack();
    }

    void this.bridge.finalizeMeeting(normalized).catch((err) => {
      this.log(`finalize dispatch error: ${err instanceof Error ? err.message : String(err)}`);
    });
    return ack();
  }
}
