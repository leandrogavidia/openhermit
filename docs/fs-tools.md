# Filesystem Tools (Proposal)

> **Status: design proposal, not yet implemented.** Prerequisite for the file portion of [access-policy.md](./access-policy.md).

Today an agent reads and writes files by spawning shell commands through `exec` (`cat`, `tee`, `grep`, redirection). That works but makes path-level access policy impossible: by the time the gateway sees a shell string, it can't reliably tell which paths will be touched. To enforce per-path grants we need first-class file tools whose arguments are paths, not shell strings.

This document proposes those tools and the backend abstraction behind them.

## Goals

- Path-level access policy enforceable at the tool layer.
- Uniform tool surface across `host` / `docker` / `e2b` / `daytona` backends.
- Multi-sandbox aware: an agent can own several sandboxes; tool calls and policies must distinguish them.
- Performance comparable to direct `cat` / `tee`.

## Non-goals

- Replacing `exec` for general shell tasks. `exec` stays, with its own (typically owner-only) policy.
- Ensuring exec cannot read sensitive files. Defence-in-depth across exec and fs tools is the access-policy layer's job, not the fs layer's.
- A general POSIX surface. We expose just what agents actually need.

## Tool surface

Minimal first cut, intentionally narrow:

| Tool | Args | Notes |
|------|------|-------|
| `file_read` | `sandbox`, `path` | Returns text. Binary returns base64 with a flag. Size cap. |
| `file_write` | `sandbox`, `path`, `content`, `mode?` | `mode`: `'create'` / `'overwrite'` / `'append'`. |
| `file_list` | `sandbox`, `path` | Directory listing with type + size. |
| `file_stat` | `sandbox`, `path` | Existence, type, size, mtime. |
| `file_delete` | `sandbox`, `path` | Single path; no recursive flag in v1. |

Notably absent: copy, move, chmod, chown, glob. Agents can compose those from the primitives above; if a real need shows up we add them — but the smaller the surface, the smaller the policy attack surface.

All five tools are **configurable** in the access-policy sense. Defaults:

```
file_read   → grants=[{type:'role', value:'owner'}, {type:'role', value:'user'}]
file_write  → grants=[{type:'role', value:'owner'}]
file_list   → same as file_read
file_stat   → same as file_read
file_delete → same as file_write
```

Agent operators tighten or loosen per agent; per-path grants live in `agent_policies` rows of type `file`.

## Multi-sandbox addressing

An agent can own multiple sandboxes — for example an `ubuntu-primary` docker box for daily work and an `e2b-throwaway` for risky scratch work. Same path string in different sandboxes refers to entirely different bytes.

Two consequences:

1. **Tool calls carry a `sandbox` argument**, not a default. Forcing the agent to name the sandbox keeps it explicit and auditable. The agent learns the sandbox names from its system prompt / context.

2. **Policy rows include a sandbox column**, with `NULL` meaning "any sandbox owned by this agent":

   ```
   (agent_id, sandbox_id, resource_type, mode, resource_key, grants)
   ```

   - Specific `sandbox_id` — rule applies only to that sandbox.
   - `NULL` `sandbox_id` — rule applies across all of the agent's sandboxes (typical for shared conventions like `/workspace/public/`).

   When evaluating, `canAccess` looks up rows for `(agent, this sandbox)` and `(agent, NULL)` and merges them, with sandbox-specific rules taking precedence on conflicts (longest-prefix-wins still applies within each set).

The `sandbox_id` column is added to `agent_policies` for this purpose. For non-file resource types it's always `NULL`.

## Backend abstraction

Tools delegate to a single interface implemented per backend:

```ts
interface FileBackend {
  read(sandbox: SandboxRef, path: string): Promise<Buffer>;
  write(sandbox: SandboxRef, path: string, data: Buffer, mode: WriteMode): Promise<void>;
  list(sandbox: SandboxRef, path: string): Promise<DirEntry[]>;
  stat(sandbox: SandboxRef, path: string): Promise<FileStat | null>;
  delete(sandbox: SandboxRef, path: string): Promise<void>;
}
```

Path policy enforcement happens in the tool handler **before** the backend call. By the time the backend method runs, the path is already authorised.

### `host` backend

Native Node `fs/promises` against the gateway machine's filesystem. Used by the devops agent only (per sandbox-model.md, `host` is reserved and private).

### `e2b` backend

Wraps the e2b SDK's filesystem methods (`sandbox.files.read` / `write` / `list`). Direct, no extra plumbing.

### `daytona` backend

Wraps the daytona SDK's file APIs. Same shape as e2b.

### `docker` backend

This is the interesting case. Docker has no clean "read this file" API; the options are `docker cp`, the archive HTTP endpoint (tar streaming), `docker exec cat`, or a host bind-mount. We choose **bind-mount**.

#### Bind-mount design

When a docker sandbox is created, the gateway:

1. Creates a host directory: `<agent_home>/sandboxes/<sandbox_id>/workspace/`.
2. Bind-mounts that directory into the container at `/workspace`.
3. Stores the mapping `(sandbox_id → host_path, container_path)` on the sandbox record.

`FileBackend` for docker then becomes Node `fs` against the host path. The gateway never reaches into the container for file ops; it only reaches in for `exec`.

Other paths inside the container (system files, installed binaries, etc.) are **not** exposed through the file tools. If an agent needs to read `/etc/something`, it uses `exec`, which goes through its own policy.

#### UID alignment

Files written by the gateway (host UID) must be readable/writable by the in-container agent process. Two viable approaches; we will pick one during implementation:

- Run the container as the host UID (`--user $(id -u):$(id -g)`). Simplest.
- Container entrypoint chowns `/workspace` to the container user on start.

The first is preferred when feasible; it eliminates ownership drift entirely.

#### Path translation

Policy `resource_key` values are stored as **container-side paths** (`/workspace/...`), because that's what agents see and reason about. The docker backend translates container path → host path via the sandbox's mount mapping before issuing fs syscalls.

Other backends use the same convention: agents always speak in container/sandbox paths; the backend handles any translation.

## exec coexistence

The fs tools enforce path policy. `exec` does not — it runs an opaque shell command. So:

- `exec` policy must remain restrictive by default (owner-only is the recommended default in access-policy.md).
- For non-owner roles to do anything meaningful with files, they go through fs tools, which are the gated path.
- Owners who can call `exec` are trusted to read and write directly via shell; the policy model treats that as deliberate.

Without that pairing, fs path policy is theatre — anyone with `exec` access bypasses it. The two layers are designed together.

## Open questions

1. **Default workspace path.** Standardise on `/workspace/` across all backends? `host` backend already lives outside that convention.
2. **Symlink handling.** Resolve and re-check, or refuse to follow? Refusing is safer; resolving is more useful for agent ergonomics.
3. **Size limits.** Cap `file_read` at e.g. 5 MiB to keep tool results in-context-budget, with a `file_read_chunk(offset, length)` for larger files? Or a `file_search` primitive instead?
4. **Write atomicity.** Always write-to-temp-then-rename for `overwrite` mode, or trust the caller? Atomic-by-default avoids partial-write corruption.
