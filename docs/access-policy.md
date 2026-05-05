# Access Policy

> **Status: Phase 0–2.5 implemented.** Phase 3 (exec command whitelist, circles) is not yet built. Open questions are called out at the end; some have been resolved by the implementation.

OpenHermit currently gates a few sensitive operations through scattered role checks (e.g. a `GUEST_BLOCKED_TOOLS` set in the agent runner, `requireOwnerOrAdmin` middleware on management routes). This document proposes a unified access-policy model so that **all** caller-visible resources are gated through one mechanism.

## Goals

- One central `canAccess(principal, resource)` decision point. No scattered `if role === ...` checks.
- Same shape for every resource type: a resource carries a list of grants describing who may use it.
- Per-agent configurable, with sensible defaults.
- Extensible to new resource types without touching call sites.
- Extensible to new principal kinds (specific user today; groups later) without rewriting call sites.

## Non-goals

- Per-conversation sandbox isolation. The sandbox is the agent's "computer" and is shared across callers.
- Secret-level ACL. Secrets are not injected into the sandbox today; gating happens at the tool layer.
- Output-side redaction. Handled at the input layer (memory / file visibility) instead.
- Quota and rate limiting. Tracked separately from access policy.

## Core abstraction

```ts
interface Principal {
  userId: string;
  role: 'owner' | 'user' | 'guest';
  agentId: string;
}

type Resource =
  | { type: 'tool'; name: string }
  | { type: 'skill'; id: string }
  | { type: 'mcp'; id: string }
  | { type: 'memory'; namespace: string }
  | { type: 'file'; path: string; mode: 'read' | 'write' }
  | { type: 'session'; id: string };

canAccess(principal: Principal, resource: Resource): boolean;
```

Every gate point — tool list assembly, memory read/write, file read/write, session listing, skill listing — calls this one function. Implementations live in `packages/policy/`.

## Grants

Each resource carries a list of **grants**. A grant describes a class of principals that is allowed. A principal passes if it matches **any** grant.

```ts
type Grant =
  | { type: 'any' }                                       // anyone reaching this gate
  | { type: 'role'; value: 'owner' | 'user' | 'guest' }   // any principal with this role
  | { type: 'user'; value: string };                      // a specific userId
```

Why polymorphic instead of just `allowed_roles: text[]`:

- **Per-user grants** without inventing a custom role per user.
- **Future-proof** — group/team grants slot in as a new variant without schema change.
- `{type:'any'}` is its own variant rather than "list every current role" — adding a fourth role later won't silently restrict policies that meant "open to everyone".

Stored as `jsonb` so the array of objects round-trips naturally. There is no row-level "deny" — absence of a matching grant is denial. Deny-override semantics can be added later if needed.

## Resource declaration

| Table | Field(s) | Notes |
|-------|----------|-------|
| `memories` | `grants: jsonb` | Per-memory visibility during retrieval. Default `[]` = open. See "Memory grants" below. |
| `agent_policies` | `(agent_id, sandbox_alias, resource_type, mode, resource_key, grants: jsonb)` | Unified table for all policy resources (tools, files, exec, future types). `mode` is `'read'` / `'write'` where meaningful, `NULL` otherwise. `sandbox_alias` is set for sandbox-scoped resources (files); `NULL` means "any sandbox of this agent" or "not sandbox-scoped". Supports `*` suffix for prefix matching on `resource_key` (e.g. `mcp__weather__*` covers all tools from that MCP server). |

**Not in the policy table:**

- **Skills** — managed via filesystem (install/remove skill files). Not gated through policy.
- **MCP servers** — individual MCP *tools* are gated through `agent_policies` with `resource_type='tool'` and prefix matching (`mcp__<serverId>__*`). No `grants` column on `agent_mcp_servers`.

Sessions don't carry a configurable visibility field. The rule is fixed and lives in `canAccessSession`:

- `owner` — sees all sessions on the agent.
- everyone else — sees sessions they participated in (resolved through `merge_target` so merged users see history from both pre-merge identities).

`agent_skills` and `agent_mcp_servers` do **not** carry their own grants columns. Skills are managed via the filesystem (owners install/remove skill files). MCP tools are gated via `agent_policies` rows with `resource_type='tool'` and prefix matching on the `mcp__<serverId>__` prefix — one wildcard row covers all tools from a server.

### `agent_policies` example

```
(agent='foo', sandbox_alias=NULL,        type='tool', mode=NULL,    key='exec',
  grants=[{type:'role', value:'owner'}])

(agent='foo', sandbox_alias=NULL,        type='tool', mode=NULL,    key='schedule_create',
  grants=[{type:'role', value:'owner'}, {type:'user', value:'user-abc'}])

(agent='foo', sandbox_alias=NULL,        type='exec', mode=NULL,    key='*',
  grants=[{type:'role', value:'owner'}])

(agent='foo', sandbox_alias='primary',   type='exec', mode=NULL,    key='git status@/workspace/repo',
  grants=[{type:'role', value:'user'}])

(agent='foo', sandbox_alias='primary',   type='exec', mode=NULL,    key='pnpm test@/workspace/repo',
  grants=[{type:'user', value:'user-abc'}])

(agent='foo', sandbox_alias=NULL,        type='file', mode='read',  key='/workspace/public/',
  grants=[{type:'any'}])

(agent='foo', sandbox_alias=NULL,        type='file', mode='write', key='/workspace/public/',
  grants=[{type:'role', value:'owner'}, {type:'role', value:'user'}])

(agent='foo', sandbox_alias='throwaway', type='file', mode='write', key='/workspace/',
  grants=[{type:'any'}])

(agent='foo', sandbox_alias=NULL,        type='file', mode='read',  key='/workspace/',
  grants=[{type:'role', value:'owner'}])

(agent='foo', sandbox_alias=NULL,        type='file', mode='write', key='/workspace/',
  grants=[{type:'role', value:'owner'}])
```

Match semantics for `resource_key` are per-type and live in `canAccess`:

- `tool` — exact match first, then prefix match (`resource_key` ending with `*`). Exact takes priority. `sandbox_alias` and `mode` ignored (always NULL for tool rows).
- `file` — longest-prefix match, scoped to the requested mode and sandbox. Sandbox-specific rows override `sandbox_alias IS NULL` rows for the same key.
- `exec` — see "Exec command whitelist" below.

If no rule matches, deny. Adding a new resource type means adding one branch in `canAccess`, no schema migration.

When a new resource type is introduced (e.g. `network`, `db_query`), use `mode` if read and write differ in a way operators legitimately want to gate separately, and use `sandbox_alias` if the resource is sandbox-bound. Otherwise leave them NULL.

Index: `(agent_id, sandbox_alias, resource_type, mode, resource_key)`.

Admin UI should expose a "read + write" shortcut that emits two rows with the same grants, since most file rules share permissions across both modes.

See [fs-tools.md](./fs-tools.md) for how file paths and the `sandbox_alias` column are used by the file tools layer.

### Exec command whitelist

`exec` is the one tool whose argument carries security-relevant content (the shell command itself). A binary "this principal may call exec" grant either gives them all of shell or none of it. To split the difference, `exec` has its own resource type with **exact full-command matching**.

Two row shapes:

- `key='*'` — wildcard. Principals matching the grants may run **any** command.
- `key='<normalized command>@<cwd>'` — exact match. Principals matching the grants may run **this exact command in this exact cwd**, nothing else.

Why exact and not prefix:

```
approved: 'git status' @ /workspace/repo
attempt:  'git status; cat /etc/passwd'  → different string → deny
attempt:  'git status --quiet'           → different string → deny
attempt:  'git  status' (double space)   → after normalization same → allow
```

Compound commands, flag injection, and cwd traversal are all blocked because the entire string must equal an approved entry. Owner who wants `--quiet` adds another row.

Normalization before comparison:

- Trim leading/trailing whitespace.
- Collapse internal runs of whitespace to a single space.
- Reject newlines (a multi-line "command" is not a single shell invocation).
- No variable expansion, no shell parsing.

`canAccess` for an exec attempt:

```ts
canAccess(principal, {type:'exec', command, cwd, sandbox}):
  rows = policies for (agent, sandbox or NULL, type='exec')
  if any row with key='*' matches principal in grants → allow
  if any row with key=`${normalize(command)}@${cwd}` matches principal in grants → allow
  deny
```

Owners typically have one `key='*'` row granting them everything; non-owner roles get specific commands enumerated row-by-row. Exec stays a `string` argument; no argv migration needed.

This solves the practical case of "let user run a few specific commands" without opening shell to them. For parameterised commands (e.g. let user run any `npm` subcommand), a custom tool wrapping that command is still the better fit — see fs-tools.md "exec coexistence".

### Policy management tools (implemented)

Three owner-only fixed-rule tools manage the `agent_policies` table:

```
policy_list(resourceType?: string)
  policy: { kind: 'fixed', grants: [{type:'role', value:'owner'}] }

policy_set(resourceKey, grants, resourceType?, sandboxAlias?, mode?)
  policy: { kind: 'fixed', grants: [{type:'role', value:'owner'}] }

policy_delete(resourceKey, resourceType?, sandboxAlias?, mode?)
  policy: { kind: 'fixed', grants: [{type:'role', value:'owner'}] }
```

`policy_set` upserts a row — if a row already exists for the same `(agent, sandbox, type, mode, key)`, its grants are replaced.

These are also exposed via:
- **API**: `GET/POST/DELETE /api/agents/:agentId/policies`
- **SDK**: `listPolicies()`, `upsertPolicy()`, `deletePolicy()`
- **CLI**: `hermit config policy list/set/delete`
- **Web admin UI**: "Policies" tab with presets (Everyone, Owner only, Owner+User, Custom JSON)

When a tool call is denied because the calling principal lacks a grant, the agent can suggest the user ask the owner to run `policy_set` to grant access.

#### Example flow

User on web chat:
> User: read `/workspace/notes/architecture.md` for me
> Agent: I don't have permission to read that file under your role. Forward this to your owner to request access:
> ```
> Grant request from user-xyz:
>   read file /workspace/notes/architecture.md (sandbox: primary)
> ```

User pastes that message to owner via Slack DM.

Owner in their own conversation with the agent:
> Owner: grant user-xyz read access to /workspace/notes/architecture.md on the primary sandbox
> Agent: [policy_grant(resource={type:'file', sandbox_alias:'primary', mode:'read', key:'/workspace/notes/architecture.md'}, grant={type:'user', value:'user-xyz'})] Done.

User retries the original request and it now succeeds.

#### Rationale for stateless design

A `pending_policy_requests` table was considered and rejected. Owners would otherwise see opaque request IDs and have to look them up; with a self-describing descriptor, the owner sees exactly what they're approving in plain text. Conversation history serves as the audit trail; if more structured audit is needed later, `agent_policies` rows can carry `granted_by`, `granted_at` columns without changing the grant flow itself.

A user could tamper with the descriptor before forwarding it, but that is not a privilege escalation — the owner approves what they read, so any tampering changes only the user's own request.

The agent's denial output must include the full structured descriptor (path, mode, sandbox), not a vague paraphrase. This is enforced via the `policy_grant` tool description, which instructs the agent on the required format.

### Memory grants

Memories belong to the agent, not to any user. Conceptually a memory is something the agent learned or chose to remember during a conversation. Grants on a memory don't express ownership; they express **visibility during retrieval** — when someone is talking to the agent, which memories are eligible to be pulled into context.

Memory grants are single-dimensional (no read/write split). The "write" path is governed by the `memory_save` tool's grants, not by per-memory ACLs.

#### Why grants live per-memory, not in `agent_policies`

It's tempting to move memory ACLs into `agent_policies` with path-prefix matching (one rule covering many memories), the way file ACLs work. We deliberately don't:

1. **Memories have no natural path.** Files do; memory entries are free-form text. A path-based scheme forces the agent to invent a category at write time and stay consistent with it across sessions. LLMs drift, paths fragment, rules under-cover.
2. **Per-user visibility loses expressiveness.** With the `{userId}` placeholder removed from path matching, `[{type:'user', value:'abc'}]` on a memory row stays clean; a path scheme would need either one rule per user (rule explosion) or special-case logic in `canAccess` (breaks uniformity).
3. **Bulk management has a better answer.** The pain that drives "I want one rule covering many memories" is real, but the fix is conversational batch editing via `memory_update_grants`, not a rigid path taxonomy. Semantic retrieval at edit time is more reliable than ahead-of-time tagging.

If a "policy templates that pre-fill grants on save" feature is ever needed, it can be added as a derivation layer on top of per-memory grants without changing this model.

Examples:

```
content="user-abc prefers dark mode"
  grants=[{type:'user', value:'user-abc'}]
  // only retrieved when user-abc is the conversation partner

content="deploy command for this repo is `pnpm deploy:prod`"
  grants=[{type:'any'}]
  // always eligible

content="last prod deploy failed because of env var X"
  grants=[{type:'role', value:'owner'}]
  // only surfaced when owner is debugging
```

The `memory_add` tool accepts an optional `grants` parameter so the agent can set visibility at creation time. Default is `[]` (open to everyone), matching backward-compatible behavior.

### Editing memory grants conversationally (implemented)

Owners get a built-in tool to update grants on existing memories:

```
memory_set_grants(key: string, grants: Grant[])
  policy: { kind: 'fixed', grants: [{type:'role', value:'owner'}] }
```

Typical flow:

```
Owner: lock the deploy credentials memory to owner-only

Agent: [memory_set_grants(key="project/deploy-creds",
         grants=[{type:"role", value:"owner"}])] done.
```

This tool is **fixed-rule, owner-only**. Editing memory ACLs is itself an ACL-sensitive operation; configurability would just create a reconfiguration footgun.

Read-side filtering is implemented in all memory read tools (`memory_get`, `memory_list`, `memory_recall`): each builds a `Principal` from the current user context and filters results through `canAccess`. Entries whose grants don't match the principal are silently excluded (or return "not found" for exact-key lookups).

## Grants are necessary, not sufficient

A grant decides whether a principal is **eligible to attempt** an operation. It does not certify the operation is safe to execute. Sensitive tools should layer their own verification on top.

Identity binding is the canonical example. `identity_link` lets a caller claim "this channel identity is also me". Even if grants restricted it to owner, an owner account compromise would let the attacker absorb every identity on the platform. The robust design is:

- `identity_link_request()` and `identity_link_confirm(token)` both have grants = `[{type:'any'}]`.
- The tool enforces a two-step flow that uses the channel itself as the proof of possession:
  1. The user, already authenticated on channel A, calls `identity_link_request()`. The system returns a short-lived token (e.g. 30 minutes) bound to the requesting user.
  2. The user goes to channel B and tells the agent to confirm the link, passing the token. When the agent calls `identity_link_confirm(token)`, the runtime already knows the caller's `(channel, channelUserId)` from B's auth context.
  3. The runtime binds the resolved B-identity to the user that requested the token.
- The user never needs to know or type channel IDs. The act of speaking from channel B with a valid token is itself the proof.
- The same flow applies to owners. There is no role-based bypass.

This pattern generalises: where a verification step exists that genuinely proves authority, prefer it over coarse role gating. Roles are a blunt fallback for operations that can't be verified.

`identity_link_confirm` also absorbs the merge case: if the channel identity being linked is already bound to a different user, the runtime merges that user into the requester (transferring identities, sessions, memberships, memories). The token + cross-channel proof is sufficient evidence that the same person controls both. There is no separate user-facing `identity_merge` tool. An owner-only admin operation for manual deduplication exists outside the policy model (admin UI / CLI), used for edge cases like a lost channel account.

## Fixed vs configurable tools

Not every tool's policy belongs in `agent_policies`. Some tools have a security contract that is part of the tool itself; letting an owner reconfigure it would break the tool's invariants. The model distinguishes two kinds:

**Fixed-rule tools.** Grants are baked into the tool definition. `agent_policies` is not consulted for these tools, and the admin UI doesn't expose them as editable. Examples:

- `identity_link_request` / `identity_link_confirm` — always `[{type:'any'}]`; safety comes from the token + channel-proof flow inside the handler.
- `memory_get`, `memory_list`, `memory_recall` — always `[{type:'any'}]` at the tool level; per-memory grants filter individual entries at read time.
- `memory_set_grants` — owner-only by design; see Memory grants section.
- `mcp_enable`, `mcp_disable` — owner-only; structural changes to the agent's tool surface.
- `working_memory_update`, `session_description_update` — grants `[]` (system-only); these run under introspection on behalf of the system, never user-invoked.
- `policy_list`, `policy_set`, `policy_delete` — owner-only; see Policy management tools.

**Configurable tools.** A default grant is declared in the tool definition; `agent_policies` rows on a given agent override it. Admin UI exposes them. Examples:

- `file_read`, `file_list`, `file_stat` — default: owner + user (guests blocked).
- `file_write`, `file_edit`, `file_delete` — default: owner only.
- `memory_add`, `memory_update`, `memory_delete` — default: owner + user.
- `exec`, `schedule_*` — configurable per agent.

Tool declaration carries the kind:

```ts
defineTool({
  name: 'identity_link_confirm',
  policy: { kind: 'fixed', grants: [{type:'any'}] },
  handler: ...  // does the token verification
});

defineTool({
  name: 'exec',
  policy: { kind: 'configurable', defaultGrants: [{type:'role', value:'owner'}] },
  handler: ...
});
```

`canAccess` for a tool: `kind:'fixed'` uses the declared grants directly; `kind:'configurable'` looks up `agent_policies(agent_id, 'tool', name)` and falls back to `defaultGrants` if no row exists.

Decision rule for a new tool: if a different agent could legitimately want a different policy, it's configurable. If a wrong setting would break the agent's basic safety or capability model, it's fixed.

## Roles

Three levels, unchanged from today:

- `owner` — full management and tool access.
- `user` — authenticated, standard interaction.
- `guest` — anonymous or low-trust, restricted by default.

## Future: circles

Per-user grants are precise but tedious once an owner has more than a handful of people to authorise individually. The `Grant` type is designed to extend with a `circle` variant for owner-defined sets of users:

```ts
type Grant =
  | { type: 'any' }
  | { type: 'role';   value: 'owner'|'user'|'guest' }
  | { type: 'user';   value: string }
  | { type: 'circle'; value: string };   // 'family' | 'colleagues' | 'beta-testers' | ...
```

### Why circles instead of more roles

Roles and circles answer different questions:

- **Roles** are a fixed trust hierarchy (owner > user > guest) used by system-level fallbacks (session visibility, default fixed-rule tool policies). Adding a role changes systemic trust assumptions and should stay rare.
- **Circles** are flat, owner-defined labels with no internal ordering. Their only job is to organise grants. A user may belong to multiple circles; matching is OR.

A user not in any circle is unaffected; circle grants are purely additive.

### Schema

```
agent_circles            (agent_id, name, description, created_at)
                         PK (agent_id, name)

user_agent_circles       (agent_id, user_id, circle_name, added_at)
                         PK (agent_id, user_id, circle_name)
```

Membership is loaded into the principal context at auth time so `canAccess` doesn't hit the DB per call.

### Tools

Owner-only fixed-rule built-ins, conversational like `policy_grant`:

```
circle_create(name, description?)
circle_delete(name)
circle_add(circle, userId)
circle_remove(circle, userId)
circle_list(name?)            // self / cross-circle gated like policy_list
```

`policy_grant` accepts `{type:'circle', value:'family'}` directly; no separate API.

### When to build

Slated for after the per-user grant mechanism is in production and shows real demand for batched authorization. Not a P1 concern — a single `circle` variant slots in without disturbing existing rows.

## Phased rollout

- **Phase 1 — central policy foundation.** ✅ `agent_policies` table, central `canAccess` + `resolveToolGrants`, removed `GUEST_BLOCKED_TOOLS` and `DEFAULT_TOOL_GRANTS`. Every built-in tool declares its own `ToolPolicy` (fixed or configurable). Decoupled tool creation from role gating.
- **Phase 2 — admin surface.** ✅ `policy_list/set/delete` owner tools, API endpoints, SDK, CLI, web admin UI with Policies tab.
- **Phase 2.5 — per-memory grants.** ✅ `grants` column on `memories` table, memory read tools filter by principal, `memory_add` accepts grants, `memory_set_grants` owner tool.
- **Phase 3 — exec command whitelist + circles.** 🔲 Not yet implemented. See sections above for design.

## Open questions

1. ~~**Memory default grants** — when an agent saves a memory without specifying audience, default to `[{type:'any'}]` (backward compatible) or to a per-conversation default like `[{type:'user', value: principal.userId}]` (safer)?~~ **Resolved:** default is `[]` (open to everyone), backward compatible. Agent can pass explicit grants via `memory_add`.
2. **File policy defaults on new agents** — ship a template (public/shared/owner tiers) or default empty so only owner can use fs until configured?
3. ~~**Is P0 worth its own milestone?**~~ **Resolved:** Phase 1 combined the refactor with the policy foundation.
