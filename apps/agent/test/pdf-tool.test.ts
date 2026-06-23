import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import { DbAttachmentStore, LocalAttachmentStorage } from '@openhermit/store';
import { ValidationError } from '@openhermit/shared';

import { createPdfReadTool, createPdfToolset } from '../src/tools/pdf.js';
import { createBuiltInTools } from '../src/tools.js';
import type { ToolContext } from '../src/tools/shared.js';
import { ExecBackendManager } from '../src/core/index.js';
import type { ExecBackend } from '../src/core/index.js';
import { createSecurityFixture } from './helpers.js';

const SAMPLE_PDF = readFileSync(new URL('./fixtures/sample.pdf', import.meta.url));

function bufferToStream(buf: Buffer): NodeJS.ReadableStream {
  return Readable.from(buf);
}

function firstText(result: { content: Array<{ type: string; text?: string }> }): string {
  const t = result.content.find((c) => c.type === 'text');
  return typeof t?.text === 'string' ? t.text : '';
}

async function setup(t: import('node:test').TestContext) {
  const store = await DbAttachmentStore.open();
  t.after(() => store.close());

  const root = await mkdtemp(path.join(tmpdir(), 'openhermit-pdf-tool-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = new LocalAttachmentStorage({ root });

  const fixture = await createSecurityFixture(t);
  const agentId = fixture.agentId;
  const sessionId = `s-${randomUUID().slice(0, 8)}`;

  const baseCtx: ToolContext = {
    security: fixture.security,
    attachmentStore: store,
    attachmentStorage: storage,
    storeScope: { agentId },
    sessionId,
    currentUserId: 'usr-1',
    currentUserRole: 'user',
  };

  return { store, storage, agentId, sessionId, baseCtx };
}

async function uploadFile(opts: {
  store: DbAttachmentStore;
  storage: LocalAttachmentStorage;
  agentId: string;
  sessionId: string;
  name: string;
  body: Buffer;
  mime: string;
  uploaderUserId?: string;
}): Promise<string> {
  const id = `att_${randomUUID()}`;
  const { sha256, sizeBytes } = await opts.storage.put({
    agentId: opts.agentId,
    sessionId: opts.sessionId,
    attachmentId: id,
    filename: opts.name,
    contentType: opts.mime,
    body: bufferToStream(opts.body),
  });
  await opts.store.create({
    id,
    agentId: opts.agentId,
    sessionId: opts.sessionId,
    uploaderUserId: opts.uploaderUserId ?? 'usr-1',
    originalName: opts.name,
    safeName: opts.name,
    mimeType: opts.mime,
    sizeBytes,
    sha256,
    storageProvider: 'local',
    storageKey: `${opts.agentId}/${opts.sessionId}/${id}/${opts.name}`,
  });
  return id;
}

const makeReadOnlyBackend = (agentHome: string, files: Map<string, Buffer>): ExecBackend => ({
  id: 'host',
  type: 'host',
  label: 'host',
  username: 'tester',
  agentHome,
  ensure: async () => {},
  exec: async () => ({ stdout: '', stderr: '', exitCode: 0, durationMs: 0 }),
  syncSkills: async () => {},
  shutdown: async () => {},
  files: {
    read: async (filePath: string) => {
      const data = files.get(filePath);
      if (!data) throw new Error(`fake backend: file not found: ${filePath}`);
      return { data };
    },
    write: async () => { throw new Error('not used'); },
    list: async () => [],
    stat: async () => null,
    delete: async () => { throw new Error('not used'); },
  },
});

// ── toolset shape ───────────────────────────────────────────────────────

test('createPdfToolset exposes a single pdf_read tool with owner+user grants', async (t) => {
  const { baseCtx } = await setup(t);
  const toolset = createPdfToolset(baseCtx);
  assert.equal(toolset.id, 'pdf');
  assert.equal(toolset.tools.length, 1);
  const tool = toolset.tools[0]!;
  assert.equal(tool.name, 'pdf_read');
  assert.deepEqual(tool.policy?.defaultGrants, [
    { type: 'role', value: 'owner' },
    { type: 'role', value: 'user' },
  ]);
});

// ── text extraction ───────────────────────────────────────────────────────

test('pdf_read extracts text from an uploaded PDF by attachment_id', async (t) => {
  const { store, storage, agentId, sessionId, baseCtx } = await setup(t);
  const id = await uploadFile({
    store, storage, agentId, sessionId,
    name: 'sample.pdf', body: SAMPLE_PDF, mime: 'application/pdf',
  });

  const tool = createPdfReadTool(baseCtx);
  const out = await tool.execute('tc-1', { attachment_id: id });

  const text = firstText(out);
  assert.match(text, /Hello page one/);
  assert.match(text, /Hello page two/);

  const details = out.details as Record<string, unknown>;
  assert.equal(details.pageCount, 2);
  assert.deepEqual(details.pagesExtracted, [1, 2]);
  assert.equal(details.hadText, true);
  assert.equal(details.extraction, 'unpdf');
});

test('pdf_read pages="1" returns only the first page', async (t) => {
  const { store, storage, agentId, sessionId, baseCtx } = await setup(t);
  const id = await uploadFile({
    store, storage, agentId, sessionId,
    name: 'sample.pdf', body: SAMPLE_PDF, mime: 'application/pdf',
  });

  const tool = createPdfReadTool(baseCtx);
  const out = await tool.execute('tc-2', { attachment_id: id, pages: '1' });

  const text = firstText(out);
  assert.match(text, /Hello page one/);
  assert.doesNotMatch(text, /Hello page two/);
  assert.deepEqual((out.details as Record<string, unknown>).pagesExtracted, [1]);
});

test('pdf_read reads a PDF from a sandbox_path via the exec backend', async (t) => {
  const { baseCtx } = await setup(t);
  const agentHome = '/root';
  const pdfPath = `${agentHome}/sample.pdf`;
  const backend = makeReadOnlyBackend(agentHome, new Map([[pdfPath, SAMPLE_PDF]]));
  const ctx: ToolContext = { ...baseCtx, execBackendManager: new ExecBackendManager([backend]) };

  const tool = createPdfReadTool(ctx);
  const out = await tool.execute('tc-3', { sandbox_path: pdfPath });

  assert.match(firstText(out), /Hello page one/);
  const details = out.details as { source: { path?: string } };
  assert.equal(details.source.path, pdfPath);
});

// ── input validation & guards ─────────────────────────────────────────────

test('pdf_read requires exactly one of attachment_id / sandbox_path', async (t) => {
  const { baseCtx } = await setup(t);
  const tool = createPdfReadTool(baseCtx);
  await assert.rejects(() => tool.execute('tc-4a', {}), ValidationError);
  await assert.rejects(
    () => tool.execute('tc-4b', { attachment_id: 'att_x', sandbox_path: '/root/x.pdf' }),
    ValidationError,
  );
});

test('pdf_read rejects a non-PDF file (missing %PDF- signature)', async (t) => {
  const { store, storage, agentId, sessionId, baseCtx } = await setup(t);
  const id = await uploadFile({
    store, storage, agentId, sessionId,
    name: 'notes.txt', body: Buffer.from('just plain text, not a pdf'), mime: 'text/plain',
  });
  const tool = createPdfReadTool(baseCtx);
  await assert.rejects(
    () => tool.execute('tc-5', { attachment_id: id }),
    (err: unknown) => err instanceof ValidationError && /does not look like a PDF/.test(err.message),
  );
});

test('pdf_read enforces attachment visibility (cross-session, non-owner, non-uploader)', async (t) => {
  const { store, storage, agentId, baseCtx } = await setup(t);
  // Uploaded in a different session by a different user; current ctx is a plain
  // user in its own session — must be denied, mirroring attachment_fetch.
  const id = await uploadFile({
    store, storage, agentId, sessionId: 'other-session',
    name: 'secret.pdf', body: SAMPLE_PDF, mime: 'application/pdf', uploaderUserId: 'usr-2',
  });
  const tool = createPdfReadTool(baseCtx);
  await assert.rejects(
    () => tool.execute('tc-6', { attachment_id: id }),
    (err: unknown) => err instanceof ValidationError && /not visible/.test(err.message),
  );
});

test('pdf_read rejects an input larger than max_bytes', async (t) => {
  const { store, storage, agentId, sessionId, baseCtx } = await setup(t);
  const id = await uploadFile({
    store, storage, agentId, sessionId,
    name: 'sample.pdf', body: SAMPLE_PDF, mime: 'application/pdf',
  });
  const tool = createPdfReadTool(baseCtx);
  await assert.rejects(
    () => tool.execute('tc-7', { attachment_id: id, max_bytes: 10 }),
    (err: unknown) => err instanceof ValidationError && /max_bytes/.test(err.message),
  );
});

test('pdf_read rejects an unknown attachment_id', async (t) => {
  const { baseCtx } = await setup(t);
  const tool = createPdfReadTool(baseCtx);
  await assert.rejects(
    () => tool.execute('tc-8', { attachment_id: 'att_does_not_exist' }),
    (err: unknown) => err instanceof ValidationError && /no such attachment/.test(err.message),
  );
});

// ── registration in createBuiltInTools ────────────────────────────────────

test('pdf_read is registered when attachment storage is configured', async (t) => {
  const { baseCtx } = await setup(t);
  const names = createBuiltInTools(baseCtx).map((tool) => tool.name);
  assert.ok(names.includes('pdf_read'), 'pdf_read should be registered');
});

test('pdf_read is absent when attachment storage is not configured', async (t) => {
  const fixture = await createSecurityFixture(t);
  const names = createBuiltInTools({
    security: fixture.security,
    storeScope: { agentId: fixture.agentId },
  }).map((tool) => tool.name);
  assert.ok(!names.includes('pdf_read'), 'pdf_read should not be registered without attachment storage');
});
