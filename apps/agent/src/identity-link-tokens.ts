import { randomBytes } from 'node:crypto';

interface PendingLink {
  userId: string;
  channel: string;
  channelUserId: string;
  expiresAt: number;
}

const TOKEN_TTL_MS = 10 * 60 * 1000;
const GC_INTERVAL_MS = 60 * 1000;

const pending = new Map<string, PendingLink>();

let gcTimer: NodeJS.Timeout | undefined;

function ensureGc(): void {
  if (gcTimer) return;
  gcTimer = setInterval(() => {
    const now = Date.now();
    for (const [token, link] of pending) {
      if (link.expiresAt <= now) pending.delete(token);
    }
  }, GC_INTERVAL_MS);
  gcTimer.unref?.();
}

function makeToken(): string {
  // 8 chars, URL/chat-friendly, ~40 bits of entropy
  return randomBytes(5).toString('base64url').slice(0, 8);
}

export interface IssuedLinkToken {
  token: string;
  expiresAt: string;
}

export function issueLinkToken(params: {
  userId: string;
  channel: string;
  channelUserId: string;
}): IssuedLinkToken {
  ensureGc();
  let token = makeToken();
  while (pending.has(token)) token = makeToken();
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  pending.set(token, {
    userId: params.userId,
    channel: params.channel,
    channelUserId: params.channelUserId,
    expiresAt,
  });
  return { token, expiresAt: new Date(expiresAt).toISOString() };
}

export function consumeLinkToken(token: string): PendingLink | undefined {
  const link = pending.get(token);
  if (!link) return undefined;
  pending.delete(token);
  if (link.expiresAt <= Date.now()) return undefined;
  return link;
}
