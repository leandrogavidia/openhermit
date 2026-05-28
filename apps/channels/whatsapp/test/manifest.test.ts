import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { ChannelCredentialStore } from '@openhermit/protocol';

import manifest from '../src/manifest.js';

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


const context = (overrides: Record<string, unknown> = {}) => ({
  agentBaseUrl: 'http://gateway/api/agents/x',
  publicAgentBaseUrl: 'http://gateway/api/agents/x',
  agentTokens: { whatsapp: 'tok' },
  logger: () => undefined,
  reportRuntimeError: () => undefined,
  ...overrides,
} as never);

test('manifest exposes the required plugin contract', () => {
  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.key, 'whatsapp');
  assert.equal(manifest.namespace, 'whatsapp');
  assert.equal(manifest.displayName, 'WhatsApp');
  assert.equal(typeof manifest.start, 'function');
  assert.ok(manifest.setup, 'manifest must expose ChannelSetup');
  assert.deepEqual(manifest.defaultConfig, { auth_profile: 'default' });
  assert.equal(
    manifest.configFields?.some((field) => 'key' in field && field.key === 'auth_dir'),
    false,
  );
});

test('start() without credentialStore reports DB credential requirement', async () => {
  await assert.rejects(
    () => manifest.start({ enabled: true }, context()),
    /DATABASE_URL and OPENHERMIT_SECRETS_KEY/,
  );
});

test('start() with DB store but no linked auth asks for setup', async () => {
  await assert.rejects(
    () => manifest.start(
      { enabled: true, auth_profile: 'default' },
      context({ credentialStore: new MemoryCredentialStore() }),
    ),
    /run channel setup first/,
  );
});

test('start() rejects and deletes managed legacy auth_dir folders', async (t) => {
  const root = path.join(
    os.homedir(),
    '.openhermit',
    'credentials',
    'whatsapp',
    `test-${randomUUID()}`,
  );
  const authDir = path.join(root, 'default');
  await mkdir(authDir, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(
    () => manifest.start(
      { enabled: true, auth_dir: authDir },
      context({ credentialStore: new MemoryCredentialStore() }),
    ),
    /auth_dir is no longer supported/,
  );

  await assert.rejects(() => mkdir(path.join(authDir, 'probe')), /ENOENT/);
});
