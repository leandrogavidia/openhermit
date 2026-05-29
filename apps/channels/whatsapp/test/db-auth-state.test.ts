import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proto } from 'baileys';
import type { ChannelCredentialStore } from '@openhermit/protocol';

import { useDbAuthState } from '../src/db-auth-state.js';

class MemoryCredentialStore implements ChannelCredentialStore {
  private profiles = new Map<string, Map<string, string>>();

  private profile(name: string): Map<string, string> {
    let values = this.profiles.get(name);
    if (!values) {
      values = new Map<string, string>();
      this.profiles.set(name, values);
    }
    return values;
  }

  async get(profile: string, key: string): Promise<string | undefined> {
    return this.profiles.get(profile)?.get(key);
  }

  async list(profile: string): Promise<Record<string, string>> {
    return Object.fromEntries(this.profiles.get(profile)?.entries() ?? []);
  }

  async set(profile: string, key: string, value: string): Promise<void> {
    this.profile(profile).set(key, value);
  }

  async delete(profile: string, key: string): Promise<void> {
    this.profiles.get(profile)?.delete(key);
  }

  async replace(profile: string, values: Record<string, string>): Promise<void> {
    this.profiles.set(profile, new Map(Object.entries(values)));
  }

  async clear(profile: string): Promise<void> {
    this.profiles.delete(profile);
  }
}


test('useDbAuthState persists and reloads creds through BufferJSON', async () => {
  const store = new MemoryCredentialStore();
  const first = await useDbAuthState(store, 'default');
  first.state.creds.me = { id: '15551234567:1@s.whatsapp.net' } as never;
  await first.saveCreds();

  const second = await useDbAuthState(store, 'default');
  assert.equal(second.state.creds.me?.id, '15551234567:1@s.whatsapp.net');
  assert.ok(second.state.creds.noiseKey, 'initAuthCreds fields should survive serialization');
});

test('useDbAuthState stores, reads, and deletes signal keys', async () => {
  const store = new MemoryCredentialStore();
  const { state } = await useDbAuthState(store, 'default');

  await state.keys.set({
    session: { 'jid-1': Uint8Array.from([1, 2, 3]) },
  });

  let sessions = await state.keys.get('session', ['jid-1', 'missing']);
  assert.deepEqual(Array.from(sessions['jid-1'] as Uint8Array), [1, 2, 3]);
  assert.equal(sessions['missing'], undefined);

  await state.keys.set({ session: { 'jid-1': null } } as never);
  sessions = await state.keys.get('session', ['jid-1']);
  assert.equal(sessions['jid-1'], undefined);
});

test('useDbAuthState rehydrates app-state-sync-key values as protobuf objects', async () => {
  const store = new MemoryCredentialStore();
  const { state } = await useDbAuthState(store, 'default');
  await state.keys.set({
    'app-state-sync-key': {
      app: {
        keyData: Uint8Array.from([7, 8]),
        timestamp: '123',
      },
    },
  } as never);

  const keys = await state.keys.get('app-state-sync-key', ['app']);
  assert.ok(keys['app'] instanceof proto.Message.AppStateSyncKeyData);
  assert.deepEqual(Array.from(keys['app']!.keyData ?? []), [7, 8]);
});
