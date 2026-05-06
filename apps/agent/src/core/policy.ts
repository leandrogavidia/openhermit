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
  resourceType: string;
  resourceKey: string;
  grants: unknown[];
  scope: Record<string, unknown>;
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

// ── File path policy ───────────────────────────────────────────────────

export type FileMode = 'read' | 'write';

interface FileScope {
  sandbox: string;
  mode: FileMode;
  path: string;
}

const parseFileScope = (row: PolicyRow): FileScope | undefined => {
  const s = row.scope;
  if (typeof s.sandbox !== 'string' || typeof s.mode !== 'string' || typeof s.path !== 'string') {
    return undefined;
  }
  return { sandbox: s.sandbox, mode: s.mode as FileMode, path: s.path };
};

/**
 * Resolve file path-level grants. Returns undefined if no file policy rows
 * exist (caller should fall back to tool-level policy). Returns Grant[] if
 * a matching row is found. Returns empty [] (deny) if rows exist but none match.
 */
export const resolveFilePathGrants = (
  fileRows: PolicyRow[],
  sandbox: string,
  mode: FileMode,
  path: string,
): Grant[] | undefined => {
  if (fileRows.length === 0) return undefined;

  let bestMatch: PolicyRow | undefined;
  let bestLen = -1;

  for (const row of fileRows) {
    const scope = parseFileScope(row);
    if (!scope) continue;
    if (scope.mode !== mode) continue;
    if (scope.sandbox !== '*' && scope.sandbox !== sandbox) continue;
    if (!path.startsWith(scope.path)) continue;
    // Longer path prefix = more specific match
    if (scope.path.length > bestLen) {
      bestLen = scope.path.length;
      bestMatch = row;
    }
  }

  if (bestMatch) return bestMatch.grants as Grant[];
  return [];
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
