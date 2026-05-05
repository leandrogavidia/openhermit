import type { UserRole } from '@openhermit/store';

// ── Grant ───────────────────────────────────────────────────────────────

export type Grant =
  | { type: 'any' }
  | { type: 'role'; value: UserRole }
  | { type: 'user'; value: string };

// ── Principal ───────────────────────────────────────────────────────────

export interface Principal {
  userId?: string;
  role?: UserRole;
  agentId: string;
}

// ── PolicyRow (matches DB shape) ────────────────────────────────────────

export interface PolicyRow {
  agentId: string;
  sandboxAlias: string | null;
  resourceType: string;
  mode: string | null;
  resourceKey: string;
  grants: unknown[];
}

// ── Tool policy ─────────────────────────────────────────────────────────

export type ToolPolicy =
  | { kind: 'fixed'; grants: Grant[] }
  | { kind: 'configurable'; defaultGrants: Grant[] };

// ── Core evaluation ─────────────────────────────────────────────────────

export const matchesGrant = (principal: Principal, grant: Grant): boolean => {
  switch (grant.type) {
    case 'any':
      return true;
    case 'role':
      return principal.role === grant.value;
    case 'user':
      return !!principal.userId && principal.userId === grant.value;
  }
};

export const canAccess = (principal: Principal, grants: Grant[]): boolean =>
  grants.some((g) => matchesGrant(principal, g));

const OPEN: Grant[] = [{ type: 'any' }];

// ── Resolution helpers ──────────────────────────────────────────────────

const findPolicyRow = (
  rows: PolicyRow[],
  resourceType: string,
  key: string,
): PolicyRow | undefined => {
  // Exact match first
  const exact = rows.find(
    (r) => r.resourceType === resourceType && r.resourceKey === key,
  );
  if (exact) return exact;
  // Prefix match: resourceKey ending with '*' (e.g. "mcp__weather__*")
  return rows.find(
    (r) =>
      r.resourceType === resourceType &&
      r.resourceKey.endsWith('*') &&
      key.startsWith(r.resourceKey.slice(0, -1)),
  );
};

export const resolveToolGrants = (
  policyRows: PolicyRow[] | undefined,
  toolName: string,
  declaredPolicy?: ToolPolicy,
): Grant[] => {
  if (declaredPolicy) {
    if (declaredPolicy.kind === 'fixed') return declaredPolicy.grants;
    if (policyRows) {
      const row = findPolicyRow(policyRows, 'tool', toolName);
      if (row) return row.grants as Grant[];
    }
    return declaredPolicy.defaultGrants;
  }
  if (policyRows) {
    const row = findPolicyRow(policyRows, 'tool', toolName);
    if (row) return row.grants as Grant[];
  }
  return OPEN;
};

export const buildPrincipal = (
  agentId: string,
  userId?: string,
  role?: UserRole,
): Principal => ({
  agentId,
  ...(userId ? { userId } : {}),
  ...(role ? { role } : {}),
});
