import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';

import {
  DbChannelCredentialStore,
  runMigrations,
} from '@openhermit/store';

if (!process.env.OPENHERMIT_SECRETS_KEY) {
  process.env.OPENHERMIT_SECRETS_KEY = randomBytes(32).toString('base64');
}

async function openStore(t: import('node:test').TestContext) {
  await runMigrations();
  const store = await DbChannelCredentialStore.open();
  t.after(() => store.close());
  return store;
}

const uniqueAgent = (): string =>
  `test-channel-creds-${randomUUID().slice(0, 8)}`;

test('DbChannelCredentialStore: set/get/list/delete round-trips encrypted values', async (t) => {
  const store = await openStore(t);
  const agentId = uniqueAgent();

  await store.set(agentId, 'whatsapp', 'default', 'creds', 'secret-creds');
  await store.set(agentId, 'whatsapp', 'default', 'key:session:jid', 'secret-session');

  assert.equal(
    await store.get(agentId, 'whatsapp', 'default', 'creds'),
    'secret-creds',
  );
  assert.deepEqual(await store.list(agentId, 'whatsapp', 'default'), {
    creds: 'secret-creds',
    'key:session:jid': 'secret-session',
  });

  await store.delete(agentId, 'whatsapp', 'default', 'creds');
  assert.equal(await store.get(agentId, 'whatsapp', 'default', 'creds'), undefined);
});

test('DbChannelCredentialStore: replace clears stale profile keys', async (t) => {
  const store = await openStore(t);
  const agentId = uniqueAgent();

  await store.set(agentId, 'whatsapp', 'default', 'stale', 'old');
  await store.replace(agentId, 'whatsapp', 'default', { fresh: 'new' });

  assert.deepEqual(await store.list(agentId, 'whatsapp', 'default'), { fresh: 'new' });
});

test('DbChannelCredentialStore: scopes by agent, channel type, and profile', async (t) => {
  const store = await openStore(t);
  const agentA = uniqueAgent();
  const agentB = uniqueAgent();

  await store.set(agentA, 'whatsapp', 'default', 'creds', 'a-whatsapp');
  await store.set(agentA, 'signal', 'default', 'creds', 'a-signal');
  await store.set(agentA, 'whatsapp', 'setup:1', 'creds', 'a-setup');
  await store.set(agentB, 'whatsapp', 'default', 'creds', 'b-whatsapp');

  assert.deepEqual(await store.list(agentA, 'whatsapp', 'default'), { creds: 'a-whatsapp' });
  assert.deepEqual(await store.list(agentA, 'signal', 'default'), { creds: 'a-signal' });
  assert.deepEqual(await store.list(agentA, 'whatsapp', 'setup:1'), { creds: 'a-setup' });
  assert.deepEqual(await store.list(agentB, 'whatsapp', 'default'), { creds: 'b-whatsapp' });
});

test('DbChannelCredentialStore.scoped exposes profile/key-only channel interface', async (t) => {
  const store = await openStore(t);
  const agentId = uniqueAgent();
  const scoped = store.scoped(agentId, 'whatsapp');

  await scoped.set('default', 'creds', 'one');
  await scoped.replace('setup:1', { creds: 'two' });
  await scoped.clear('default');

  assert.deepEqual(await scoped.list('default'), {});
  assert.deepEqual(await scoped.list('setup:1'), { creds: 'two' });
});
