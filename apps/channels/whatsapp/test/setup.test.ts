import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChannelCredentialStore, ChannelSetupContext } from '@openhermit/protocol';

import {
  DEFAULT_AUTH_PROFILE,
  createWhatsAppSetup,
  type StartWhatsAppLinkSession,
  type WhatsAppLinkSnapshot,
} from '../src/setup.js';

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


const ctx = (credentialStore = new MemoryCredentialStore()): ChannelSetupContext => ({
  agentId: 'agent-1',
  logger: () => {},
  credentialStore,
});

function fakeStarter(
  snapshots: WhatsAppLinkSnapshot[],
  captures: string[] = [],
): StartWhatsAppLinkSession {
  return async ({ authProfile, credentialStore }) => {
    let idx = 0;
    let cancelled = false;
    captures.push(authProfile);
    return {
      authProfile,
      async read() {
        const snap = snapshots[Math.min(idx++, snapshots.length - 1)]!;
        if (snap.kind === 'done') {
          await credentialStore.set(authProfile, 'creds', 'linked-creds');
          await credentialStore.set(authProfile, 'key:session:jid', 'linked-session');
        }
        return snap;
      },
      async cancel() {
        cancelled = true;
      },
      get cancelled() {
        return cancelled;
      },
    };
  };
}

test('begin() returns awaiting_external for QR setup', async () => {
  const setup = createWhatsAppSetup({
    startLinkSession: fakeStarter([{ kind: 'awaiting', qrText: 'qr-code-text' }]),
  });
  const { sessionId, state } = await setup.begin({}, ctx());
  assert.ok(sessionId);
  assert.equal(state.kind, 'awaiting_external');
  if (state.kind !== 'awaiting_external') return;
  assert.equal(state.qrText, 'qr-code-text');
  assert.equal(state.pollIntervalMs, 1500);
});

test('begin() returns error when credential store is unavailable', async () => {
  const setup = createWhatsAppSetup({
    startLinkSession: fakeStarter([{ kind: 'awaiting', qrText: 'qr-code-text' }]),
  });
  const { state } = await setup.begin({}, { agentId: 'agent-1', logger: () => {} });
  assert.equal(state.kind, 'error');
  if (state.kind !== 'error') return;
  assert.match(state.message, /database-backed channel credentials/i);
});

test('poll() promotes setup credentials into the default auth profile', async () => {
  const store = new MemoryCredentialStore();
  const setupProfiles: string[] = [];
  const setup = createWhatsAppSetup({
    startLinkSession: fakeStarter([
      { kind: 'awaiting', qrText: 'qr-code-text' },
      { kind: 'done' },
    ], setupProfiles),
  });
  const { sessionId } = await setup.begin({}, ctx(store));
  const state = await setup.poll(sessionId, ctx(store));
  assert.equal(state.kind, 'done');
  if (state.kind !== 'done') return;
  assert.deepEqual(state.config, { auth_profile: DEFAULT_AUTH_PROFILE });
  assert.deepEqual(await store.list(DEFAULT_AUTH_PROFILE), {
    creds: 'linked-creds',
    'key:session:jid': 'linked-session',
  });
  assert.deepEqual(await store.list(setupProfiles[0]!), {});
});

test('poll() surfaces link errors and clears temporary credentials', async () => {
  const store = new MemoryCredentialStore();
  const setupProfiles: string[] = [];
  const starter: StartWhatsAppLinkSession = async ({ authProfile, credentialStore }) => {
    setupProfiles.push(authProfile);
    await credentialStore.set(authProfile, 'creds', 'temporary');
    return {
      authProfile,
      async read() {
        return { kind: 'error', message: 'boom' };
      },
      async cancel() {},
    };
  };
  const setup = createWhatsAppSetup({ startLinkSession: starter });
  const { state } = await setup.begin({}, ctx(store));
  assert.equal(state.kind, 'error');
  assert.deepEqual(await store.list(setupProfiles[0]!), {});
});

test('cancel() drops the setup session and clears temporary credentials', async () => {
  const store = new MemoryCredentialStore();
  const setupProfiles: string[] = [];
  const starter: StartWhatsAppLinkSession = async ({ authProfile, credentialStore }) => {
    setupProfiles.push(authProfile);
    await credentialStore.set(authProfile, 'creds', 'temporary');
    return {
      authProfile,
      async read() {
        return { kind: 'awaiting', qrText: 'qr-code-text' };
      },
      async cancel() {},
    };
  };
  const setup = createWhatsAppSetup({ startLinkSession: starter });
  const { sessionId } = await setup.begin({}, ctx(store));
  await setup.cancel!(sessionId, ctx(store));
  const state = await setup.poll(sessionId, ctx(store));
  assert.equal(state.kind, 'error');
  assert.deepEqual(await store.list(setupProfiles[0]!), {});
});

test('abandoned sessions are swept, cancelled, and cleared on next setup action', async () => {
  const store = new MemoryCredentialStore();
  const cancellations: string[] = [];
  const starter: StartWhatsAppLinkSession = async ({ authProfile, credentialStore }) => {
    await credentialStore.set(authProfile, 'creds', 'temporary');
    return {
      authProfile,
      async read() {
        return { kind: 'awaiting', qrText: 'qr' };
      },
      async cancel() {
        cancellations.push(authProfile);
      },
    };
  };

  const setup = createWhatsAppSetup({ startLinkSession: starter });
  const originalNow = Date.now;
  try {
    let now = 1_000_000;
    Date.now = () => now;

    const { sessionId: abandoned } = await setup.begin({}, ctx(store));
    assert.equal(cancellations.length, 0);

    now += 11 * 60 * 1000;

    await setup.begin({}, ctx(store));
    assert.equal(cancellations.length, 1);
    assert.deepEqual(await store.list(cancellations[0]!), {});

    const state = await setup.poll(abandoned, ctx(store));
    assert.equal(state.kind, 'error');
  } finally {
    Date.now = originalNow;
  }
});
