import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { ValidationError } from '@openhermit/shared';

import {
  type Toolset,
  type ToolContext,
  asTextContent,
  ensureAutonomyAllows,
  formatJson,
} from './shared.js';
import type { ExecBackend, FileWriteMode } from '../core/index.js';

const SANDBOX_ARG = Type.Optional(
  Type.String({ description: 'Sandbox alias. Omit to use the default sandbox.' }),
);

const PATH_ARG = Type.String({
  description: 'Absolute path inside the sandbox (as the agent sees it).',
});

const FileReadParams = Type.Object({
  path: PATH_ARG,
  sandbox: SANDBOX_ARG,
  encoding: Type.Optional(
    Type.Union([Type.Literal('utf8'), Type.Literal('base64')], {
      description: "How to return file bytes. 'utf8' (default) for text; 'base64' for binary.",
    }),
  ),
});

const FileWriteParams = Type.Object({
  path: PATH_ARG,
  content: Type.String({ description: 'File contents. Bytes if encoding=base64, text otherwise.' }),
  mode: Type.Optional(
    Type.Union(
      [Type.Literal('create'), Type.Literal('overwrite'), Type.Literal('append')],
      { description: "Write mode. 'overwrite' (default), 'create' (fail if exists), 'append'." },
    ),
  ),
  encoding: Type.Optional(
    Type.Union([Type.Literal('utf8'), Type.Literal('base64')], {
      description: "How to interpret content. 'utf8' (default) for text; 'base64' for binary.",
    }),
  ),
  sandbox: SANDBOX_ARG,
});

const FileListParams = Type.Object({
  path: PATH_ARG,
  sandbox: SANDBOX_ARG,
});

const FileStatParams = Type.Object({
  path: PATH_ARG,
  sandbox: SANDBOX_ARG,
});

const FileDeleteParams = Type.Object({
  path: PATH_ARG,
  sandbox: SANDBOX_ARG,
});

type FileReadArgs = Static<typeof FileReadParams>;
type FileWriteArgs = Static<typeof FileWriteParams>;
type FileListArgs = Static<typeof FileListParams>;
type FileStatArgs = Static<typeof FileStatParams>;
type FileDeleteArgs = Static<typeof FileDeleteParams>;

/** 5 MiB. Beyond this, results blow the model context budget. */
const MAX_READ_BYTES = 5 * 1024 * 1024;

const resolveBackend = (context: ToolContext, alias?: string): ExecBackend => {
  if (!context.execBackendManager) {
    throw new ValidationError('File tools are unavailable: no execution backend configured for this agent.');
  }
  return context.execBackendManager.get(alias);
};

export const createFileReadTool = (context: ToolContext): AgentTool<typeof FileReadParams> => ({
  name: 'file_read',
  label: 'Read File',
  description:
    'Read a file from a sandbox by absolute path. Returns text by default; use encoding=base64 for binary files. Hard cap of 5 MiB.',
  parameters: FileReadParams,
  execute: async (_id, args: FileReadArgs) => {
    ensureAutonomyAllows(context.security, 'file_read');
    const backend = resolveBackend(context, args.sandbox);
    const { data } = await backend.files.read(args.path);
    if (data.byteLength > MAX_READ_BYTES) {
      throw new ValidationError(
        `File is ${data.byteLength.toLocaleString()} bytes; exceeds the ${MAX_READ_BYTES.toLocaleString()} byte cap. Use exec for large files.`,
      );
    }
    const encoding = args.encoding ?? 'utf8';
    const content = encoding === 'base64' ? data.toString('base64') : data.toString('utf8');
    return {
      content: asTextContent(content),
      details: {
        path: args.path,
        sandbox: backend.id,
        size: data.byteLength,
        encoding,
      },
    };
  },
});

export const createFileWriteTool = (context: ToolContext): AgentTool<typeof FileWriteParams> => ({
  name: 'file_write',
  label: 'Write File',
  description:
    "Write a file in a sandbox. Default mode is 'overwrite' (atomic write-and-rename). Use 'create' to fail if the file already exists, or 'append' to add to the end. Parent directories are created as needed.",
  parameters: FileWriteParams,
  execute: async (_id, args: FileWriteArgs) => {
    ensureAutonomyAllows(context.security, 'file_write');
    const backend = resolveBackend(context, args.sandbox);
    const mode: FileWriteMode = args.mode ?? 'overwrite';
    const encoding = args.encoding ?? 'utf8';
    const data =
      encoding === 'base64' ? Buffer.from(args.content, 'base64') : Buffer.from(args.content, 'utf8');
    await backend.files.write(args.path, data, mode);
    return {
      content: asTextContent(`Wrote ${data.byteLength} bytes to ${args.path} (mode=${mode}).\n`),
      details: { path: args.path, sandbox: backend.id, mode, bytes: data.byteLength },
    };
  },
});

export const createFileListTool = (context: ToolContext): AgentTool<typeof FileListParams> => ({
  name: 'file_list',
  label: 'List Directory',
  description: 'List entries (files + subdirectories) in a sandbox directory.',
  parameters: FileListParams,
  execute: async (_id, args: FileListArgs) => {
    ensureAutonomyAllows(context.security, 'file_list');
    const backend = resolveBackend(context, args.sandbox);
    const entries = await backend.files.list(args.path);
    return {
      content: asTextContent(formatJson(entries)),
      details: { path: args.path, sandbox: backend.id, entries },
    };
  },
});

export const createFileStatTool = (context: ToolContext): AgentTool<typeof FileStatParams> => ({
  name: 'file_stat',
  label: 'Stat Path',
  description: 'Inspect a path in a sandbox: type (file/directory), size, last-modified time. Returns null if missing.',
  parameters: FileStatParams,
  execute: async (_id, args: FileStatArgs) => {
    ensureAutonomyAllows(context.security, 'file_stat');
    const backend = resolveBackend(context, args.sandbox);
    const stat = await backend.files.stat(args.path);
    return {
      content: asTextContent(stat ? formatJson(stat) : 'null\n'),
      details: { path: args.path, sandbox: backend.id, stat },
    };
  },
});

export const createFileDeleteTool = (context: ToolContext): AgentTool<typeof FileDeleteParams> => ({
  name: 'file_delete',
  label: 'Delete File',
  description: 'Delete a single file in a sandbox. Refuses to delete directories (no recursion).',
  parameters: FileDeleteParams,
  execute: async (_id, args: FileDeleteArgs) => {
    ensureAutonomyAllows(context.security, 'file_delete');
    const backend = resolveBackend(context, args.sandbox);
    await backend.files.delete(args.path);
    return {
      content: asTextContent(`Deleted ${args.path}.\n`),
      details: { path: args.path, sandbox: backend.id },
    };
  },
});

const FILE_DESCRIPTION = `\
### File Tools

First-class file operations on a sandbox: \`file_read\`, \`file_write\`,
\`file_list\`, \`file_stat\`, \`file_delete\`. Paths are absolute, as the
agent sees them inside the sandbox (under the agent's home directory).

Prefer these over \`exec cat\` / \`exec tee\` for routine file work — they
return structured results and stay within the file-policy gate. Use
\`exec\` for shell-y things (search, build, scripts, processes).

For multi-sandbox agents, pass \`sandbox\` to choose; omit for the default.`;

export const createFileToolset = (context: ToolContext): Toolset => ({
  id: 'file',
  description: FILE_DESCRIPTION,
  tools: [
    createFileReadTool(context),
    createFileWriteTool(context),
    createFileListTool(context),
    createFileStatTool(context),
    createFileDeleteTool(context),
  ],
});
