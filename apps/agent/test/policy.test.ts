import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildPrincipal,
  canAccess,
  DEFAULT_TOOL_GRANTS,
  matchesGrant,
  resolveToolGrants,
  type Grant,
  type PolicyRow,
  type Principal,
  type ToolPolicy,
} from '../src/core/index.js';

// ── matchesGrant ────────────────────────────────────────────────────────

test('matchesGrant: {type:any} matches everyone', () => {
  const grant: Grant = { type: 'any' };
  assert.ok(matchesGrant({ agentId: 'a', role: 'guest' }, grant));
  assert.ok(matchesGrant({ agentId: 'a', role: 'owner' }, grant));
  assert.ok(matchesGrant({ agentId: 'a' }, grant));
});

test('matchesGrant: {type:role} matches only that role', () => {
  const grant: Grant = { type: 'role', value: 'user' };
  assert.ok(matchesGrant({ agentId: 'a', role: 'user' }, grant));
  assert.ok(!matchesGrant({ agentId: 'a', role: 'guest' }, grant));
  assert.ok(!matchesGrant({ agentId: 'a', role: 'owner' }, grant));
  assert.ok(!matchesGrant({ agentId: 'a' }, grant));
});

test('matchesGrant: {type:user} matches only that userId', () => {
  const grant: Grant = { type: 'user', value: 'u-123' };
  assert.ok(matchesGrant({ agentId: 'a', userId: 'u-123' }, grant));
  assert.ok(!matchesGrant({ agentId: 'a', userId: 'u-456' }, grant));
  assert.ok(!matchesGrant({ agentId: 'a' }, grant));
});

// ── canAccess ───────────────────────────────────────────────────────────

test('canAccess: returns true if any grant matches', () => {
  const principal: Principal = { agentId: 'a', role: 'user' };
  const grants: Grant[] = [
    { type: 'role', value: 'owner' },
    { type: 'role', value: 'user' },
  ];
  assert.ok(canAccess(principal, grants));
});

test('canAccess: returns false if no grant matches', () => {
  const principal: Principal = { agentId: 'a', role: 'guest' };
  const grants: Grant[] = [
    { type: 'role', value: 'owner' },
    { type: 'role', value: 'user' },
  ];
  assert.ok(!canAccess(principal, grants));
});

test('canAccess: empty grants array denies everyone', () => {
  assert.ok(!canAccess({ agentId: 'a', role: 'owner' }, []));
});

// ── DEFAULT_TOOL_GRANTS parity with old GUEST_BLOCKED_TOOLS ─────────────

const OLD_GUEST_BLOCKED = new Set([
  'exec',
  'file_write', 'file_edit', 'file_delete',
  'schedule_create', 'schedule_update', 'schedule_delete', 'schedule_trigger',
  'mcp_enable', 'mcp_disable',
]);

test('guest is blocked from all previously blocked tools', () => {
  const guest = buildPrincipal('a', 'u1', 'guest');
  for (const tool of OLD_GUEST_BLOCKED) {
    const grants = DEFAULT_TOOL_GRANTS[tool];
    assert.ok(grants, `${tool} should have explicit grants`);
    assert.ok(!canAccess(guest, grants!), `guest should be blocked from ${tool}`);
  }
});

test('user can access all previously blocked tools', () => {
  const user = buildPrincipal('a', 'u1', 'user');
  for (const tool of OLD_GUEST_BLOCKED) {
    const grants = DEFAULT_TOOL_GRANTS[tool]!;
    assert.ok(canAccess(user, grants), `user should access ${tool}`);
  }
});

test('owner can access all tools', () => {
  const owner = buildPrincipal('a', 'u1', 'owner');
  for (const [tool, grants] of Object.entries(DEFAULT_TOOL_GRANTS)) {
    assert.ok(canAccess(owner, grants), `owner should access ${tool}`);
  }
});

test('tools not in DEFAULT_TOOL_GRANTS default to open', () => {
  const grants = resolveToolGrants(undefined, 'some_random_tool');
  assert.ok(canAccess({ agentId: 'a', role: 'guest' }, grants));
});

// ── resolveToolGrants with policy rows ──────────────────────────────────

test('resolveToolGrants: DB row overrides default', () => {
  const rows: PolicyRow[] = [{
    agentId: 'a',
    sandboxAlias: null,
    resourceType: 'tool',
    mode: null,
    resourceKey: 'exec',
    grants: [{ type: 'any' }],
  }];
  const grants = resolveToolGrants(rows, 'exec');
  assert.ok(canAccess({ agentId: 'a', role: 'guest' }, grants));
});

test('resolveToolGrants: falls back to default when no row', () => {
  const rows: PolicyRow[] = [];
  const grants = resolveToolGrants(rows, 'exec');
  assert.ok(!canAccess({ agentId: 'a', role: 'guest' }, grants));
});

// ── owner-only tools ────────────────────────────────────────────────────

test('instruction_update is owner-only', () => {
  const grants = DEFAULT_TOOL_GRANTS['instruction_update']!;
  assert.ok(canAccess(buildPrincipal('a', 'u1', 'owner'), grants));
  assert.ok(!canAccess(buildPrincipal('a', 'u1', 'user'), grants));
  assert.ok(!canAccess(buildPrincipal('a', 'u1', 'guest'), grants));
});

test('user management tools are owner-only', () => {
  const ownerOnlyTools = ['user_list', 'user_identity_link', 'user_identity_unlink', 'user_role_set', 'user_merge'];
  const user = buildPrincipal('a', 'u1', 'user');
  const owner = buildPrincipal('a', 'u1', 'owner');
  for (const tool of ownerOnlyTools) {
    const grants = DEFAULT_TOOL_GRANTS[tool]!;
    assert.ok(canAccess(owner, grants), `owner should access ${tool}`);
    assert.ok(!canAccess(user, grants), `user should NOT access ${tool}`);
  }
});

// ── buildPrincipal ──────────────────────────────────────────────────────

test('buildPrincipal omits undefined fields', () => {
  const p = buildPrincipal('agent-1');
  assert.equal(p.agentId, 'agent-1');
  assert.equal(p.userId, undefined);
  assert.equal(p.role, undefined);
});

test('buildPrincipal includes provided fields', () => {
  const p = buildPrincipal('agent-1', 'user-1', 'owner');
  assert.equal(p.agentId, 'agent-1');
  assert.equal(p.userId, 'user-1');
  assert.equal(p.role, 'owner');
});

// ── fixed vs configurable ToolPolicy ────────────────────────────────────

test('resolveToolGrants: fixed policy ignores DB rows', () => {
  const fixedPolicy: ToolPolicy = { kind: 'fixed', grants: [{ type: 'role', value: 'owner' }] };
  const rows: PolicyRow[] = [{
    agentId: 'a',
    sandboxAlias: null,
    resourceType: 'tool',
    mode: null,
    resourceKey: 'my_tool',
    grants: [{ type: 'any' }],
  }];
  const grants = resolveToolGrants(rows, 'my_tool', fixedPolicy);
  // Fixed policy should NOT be overridden by DB row
  assert.ok(!canAccess({ agentId: 'a', role: 'guest' }, grants));
  assert.ok(canAccess({ agentId: 'a', role: 'owner' }, grants));
});

test('resolveToolGrants: configurable policy uses DB row when present', () => {
  const configurablePolicy: ToolPolicy = {
    kind: 'configurable',
    defaultGrants: [{ type: 'role', value: 'owner' }],
  };
  const rows: PolicyRow[] = [{
    agentId: 'a',
    sandboxAlias: null,
    resourceType: 'tool',
    mode: null,
    resourceKey: 'my_tool',
    grants: [{ type: 'any' }],
  }];
  const grants = resolveToolGrants(rows, 'my_tool', configurablePolicy);
  // DB row should override the default
  assert.ok(canAccess({ agentId: 'a', role: 'guest' }, grants));
});

test('resolveToolGrants: configurable policy falls back to defaultGrants', () => {
  const configurablePolicy: ToolPolicy = {
    kind: 'configurable',
    defaultGrants: [{ type: 'role', value: 'owner' }],
  };
  const grants = resolveToolGrants([], 'my_tool', configurablePolicy);
  assert.ok(!canAccess({ agentId: 'a', role: 'guest' }, grants));
  assert.ok(canAccess({ agentId: 'a', role: 'owner' }, grants));
});
