import { createHmac, timingSafeEqual } from 'node:crypto';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify an inbound Vexa webhook against the configured shared secret.
 *
 * Vexa's exact webhook auth shape is not fully pinned in the public docs, so
 * we accept either mode — both compared in constant time:
 *   1. shared-secret bearer:  `Authorization: Bearer <secret>`
 *   2. body HMAC-SHA256:      `Authorization: Bearer <hex>` or
 *                             `X-Vexa-Signature` / `X-Webhook-Signature` /
 *                             `X-Hub-Signature-256: sha256=<hex>`
 *
 * Returns false when no secret is configured — the channel never accepts an
 * unauthenticated webhook (an unauthenticated POST could otherwise trigger an
 * owner-scoped agent turn).
 */
export function verifyVexaSignature(
  rawBody: string,
  headers: Record<string, string>,
  secret: string,
): boolean {
  if (!secret) return false;

  const candidates: string[] = [];
  const auth = headers['authorization'];
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    candidates.push(match && match[1] ? match[1].trim() : auth.trim());
  }
  for (const header of ['x-vexa-signature', 'x-webhook-signature', 'x-hub-signature-256']) {
    const value = headers[header];
    if (value) candidates.push(value.trim().replace(/^sha256=/i, ''));
  }
  if (candidates.length === 0) return false;

  const computed = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  for (const candidate of candidates) {
    if (safeEqual(candidate, secret)) return true; // shared-secret bearer mode
    if (safeEqual(candidate.toLowerCase(), computed)) return true; // HMAC mode
  }
  return false;
}
