import { Type, type Static } from '@mariozechner/pi-ai';
import { ValidationError } from '@openhermit/shared';

import {
  type PolicyAwareTool,
  type Toolset,
  type ToolContext,
  asTextContent,
  formatJson,
  ensureAutonomyAllows,
} from './shared.js';

// ── Parameters ──────────────────────────────────────────────────────

const PolicyListParams = Type.Object({
  resource_type: Type.Optional(
    Type.String({ description: 'Filter by resource type (e.g. "tool"). Omit to list all.' }),
  ),
});

const PolicySetParams = Type.Object({
  resource_type: Type.String({ description: 'Resource type (e.g. "tool").' }),
  resource_key: Type.String({ description: 'Resource key (e.g. tool name like "exec", "file_write").' }),
  grants: Type.Array(
    Type.Object({
      type: Type.Union([Type.Literal('any'), Type.Literal('role'), Type.Literal('user')]),
      value: Type.Optional(Type.String({ description: 'Role name or user ID (required for role/user types).' })),
    }),
    { description: 'Array of grants. Examples: [{"type":"any"}], [{"type":"role","value":"owner"},{"type":"role","value":"user"}]' },
  ),
  sandbox_alias: Type.Optional(Type.String({ description: 'Sandbox alias. Omit for agent-wide.' })),
  mode: Type.Optional(Type.String({ description: 'Mode qualifier. Omit for default.' })),
});

const PolicyDeleteParams = Type.Object({
  resource_type: Type.String({ description: 'Resource type.' }),
  resource_key: Type.String({ description: 'Resource key.' }),
  sandbox_alias: Type.Optional(Type.String({ description: 'Sandbox alias.' })),
  mode: Type.Optional(Type.String({ description: 'Mode qualifier.' })),
});

type PolicyListArgs = Static<typeof PolicyListParams>;
type PolicySetArgs = Static<typeof PolicySetParams>;
type PolicyDeleteArgs = Static<typeof PolicyDeleteParams>;

// ── Tools ───────────────────────────────────────────────────────────

export const createPolicyListTool = (context: ToolContext): PolicyAwareTool<typeof PolicyListParams> => ({
  policy: { kind: 'fixed', grants: [{ type: 'role', value: 'owner' }] },
  name: 'policy_list',
  label: 'List Policies',
  description: 'List access policies for this agent. Shows which roles/users can use each tool.',
  parameters: PolicyListParams,
  execute: async (_id, args: PolicyListArgs) => {
    if (!context.policyStore || !context.storeScope) {
      throw new ValidationError('policy_list is unavailable: no policy store is configured.');
    }
    const policies = await context.policyStore.list(
      context.storeScope.agentId,
      args.resource_type,
    );
    return {
      content: asTextContent(policies.length > 0 ? formatJson(policies) : 'No custom policies configured. All tools use their built-in defaults.\n'),
      details: { count: policies.length },
    };
  },
});

export const createPolicySetTool = (context: ToolContext): PolicyAwareTool<typeof PolicySetParams> => ({
  policy: { kind: 'fixed', grants: [{ type: 'role', value: 'owner' }] },
  name: 'policy_set',
  label: 'Set Policy',
  description:
    'Set an access policy for a resource (e.g. allow guests to use exec). '
    + 'This overrides the built-in default for configurable tools. '
    + 'Fixed tools (like user management) cannot be overridden.',
  parameters: PolicySetParams,
  execute: async (_id, args: PolicySetArgs) => {
    ensureAutonomyAllows(context.security, 'policy_set');
    if (!context.policyStore || !context.storeScope) {
      throw new ValidationError('policy_set is unavailable: no policy store is configured.');
    }
    for (const g of args.grants) {
      if ((g.type === 'role' || g.type === 'user') && !g.value) {
        throw new ValidationError(`Grant type "${g.type}" requires a value.`);
      }
    }
    const record = await context.policyStore.upsert({
      agentId: context.storeScope.agentId,
      resourceType: args.resource_type,
      resourceKey: args.resource_key,
      grants: args.grants,
      sandboxAlias: args.sandbox_alias ?? null,
      mode: args.mode ?? null,
    });
    return {
      content: asTextContent(`Policy set: ${args.resource_type}/${args.resource_key} → ${JSON.stringify(args.grants)}\n`),
      details: record,
    };
  },
});

export const createPolicyDeleteTool = (context: ToolContext): PolicyAwareTool<typeof PolicyDeleteParams> => ({
  policy: { kind: 'fixed', grants: [{ type: 'role', value: 'owner' }] },
  name: 'policy_delete',
  label: 'Delete Policy',
  description: 'Remove a custom policy, reverting a resource to its built-in default.',
  parameters: PolicyDeleteParams,
  execute: async (_id, args: PolicyDeleteArgs) => {
    ensureAutonomyAllows(context.security, 'policy_delete');
    if (!context.policyStore || !context.storeScope) {
      throw new ValidationError('policy_delete is unavailable: no policy store is configured.');
    }
    const opts = {
      ...(args.sandbox_alias ? { sandboxAlias: args.sandbox_alias } : {}),
      ...(args.mode ? { mode: args.mode } : {}),
    };
    const existing = await context.policyStore.get(
      context.storeScope.agentId,
      args.resource_type,
      args.resource_key,
      opts,
    );
    if (!existing) {
      throw new ValidationError(`No policy found for ${args.resource_type}/${args.resource_key}.`);
    }
    await context.policyStore.delete(
      context.storeScope.agentId,
      args.resource_type,
      args.resource_key,
      opts,
    );
    return {
      content: asTextContent(`Policy deleted: ${args.resource_type}/${args.resource_key}. Tool reverts to built-in default.\n`),
      details: { resourceType: args.resource_type, resourceKey: args.resource_key },
    };
  },
});

// ── Toolset ─────────────────────────────────────────────────────────

const POLICY_DESCRIPTION = `\
### Access Policy Management

Owner-only tools for managing who can use which tools.

- \`policy_list\`: show all custom policies
- \`policy_set\`: override the default access for a tool (e.g. open exec to guests)
- \`policy_delete\`: remove a custom policy, reverting to the built-in default

Grant types: \`{"type":"any"}\` (everyone), \`{"type":"role","value":"owner"}\`,
\`{"type":"role","value":"user"}\`, \`{"type":"user","value":"<userId>"}\`.`;

export const createPolicyToolset = (context: ToolContext): Toolset => ({
  id: 'policy',
  description: POLICY_DESCRIPTION,
  tools: [
    createPolicyListTool(context),
    createPolicySetTool(context),
    createPolicyDeleteTool(context),
  ],
});
