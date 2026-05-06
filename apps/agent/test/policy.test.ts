import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildPrincipal,
  canAccess,
  matchesGrant,
  resolveFilePathGrants,
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

// ── Tools without declared policy default to open ───────────────────────

test('tools without declared policy default to open', () => {
  const grants = resolveToolGrants(undefined, 'some_random_tool');
  assert.ok(canAccess({ agentId: 'a', role: 'guest' }, grants));
});

// ── resolveToolGrants with policy rows ──────────────────────────────────

test('resolveToolGrants: DB row overrides default', () => {
  const rows: PolicyRow[] = [{
    agentId: 'a',
    resourceType: 'tool',
    scope: {},
    resourceKey: 'exec',
    grants: [{ type: 'any' }],
  }];
  const grants = resolveToolGrants(rows, 'exec');
  assert.ok(canAccess({ agentId: 'a', role: 'guest' }, grants));
});

test('resolveToolGrants: falls back to open when no row and no declared policy', () => {
  const rows: PolicyRow[] = [];
  const grants = resolveToolGrants(rows, 'exec');
  assert.ok(canAccess({ agentId: 'a', role: 'guest' }, grants));
});

// ── prefix matching ─────────────────────────────────────────────────────

test('resolveToolGrants: prefix pattern matches MCP tools', () => {
  const rows: PolicyRow[] = [{
    agentId: 'a',
    resourceType: 'tool',
    scope: {},
    resourceKey: 'mcp__weather__*',
    grants: [{ type: 'role', value: 'owner' }],
  }];
  const grants = resolveToolGrants(rows, 'mcp__weather__get_forecast');
  assert.ok(canAccess({ agentId: 'a', role: 'owner' }, grants));
  assert.ok(!canAccess({ agentId: 'a', role: 'guest' }, grants));
});

test('resolveToolGrants: prefix pattern does not match unrelated tools', () => {
  const rows: PolicyRow[] = [{
    agentId: 'a',
    resourceType: 'tool',
    scope: {},
    resourceKey: 'mcp__weather__*',
    grants: [{ type: 'role', value: 'owner' }],
  }];
  const grants = resolveToolGrants(rows, 'mcp__calendar__list');
  // No match → falls back to OPEN
  assert.ok(canAccess({ agentId: 'a', role: 'guest' }, grants));
});

test('resolveToolGrants: exact match takes priority over prefix', () => {
  const rows: PolicyRow[] = [
    {
      agentId: 'a', resourceType: 'tool', scope: {},
      resourceKey: 'mcp__weather__*',
      grants: [{ type: 'role', value: 'owner' }],
    },
    {
      agentId: 'a', resourceType: 'tool', scope: {},
      resourceKey: 'mcp__weather__public_status',
      grants: [{ type: 'any' }],
    },
  ];
  // Exact match → open to everyone
  const grants = resolveToolGrants(rows, 'mcp__weather__public_status');
  assert.ok(canAccess({ agentId: 'a', role: 'guest' }, grants));
  // Other tools in same prefix → owner only
  const grants2 = resolveToolGrants(rows, 'mcp__weather__get_forecast');
  assert.ok(!canAccess({ agentId: 'a', role: 'guest' }, grants2));
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
    resourceType: 'tool',
    scope: {},
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
    resourceType: 'tool',
    scope: {},
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

// ── resolveFilePathGrants ─────────────────────────────────────────────

test('resolveFilePathGrants: returns undefined when no file rows', () => {
  assert.equal(resolveFilePathGrants([], 'primary', 'read', '/workspace/foo.txt'), undefined);
});

test('resolveFilePathGrants: matches path prefix', () => {
  const rows: PolicyRow[] = [{
    agentId: 'a', resourceType: 'file', resourceKey: 'primary:read:/workspace/',
    grants: [{ type: 'role', value: 'user' }],
    scope: { sandbox: 'primary', mode: 'read', path: '/workspace/' },
  }];
  const grants = resolveFilePathGrants(rows, 'primary', 'read', '/workspace/foo.txt');
  assert.deepEqual(grants, [{ type: 'role', value: 'user' }]);
});

test('resolveFilePathGrants: longest prefix wins', () => {
  const rows: PolicyRow[] = [
    {
      agentId: 'a', resourceType: 'file', resourceKey: 'primary:read:/workspace/',
      grants: [{ type: 'any' }],
      scope: { sandbox: 'primary', mode: 'read', path: '/workspace/' },
    },
    {
      agentId: 'a', resourceType: 'file', resourceKey: 'primary:read:/workspace/private/',
      grants: [{ type: 'role', value: 'owner' }],
      scope: { sandbox: 'primary', mode: 'read', path: '/workspace/private/' },
    },
  ];
  const g1 = resolveFilePathGrants(rows, 'primary', 'read', '/workspace/public/x');
  assert.deepEqual(g1, [{ type: 'any' }]);
  const g2 = resolveFilePathGrants(rows, 'primary', 'read', '/workspace/private/secret.txt');
  assert.deepEqual(g2, [{ type: 'role', value: 'owner' }]);
});

test('resolveFilePathGrants: wildcard sandbox matches any', () => {
  const rows: PolicyRow[] = [{
    agentId: 'a', resourceType: 'file', resourceKey: '*:read:/workspace/',
    grants: [{ type: 'any' }],
    scope: { sandbox: '*', mode: 'read', path: '/workspace/' },
  }];
  const grants = resolveFilePathGrants(rows, 'whatever', 'read', '/workspace/foo.txt');
  assert.deepEqual(grants, [{ type: 'any' }]);
});

test('resolveFilePathGrants: mode must match', () => {
  const rows: PolicyRow[] = [{
    agentId: 'a', resourceType: 'file', resourceKey: 'primary:read:/workspace/',
    grants: [{ type: 'any' }],
    scope: { sandbox: 'primary', mode: 'read', path: '/workspace/' },
  }];
  const grants = resolveFilePathGrants(rows, 'primary', 'write', '/workspace/foo.txt');
  assert.deepEqual(grants, []);
});

test('resolveFilePathGrants: no matching path denies', () => {
  const rows: PolicyRow[] = [{
    agentId: 'a', resourceType: 'file', resourceKey: 'primary:read:/workspace/public/',
    grants: [{ type: 'any' }],
    scope: { sandbox: 'primary', mode: 'read', path: '/workspace/public/' },
  }];
  const grants = resolveFilePathGrants(rows, 'primary', 'read', '/workspace/private/foo.txt');
  assert.deepEqual(grants, []);
});
