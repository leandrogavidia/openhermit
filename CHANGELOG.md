# Changelog

## 0.5.2 — 2026-05-05

### Fixes

- `hermit --version` now reads from `package.json` instead of a hardcoded string.

---

## 0.5.1 — 2026-05-05

### First-class filesystem tools

Six new tools (`file_read`, `file_write`, `file_edit`, `file_list`, `file_stat`, `file_delete`) give agents direct filesystem access inside their sandbox, replacing the previous pattern of shelling out via `exec`. `file_read` supports line ranges (`offset`/`limit`), and `file_edit` provides find-and-replace semantics. All three sandbox backends (host/docker bind-mount, E2B, Daytona) are supported.

### Cross-channel identity link

Users can now link their identities across channels (Telegram, CLI, web, Discord) via `identity_link_request` / `identity_link_confirm` tools. A token generated on one channel can be confirmed on another to merge the accounts. Ghost users created during the link flow are absorbed into the confirmed identity.

### Security: symlink escape detection

`HostFileBackend` (used by the `host` and `docker` backends) now resolves all paths through `realpath` before performing I/O, then re-checks the resolved path falls within the sandbox root. This prevents agents from escaping the workspace via symlinks.

### Fixes

- Identity tools now register for guest users on Telegram (channel info is threaded through `refreshAgentConfiguration`).
- Identity link tool descriptions improved for discoverability with weaker models.
- `file_write` overwrite mode no longer uses atomic temp+rename (which broke on cross-device mounts).
- System prompt now directs agents to prefer file tools over exec for file operations.
- Discord channel turn serialization fixed (#12), runtime dependency bundling fixed (#11).

### Refactor

- `exec-backend.ts` (1385 lines) split into `core/backends/` folder: `docker.ts`, `host.ts`, `e2b.ts`, `daytona.ts`, `file-backend.ts`, `shared.ts`.

### Docs

- `tools.md` and `fs-tools.md` updated with all new tools.
- Access policy proposal and sandbox model docs refreshed.

---

## 0.5.0 — 2026-05-04

### Sandboxes are first-class

Sandboxes used to live inside each agent's config as `exec.backends[]`. They are now stored as rows in a `sandboxes` table, with their own lifecycle (`pending` → `provisioned` → `deleted`), per-row `runtime_state` for cross-restart reconnection, and a per-agent `(agent_id, alias)` partial-unique index that allows re-using an alias after soft-delete.

The runtime constructs each agent's `ExecBackendManager` from these rows; the legacy `exec.backends[]` path remains as a fallback when no rows exist (mid-backfill or sandbox store unavailable).

### Sandbox presets in `gateway.json`

`autoProvisionSandbox` is no longer an inline `{ enabled, type, config }` object — it now references a named preset:

```json
{
  "sandboxPresets": {
    "docker-ubuntu":   { "type": "docker",  "config": { "image": "ubuntu:24.04", "username": "root", "agent_home": "/root" } },
    "e2b-default":     { "type": "e2b",     "config": { "template": "base" } },
    "daytona-default": { "type": "daytona", "config": {} }
  },
  "autoProvisionSandbox": "docker-ubuntu"
}
```

**Breaking** — gateways carrying the legacy shape will refuse to start with a clear migration message. Move the inline config into `sandboxPresets[<name>]` and set `autoProvisionSandbox: "<name>"`.

`POST /api/agents` (and the admin UI's create-agent dialog) accept a new `sandbox` field:

- omitted → use the gateway's `autoProvisionSandbox`
- `"<preset>"` → provision that preset
- `null` → skip sandbox provisioning entirely

`GET /api/sandbox-presets` returns the registry to authenticated users so frontends can populate dropdowns.

### Daytona backend

New `daytona` backend type alongside `host` / `docker` / `e2b`. Set `DAYTONA_API_KEY` in the gateway env, then pick `daytona` as a preset type or pass `--type daytona` to `hermit sandbox add`. Archived sandboxes (idle 7d+) are recovered transparently on `ensure()` via `start()`.

### Access policy enforced end-to-end

The `access` field on the agent's security policy (`public` / `protected` / `private`) is now enforced at session-open time:

- A sender with no membership row on a non-public agent is rejected (404) **before** any message is processed.
- Globally-known users (registered via another agent on the gateway) no longer auto-claim a guest role on `private` / `protected` agents — they must be added explicitly via `/members`.
- The create-agent dialog gained an Access dropdown so operators can pick the level at create time.

### Sandboxes admin tab

The admin UI's `Containers` tab is now `Sandboxes` and reads from the `sandboxes` table directly, overlaying live `docker ps` runtime info for docker rows (`—` when the container isn't on this host).

### Misc

- `host` backend now enforces single-instance-per-gateway at the API layer (was previously enforced inside the backend).
- Soft-deleted sandbox aliases can be reused immediately (partial unique index migration `0009`).
- New CLI flags: `hermit agents create --sandbox <preset>` / `--no-sandbox`.

---

Earlier history: see git tag list (v0.4.16 and prior).
