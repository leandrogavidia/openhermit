import { Type, type Static } from '@mariozechner/pi-ai';
import { ValidationError } from '@openhermit/shared';
import { extractText, getDocumentProxy, getMeta } from 'unpdf';

import {
  type PolicyAwareTool,
  type Toolset,
  type ToolContext,
  asTextContent,
} from './shared.js';
import type { ExecBackend } from '../core/index.js';
import { DEFAULT_ATTACHMENT_MAX_BYTES } from '../attachments/helpers.js';

const PdfReadParams = Type.Object({
  attachment_id: Type.Optional(
    Type.String({
      description:
        'Id of an uploaded PDF (e.g. `att_xxx`) from `attachment_list`/`attachment_upload`. Provide exactly one of attachment_id or sandbox_path.',
    }),
  ),
  sandbox_path: Type.Optional(
    Type.String({
      description:
        'Absolute path to a PDF inside the sandbox (e.g. one the agent generated or that was materialized from an upload). Provide exactly one of attachment_id or sandbox_path.',
    }),
  ),
  pages: Type.Optional(
    Type.String({
      description:
        "Page selection, 1-based, like '1-5' or '1,3,7-9'. Omit to read every page.",
    }),
  ),
  password: Type.Optional(
    Type.String({ description: 'Password for an encrypted PDF.' }),
  ),
  max_bytes: Type.Optional(
    Type.Number({
      description:
        'Maximum input size in bytes (default 25 MiB). Larger PDFs are rejected — read them with file_read + an exec converter (e.g. pdftotext) instead.',
    }),
  ),
  sandbox: Type.Optional(
    Type.String({
      description: 'Sandbox alias for sandbox_path reads. Omit to use the default sandbox.',
    }),
  ),
});

type PdfReadArgs = Static<typeof PdfReadParams>;

const resolveBackend = (context: ToolContext, alias?: string): ExecBackend => {
  if (!context.execBackendManager) {
    throw new ValidationError(
      'pdf_read sandbox_path is unavailable: no execution backend is configured for this agent.',
    );
  }
  return context.execBackendManager.get(alias);
};

/** Read a stream into a Buffer, throwing once the byte cap is exceeded. */
async function readCapped(stream: NodeJS.ReadableStream, cap: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let seen = 0;
  for await (const chunk of stream) {
    const b = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    seen += b.length;
    if (seen > cap) {
      throw new ValidationError(
        `pdf_read: PDF exceeds max_bytes=${cap}. Use file_read on the sandbox path with an exec converter (e.g. pdftotext) for very large PDFs.`,
      );
    }
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

/** PDFs carry a `%PDF-` signature; real readers tolerate a little leading junk. */
const looksLikePdf = (buf: Buffer): boolean =>
  buf.subarray(0, 1024).includes(Buffer.from('%PDF-', 'latin1'));

const PAGE_SPEC_RE = /^\s*\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*\s*$/;

/** Parse a 1-based page spec ('1-5' | '1,3,7-9') into a clamped, sorted, deduped list. */
const parsePageRange = (spec: string, totalPages: number): number[] => {
  if (!PAGE_SPEC_RE.test(spec)) {
    throw new ValidationError(
      `pdf_read: invalid pages value "${spec}". Use formats like "1-5" or "1,3,7-9".`,
    );
  }
  const wanted = new Set<number>();
  for (const part of spec.split(',')) {
    const bounds = part.split('-').map((s) => Number.parseInt(s.trim(), 10));
    const start = bounds[0]!;
    const end = bounds[1] ?? start;
    if (start < 1 || end < start) {
      throw new ValidationError(`pdf_read: invalid page range "${part.trim()}" in pages="${spec}".`);
    }
    for (let p = start; p <= end && p <= totalPages; p++) wanted.add(p);
  }
  if (wanted.size === 0) {
    throw new ValidationError(
      `pdf_read: pages="${spec}" selects no pages in a ${totalPages}-page document.`,
    );
  }
  return [...wanted].sort((x, y) => x - y);
};

const isPasswordError = (err: unknown): boolean => {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: unknown }).name;
  const msg = (err as { message?: unknown }).message;
  return name === 'PasswordException' || (typeof msg === 'string' && /password/i.test(msg));
};

export const createPdfReadTool = (
  context: ToolContext,
): PolicyAwareTool<typeof PdfReadParams> => ({
  // Reads attachment/sandbox content: owner + user, like file_read (guests excluded).
  policy: {
    defaultGrants: [
      { type: 'role', value: 'owner' },
      { type: 'role', value: 'user' },
    ],
  },
  name: 'pdf_read',
  label: 'Read PDF',
  description:
    'Extract text from a PDF (by attachment_id or sandbox_path) and return it to you. ' +
    'Use this instead of attachment_fetch/file_read for PDFs — those return raw bytes, not readable text. ' +
    'Supports page selection (pages) and encrypted PDFs (password). Born-digital PDFs only; ' +
    'scanned/image-only PDFs have no extractable text (page-image rendering is not yet supported).',
  parameters: PdfReadParams,
  execute: async (_toolCallId, args: PdfReadArgs) => {
    const hasId = typeof args.attachment_id === 'string' && args.attachment_id.trim() !== '';
    const hasPath = typeof args.sandbox_path === 'string' && args.sandbox_path.trim() !== '';
    if (hasId === hasPath) {
      throw new ValidationError(
        'pdf_read requires exactly one of attachment_id or sandbox_path.',
      );
    }

    const cap = Math.max(1, args.max_bytes ?? DEFAULT_ATTACHMENT_MAX_BYTES);

    let buf: Buffer;
    let source: Record<string, unknown>;

    if (hasId) {
      if (!context.attachmentStore || !context.attachmentStorage || !context.storeScope) {
        throw new ValidationError(
          'pdf_read is unavailable: attachment storage is not configured.',
        );
      }
      const id = args.attachment_id!.trim();
      const row = await context.attachmentStore.get(id);
      if (!row || row.agentId !== context.storeScope.agentId) {
        throw new ValidationError(`pdf_read: no such attachment ${id}.`);
      }
      // Visibility: same session is always allowed; cross-session only for the
      // owner or the original uploader (mirrors attachment_fetch).
      const sameSession = row.sessionId === context.sessionId;
      const isOwner = context.currentUserRole === 'owner';
      const isUploader = !!row.uploaderUserId && row.uploaderUserId === context.currentUserId;
      if (!sameSession && !isOwner && !isUploader) {
        throw new ValidationError(`pdf_read: attachment ${id} is not visible in this session.`);
      }
      if (row.sizeBytes > cap) {
        throw new ValidationError(
          `pdf_read: attachment ${id} is ${row.sizeBytes} bytes which exceeds max_bytes=${cap}. ` +
            'Use the sandbox path with file_read + an exec converter for very large PDFs.',
        );
      }
      const stream = await context.attachmentStorage.readStream(row.storageKey);
      buf = await readCapped(stream, cap);
      source = { attachmentId: id, name: row.originalName };
    } else {
      const backend = resolveBackend(context, args.sandbox);
      const path = args.sandbox_path!.trim();
      const { data } = await backend.files.read(path);
      if (data.byteLength > cap) {
        throw new ValidationError(
          `pdf_read: ${path} is ${data.byteLength} bytes which exceeds max_bytes=${cap}.`,
        );
      }
      buf = data;
      source = { path, sandbox: backend.id };
    }

    if (!looksLikePdf(buf)) {
      throw new ValidationError(
        'pdf_read: file does not look like a PDF (missing %PDF- signature). ' +
          'Use attachment_fetch/file_read for non-PDF files.',
      );
    }

    let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
    try {
      pdf = await getDocumentProxy(
        new Uint8Array(buf),
        args.password ? { password: args.password } : undefined,
      );
    } catch (err) {
      if (isPasswordError(err)) {
        throw new ValidationError(
          args.password
            ? 'pdf_read: incorrect password for this encrypted PDF.'
            : 'pdf_read: this PDF is encrypted. Pass the `password` parameter to read it.',
        );
      }
      throw new ValidationError(
        `pdf_read: failed to open PDF: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const { totalPages, text } = await extractText(pdf, { mergePages: false });

    const selected = args.pages
      ? parsePageRange(args.pages, totalPages)
      : Array.from({ length: totalPages }, (_, i) => i + 1);

    const pageTexts = selected.map((p) => (text[p - 1] ?? '').trim());
    const extractedChars = pageTexts.reduce((n, t) => n + t.length, 0);
    const hadText = extractedChars > 0;

    // Best-effort metadata; never fail the read over it.
    let info: Record<string, unknown> = {};
    try {
      const meta = await getMeta(pdf);
      info = (meta.info ?? {}) as Record<string, unknown>;
    } catch {
      /* metadata is optional */
    }

    const note = hadText
      ? undefined
      : 'No extractable text — this PDF is likely scanned/image-only. Page-image rendering (OCR/vision) is not yet supported by pdf_read.';

    const body = hadText
      ? selected.map((p, i) => `--- page ${p} ---\n${pageTexts[i]}`).join('\n\n')
      : `[pdf_read] ${note}`;

    return {
      content: asTextContent(`${body}\n`),
      details: {
        source,
        pageCount: totalPages,
        pagesExtracted: selected,
        extractedChars,
        hadText,
        encrypted: !!args.password,
        extraction: 'unpdf',
        ...(typeof info.Title === 'string' && info.Title ? { title: info.Title } : {}),
        ...(typeof info.Producer === 'string' && info.Producer ? { producer: info.Producer } : {}),
        ...(note ? { note } : {}),
      },
    };
  },
});

const PDF_DESCRIPTION = `\
### PDF

\`pdf_read\` extracts text from a PDF and returns it to you as readable text.

- Prefer it over \`attachment_fetch\` / \`file_read\` for PDFs: those return raw
  bytes (unreadable), whereas \`pdf_read\` returns extracted text.
- Accepts \`attachment_id\` (an uploaded PDF) **or** \`sandbox_path\` (a PDF in the
  sandbox) — exactly one.
- \`pages\` selects pages (\`"1-5"\`, \`"1,3,7-9"\`); \`password\` unlocks encrypted PDFs.
- Born-digital PDFs only. Scanned/image-only PDFs return no text (page-image
  rendering / OCR is not yet supported) — for those, render pages with an exec
  converter (e.g. \`pdftoppm\`) and inspect the images.`;

export const createPdfToolset = (context: ToolContext): Toolset => ({
  id: 'pdf',
  description: PDF_DESCRIPTION,
  tools: [createPdfReadTool(context)],
});
