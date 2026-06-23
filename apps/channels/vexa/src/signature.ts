import { createHmac, timingSafeEqual } from 'node:crypto';

/** Constant-time string compare that tolerates length differences. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Keep timing roughly constant before failing on length mismatch.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/**
 * Verify a Vexa webhook delivery against the shared secret.
 *
 * Vexa (`meeting-api/webhook_delivery.build_headers`) sends, when a
 * `webhook_secret` is configured:
 *   - `Authorization: Bearer <secret>`
 *   - `X-Webhook-Signature: sha256=<hex>` — HMAC-SHA256 over
 *     `"<timestamp>." + rawBody` (timestamp from `X-Webhook-Timestamp`).
 *   - `X-Webhook-Timestamp: <unix seconds>`
 *
 * We prefer the HMAC signature (binds body + timestamp, defeats tampering);
 * when it is absent we fall back to a constant-time Bearer-token compare.
 */
export function verifyVexaSignature(
  rawBody: string,
  headers: Record<string, string>,
  secret: string,
): boolean {
  if (!secret) return false;

  const signature = headers['x-webhook-signature'];
  const timestamp = headers['x-webhook-timestamp'];
  if (signature && timestamp) {
    const expected =
      'sha256=' +
      createHmac('sha256', secret)
        .update(`${timestamp}.`)
        .update(rawBody)
        .digest('hex');
    return safeEqual(signature, expected);
  }

  const auth = headers['authorization'];
  if (auth) {
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : auth;
    return safeEqual(token, secret);
  }

  return false;
}
