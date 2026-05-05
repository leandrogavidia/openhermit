import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ValidationError, NotFoundError } from '@openhermit/shared';

import {
  ExecBackendManager,
  createExecBackend,
  type ExecBackend,
  type BackendFactoryContext,
} from '../src/core/exec-backend.js';
import type { DockerRunner, DockerContainerManager } from '../src/core/container-manager.js';

const fakeContext: BackendFactoryContext = {
  containerManager: {} as DockerContainerManager,
  agentId: 'test-agent',
  workspaceDir: '/tmp/workspace',
};

// ── createExecBackend ────────────────────────────────────────────────────

test('createExecBackend creates a host backend', () => {
  const backend = createExecBackend({ type: 'host', id: 'host' }, fakeContext);
  assert.equal(backend.type, 'host');
  assert.equal(backend.id, 'host');
});

test('createExecBackend throws for unknown type', () => {
  assert.throws(
    () => createExecBackend({ type: 'unknown' } as any, fakeContext),
    ValidationError,
  );
});

// ── ExecBackendManager ───────────────────────────────────────────────────

const makeFakeBackend = (id: string, type = 'host'): ExecBackend => ({
  id,
  type,
  label: id,
  username: 'tester',
  agentHome: '/tmp/fake',
  ensure: async () => {},
  exec: async () => ({ stdout: '', stderr: '', exitCode: 0, durationMs: 0 }),
  syncSkills: async () => {},
  shutdown: async () => {},
  files: {
    read: async () => { throw new Error('not used'); },
    write: async () => { throw new Error('not used'); },
    list: async () => [],
    stat: async () => null,
    delete: async () => { throw new Error('not used'); },
  },
});

test('ExecBackendManager throws on empty backends', () => {
  assert.throws(() => new ExecBackendManager([]), ValidationError);
});

test('ExecBackendManager uses first backend as default', () => {
  const mgr = new ExecBackendManager([makeFakeBackend('a'), makeFakeBackend('b')]);
  assert.equal(mgr.getDefault().id, 'a');
});

test('ExecBackendManager respects explicit default', () => {
  const mgr = new ExecBackendManager([makeFakeBackend('a'), makeFakeBackend('b')], 'b');
  assert.equal(mgr.getDefault().id, 'b');
});

test('ExecBackendManager throws on invalid default', () => {
  assert.throws(
    () => new ExecBackendManager([makeFakeBackend('a')], 'missing'),
    ValidationError,
  );
});

test('ExecBackendManager.get throws for unknown id', () => {
  const mgr = new ExecBackendManager([makeFakeBackend('a')]);
  assert.throws(() => mgr.get('nope'), NotFoundError);
});

test('ExecBackendManager.list returns all backends', () => {
  const mgr = new ExecBackendManager([makeFakeBackend('a'), makeFakeBackend('b')]);
  assert.equal(mgr.list().length, 2);
});

test('ExecBackendManager.fromConfig falls back to host', () => {
  const mgr = ExecBackendManager.fromConfig(undefined, fakeContext);
  assert.equal(mgr.getDefault().type, 'host');
});

test('ExecBackendManager.fromConfig auto-assigns ids', () => {
  const mgr = ExecBackendManager.fromConfig(
    { backends: [{ type: 'host' }, { type: 'host' }] },
    fakeContext,
  );
  const ids = mgr.list().map((b) => b.id);
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
});

test('ExecBackendManager.shutdownAll calls all backends', async () => {
  let shutdownCount = 0;
  const backend = (): ExecBackend => ({
    ...makeFakeBackend('x'),
    id: `b-${shutdownCount++}`,
    shutdown: async () => { shutdownCount++; },
  });
  const mgr = new ExecBackendManager([backend(), backend()]);
  shutdownCount = 0;
  await mgr.shutdownAll();
  assert.equal(shutdownCount, 2);
});

// ── File backends ────────────────────────────────────────────────────────

test('host file backend: read/write/stat/list/delete round-trip', async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), 'oh-fs-host-'));
  try {
    process.env['HOME'] = tmp;
    const backend = createExecBackend({ type: 'host' }, fakeContext);
    await backend.files.write(path.join(tmp, 'a.txt'), Buffer.from('hello'), 'overwrite');
    const r = await backend.files.read(path.join(tmp, 'a.txt'));
    assert.equal(r.data.toString(), 'hello');
    const s = await backend.files.stat(path.join(tmp, 'a.txt'));
    assert.equal(s?.type, 'file');
    assert.equal(s?.size, 5);
    const list = await backend.files.list(tmp);
    assert.ok(list.some((e) => e.name === 'a.txt' && e.type === 'file'));
    await backend.files.delete(path.join(tmp, 'a.txt'));
    assert.equal(await backend.files.stat(path.join(tmp, 'a.txt')), null);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('host file backend: rejects paths outside agentHome', async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), 'oh-fs-host-'));
  try {
    process.env['HOME'] = tmp;
    const backend = createExecBackend({ type: 'host' }, fakeContext);
    await assert.rejects(() => backend.files.read('/etc/passwd'), ValidationError);
    await assert.rejects(() => backend.files.read('relative/path'), ValidationError);
    await assert.rejects(() => backend.files.read(`${tmp}/../escape`), ValidationError);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('host file backend: create mode fails when file exists', async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), 'oh-fs-host-'));
  try {
    process.env['HOME'] = tmp;
    const backend = createExecBackend({ type: 'host' }, fakeContext);
    await backend.files.write(path.join(tmp, 'x'), Buffer.from('1'), 'create');
    await assert.rejects(
      () => backend.files.write(path.join(tmp, 'x'), Buffer.from('2'), 'create'),
      ValidationError,
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('host file backend: append mode concatenates', async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), 'oh-fs-host-'));
  try {
    process.env['HOME'] = tmp;
    const backend = createExecBackend({ type: 'host' }, fakeContext);
    await backend.files.write(path.join(tmp, 'x'), Buffer.from('foo'), 'overwrite');
    await backend.files.write(path.join(tmp, 'x'), Buffer.from('bar'), 'append');
    const r = await backend.files.read(path.join(tmp, 'x'));
    assert.equal(r.data.toString(), 'foobar');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('docker file backend: container path translates to host workspaceDir', async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), 'oh-fs-docker-'));
  try {
    // Pre-create a file at the host bind-mount path that *would* appear at
    // /root/note.txt inside the container (DOCKER_DEFAULT_AGENT_HOME=/root).
    await writeFile(path.join(tmp, 'note.txt'), 'inside container');
    const ctx: BackendFactoryContext = {
      containerManager: {} as DockerContainerManager,
      agentId: 'test-agent',
      workspaceDir: tmp,
    };
    const backend = createExecBackend(
      { type: 'docker', image: 'ubuntu:24.04' },
      ctx,
    );
    const r = await backend.files.read('/root/note.txt');
    assert.equal(r.data.toString(), 'inside container');

    await backend.files.write('/root/sub/x', Buffer.from('hi'), 'overwrite');
    const onHost = await readFile(path.join(tmp, 'sub', 'x'), 'utf8');
    assert.equal(onHost, 'hi');

    await assert.rejects(() => backend.files.read('/etc/hostname'), ValidationError);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
