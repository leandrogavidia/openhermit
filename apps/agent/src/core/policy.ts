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

// ── Default tool grants ─────────────────────────────────────────────────
//
// Encodes the same policy that GUEST_BLOCKED_TOOLS enforced: the tools
// listed below are restricted to owner + user; everything else is open.
// When an agent_policies row exists for a tool, it overrides the default.

const OWNER_AND_USER: Grant[] = [
  { type: 'role', value: 'owner' },
  { type: 'role', value: 'user' },
];

const OWNER_ONLY: Grant[] = [{ type: 'role', value: 'owner' }];

const OPEN: Grant[] = [{ type: 'any' }];

export const DEFAULT_TOOL_GRANTS: Record<string, Grant[]> = {
  // exec
  exec: OWNER_AND_USER,
  // file — write ops restricted, read ops open
  file_write: OWNER_AND_USER,
  file_edit: OWNER_AND_USER,
  file_delete: OWNER_AND_USER,
  // schedules
  schedule_create: OWNER_AND_USER,
  schedule_update: OWNER_AND_USER,
  schedule_delete: OWNER_AND_USER,
  schedule_trigger: OWNER_AND_USER,
  // MCP management
  mcp_enable: OWNER_AND_USER,
  mcp_disable: OWNER_AND_USER,
  // memory (guests cannot write)
  memory_add: OWNER_AND_USER,
  memory_update: OWNER_AND_USER,
  memory_delete: OWNER_AND_USER,
  working_memory_update: OWNER_AND_USER,
  // instructions — owner only
  instruction_update: OWNER_ONLY,
  // user management — owner only
  user_list: OWNER_ONLY,
  user_identity_link: OWNER_ONLY,
  user_identity_unlink: OWNER_ONLY,
  user_role_set: OWNER_ONLY,
  user_merge: OWNER_ONLY,
};

// ── Resolution helpers ──────────────────────────────────────────────────

export const resolveToolGrants = (
  policyRows: PolicyRow[] | undefined,
  toolName: string,
): Grant[] => {
  if (policyRows) {
    const row = policyRows.find(
      (r) => r.resourceType === 'tool' && r.resourceKey === toolName,
    );
    if (row) return row.grants as Grant[];
  }
  return DEFAULT_TOOL_GRANTS[toolName] ?? OPEN;
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
