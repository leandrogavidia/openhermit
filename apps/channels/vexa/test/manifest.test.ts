import assert from 'node:assert/strict';
import { test } from 'node:test';

import manifest from '../src/manifest.js';

test('manifest exposes the required plugin contract', () => {
  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.key, 'vexa');
  assert.equal(manifest.namespace, 'vexa');
  assert.equal(manifest.displayName, 'Vexa Meetings');
  assert.equal(typeof manifest.start, 'function');
  assert.ok(manifest.secretKeys?.some((s) => s.key === 'VEXA_WEBHOOK_SECRET'));
});

test('start() without the webhook secret returns undefined (channel disabled)', async () => {
  const log: string[] = [];
  const handle = await manifest.start(
    { enabled: true, webhook_secret: '${{VEXA_WEBHOOK_SECRET}}' }, // unexpanded placeholder
    {
      agentBaseUrl: 'http://gateway/api/agents/x',
      publicAgentBaseUrl: 'http://gateway/api/agents/x',
      agentTokens: { vexa: 'tok' },
      logger: (_ch, msg) => log.push(msg),
      reportRuntimeError: () => {},
    },
  );
  assert.equal(handle, undefined);
  assert.ok(
    log.some((m) => m.toUpperCase().includes('VEXA_WEBHOOK_SECRET')),
    `expected a "secret not set" log, got: ${log.join(' | ')}`,
  );
});

test('start() with a secret returns a webhook-only handle', async () => {
  const handle = await manifest.start(
    { enabled: true, webhook_secret: 'real-secret' },
    {
      agentBaseUrl: 'http://gateway/api/agents/x',
      publicAgentBaseUrl: 'http://gateway/api/agents/x',
      agentTokens: { vexa: 'tok' },
      logger: () => {},
      reportRuntimeError: () => {},
    },
  );
  assert.ok(handle, 'handle should be defined');
  assert.equal(handle?.name, 'vexa');
  assert.equal(typeof handle?.handleWebhook, 'function');
  assert.equal(handle?.outbound, undefined);
  await handle?.stop();
});
