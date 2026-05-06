import { Type, type Static } from '@mariozechner/pi-ai';
import { ValidationError } from '@openhermit/shared';

import {
  type PolicyAwareTool,
  type Toolset,
  type ToolContext,
  asTextContent,
  formatJson,
} from './shared.js';
import { consumeLinkToken, issueLinkToken } from '../identity-link-tokens.js';

const UserListParams = Type.Object({});

const UserIdentityLinkParams = Type.Object({
  user_id: Type.String({ description: 'Target user ID to link the identity to.' }),
  channel: Type.String({ description: 'Channel type (e.g. "telegram", "cli", "web", "discord").' }),
  channel_user_id: Type.String({ description: 'Platform-specific user ID.' }),
});

type UserIdentityLinkArgs = Static<typeof UserIdentityLinkParams>;

const UserIdentityUnlinkParams = Type.Object({
  channel: Type.String({ description: 'Channel type.' }),
  channel_user_id: Type.String({ description: 'Platform-specific user ID to unlink.' }),
});

type UserIdentityUnlinkArgs = Static<typeof UserIdentityUnlinkParams>;

const UserRoleSetParams = Type.Object({
  user_id: Type.String({ description: 'User ID to update.' }),
  role: Type.Union([
    Type.Literal('owner'),
    Type.Literal('user'),
    Type.Literal('guest'),
  ], { description: 'New role for the user.' }),
});

type UserRoleSetArgs = Static<typeof UserRoleSetParams>;

const UserMergeParams = Type.Object({
  from_user_id: Type.String({ description: 'User ID to merge from (will be marked as merged).' }),
  into_user_id: Type.String({ description: 'User ID to merge into (will receive identities).' }),
});

type UserMergeArgs = Static<typeof UserMergeParams>;

export const createUserListTool = (context: ToolContext): PolicyAwareTool<typeof UserListParams> => ({
  policy: { kind: 'fixed', grants: [{ type: 'role', value: 'owner' }] },
  name: 'user_list',
  label: 'List Users',
  description: 'List all users with their identities and roles.',
  parameters: UserListParams,
  execute: async () => {
    if (!context.userStore || !context.storeScope) {
      throw new ValidationError('user_list is unavailable: no user store is configured.');
    }

    const users = await context.userStore.list();
    const agentRoles = await context.userStore.listByAgent(context.storeScope!);
    const roleMap = new Map(agentRoles.map((r) => [r.userId, r.role]));
    const result = await Promise.all(
      users.map(async (user) => {
        const identities = await context.userStore!.listIdentities(user.userId);
        return {
          ...user,
          role: roleMap.get(user.userId) ?? 'guest',
          identities: identities.map((i) => ({
            channel: i.channel,
            channelUserId: i.channelUserId,
          })),
        };
      }),
    );

    return {
      content: asTextContent(result.length > 0 ? formatJson(result) : 'No users found.\n'),
      details: { count: result.length, users: result },
    };
  },
});

export const createUserIdentityLinkTool = (context: ToolContext): PolicyAwareTool<typeof UserIdentityLinkParams> => ({
  policy: { kind: 'fixed', grants: [{ type: 'role', value: 'owner' }] },
  name: 'user_identity_link',
  label: 'Link User Identity',
  description: 'Link a channel identity to a user. If the identity already belongs to another user, it will be re-linked to the target user.',
  parameters: UserIdentityLinkParams,
  execute: async (_toolCallId, args: UserIdentityLinkArgs) => {
    if (!context.userStore || !context.storeScope) {
      throw new ValidationError('user_identity_link is unavailable: no user store is configured.');
    }

    const userId = args.user_id.trim();
    const channel = args.channel.trim();
    const channelUserId = args.channel_user_id.trim();

    if (!userId || !channel || !channelUserId) {
      throw new ValidationError('user_identity_link requires non-empty user_id, channel, and channel_user_id.');
    }

    // Verify target user exists
    const user = await context.userStore.get(userId);
    if (!user) {
      throw new ValidationError(`User not found: ${userId}`);
    }

    await context.userStore.linkIdentity({
      userId,
      channel,
      channelUserId,
      createdAt: new Date().toISOString(),
    });

    return {
      content: asTextContent(`Linked ${channel}:${channelUserId} to user ${userId}.\n`),
      details: { userId, channel, channelUserId },
    };
  },
});

export const createUserIdentityUnlinkTool = (context: ToolContext): PolicyAwareTool<typeof UserIdentityUnlinkParams> => ({
  policy: { kind: 'fixed', grants: [{ type: 'role', value: 'owner' }] },
  name: 'user_identity_unlink',
  label: 'Unlink User Identity',
  description: 'Remove a channel identity link from its user.',
  parameters: UserIdentityUnlinkParams,
  execute: async (_toolCallId, args: UserIdentityUnlinkArgs) => {
    if (!context.userStore || !context.storeScope) {
      throw new ValidationError('user_identity_unlink is unavailable: no user store is configured.');
    }

    const channel = args.channel.trim();
    const channelUserId = args.channel_user_id.trim();

    if (!channel || !channelUserId) {
      throw new ValidationError('user_identity_unlink requires non-empty channel and channel_user_id.');
    }

    await context.userStore.unlinkIdentity(channel, channelUserId);

    return {
      content: asTextContent(`Unlinked ${channel}:${channelUserId}.\n`),
      details: { channel, channelUserId },
    };
  },
});

export const createUserRoleSetTool = (context: ToolContext): PolicyAwareTool<typeof UserRoleSetParams> => ({
  policy: { kind: 'fixed', grants: [{ type: 'role', value: 'owner' }] },
  name: 'user_role_set',
  label: 'Set User Role',
  description: 'Change a user\'s role (owner, user, or guest).',
  parameters: UserRoleSetParams,
  execute: async (_toolCallId, args: UserRoleSetArgs) => {
    if (!context.userStore || !context.storeScope) {
      throw new ValidationError('user_role_set is unavailable: no user store is configured.');
    }

    const userId = args.user_id.trim();
    if (!userId) {
      throw new ValidationError('user_role_set requires a non-empty user_id.');
    }

    const user = await context.userStore.get(userId);
    if (!user) {
      throw new ValidationError(`User not found: ${userId}`);
    }

    await context.userStore.assignAgent(context.storeScope!, userId, args.role, new Date().toISOString());

    return {
      content: asTextContent(`Set role of user ${userId} to ${args.role}.\n`),
      details: { userId, role: args.role },
    };
  },
});

export const createUserMergeTool = (context: ToolContext): PolicyAwareTool<typeof UserMergeParams> => ({
  policy: { kind: 'fixed', grants: [{ type: 'role', value: 'owner' }] },
  name: 'user_merge',
  label: 'Merge Users',
  description: 'Merge one user into another. All identities from the source user are moved to the target. The source user is marked as merged and excluded from listings.',
  parameters: UserMergeParams,
  execute: async (_toolCallId, args: UserMergeArgs) => {
    if (!context.userStore || !context.storeScope) {
      throw new ValidationError('user_merge is unavailable: no user store is configured.');
    }

    const fromId = args.from_user_id.trim();
    const intoId = args.into_user_id.trim();

    if (!fromId || !intoId) {
      throw new ValidationError('user_merge requires non-empty from_user_id and into_user_id.');
    }
    if (fromId === intoId) {
      throw new ValidationError('Cannot merge a user into themselves.');
    }

    // Verify both users exist
    const fromUser = await context.userStore.get(fromId);
    if (!fromUser) {
      throw new ValidationError(`Source user not found: ${fromId}`);
    }
    const intoUser = await context.userStore.get(intoId);
    if (!intoUser) {
      throw new ValidationError(`Target user not found: ${intoId}`);
    }

    // Inherit name from source if target has none
    if (fromUser.name && !intoUser.name) {
      await context.userStore.upsert({
        ...intoUser,
        name: fromUser.name,
        updatedAt: new Date().toISOString(),
      });
    }

    await context.userStore.merge(fromId, intoId);

    const parts = [`Merged user ${fromId} into ${intoId}. All identities have been transferred.`];
    if (fromUser.name && !intoUser.name) {
      parts.push(`Name "${fromUser.name}" inherited from source user.`);
    }

    return {
      content: asTextContent(parts.join('\n') + '\n'),
      details: { fromUserId: fromId, intoUserId: intoId },
    };
  },
});

// ── Self-service identity link (any role) ─────────────────────────

const IdentityLinkRequestParams = Type.Object({});

const IdentityLinkConfirmParams = Type.Object({
  token: Type.String({ description: 'The token issued by identity_link_request on the other channel.' }),
});

type IdentityLinkConfirmArgs = Static<typeof IdentityLinkConfirmParams>;

export const createIdentityLinkRequestTool = (
  context: ToolContext,
): PolicyAwareTool<typeof IdentityLinkRequestParams> => ({
  policy: { kind: 'fixed', grants: [{ type: 'any' }] },
  name: 'identity_link_request',
  label: 'Request Identity Link',
  description:
    'Generate a short-lived link token so the user can connect their identity across channels (e.g. link Telegram + web as one user). Call this when the user wants to link accounts, merge identities, or be recognised across platforms. Token is single-use and expires in ~10 minutes. The user must then run identity_link_confirm with this token from a different channel.',
  parameters: IdentityLinkRequestParams,
  execute: async () => {
    if (!context.currentUserId) {
      throw new ValidationError('identity_link_request requires a resolved user identity.');
    }
    if (!context.currentChannel || !context.currentChannelUserId) {
      throw new ValidationError('identity_link_request requires a known caller channel.');
    }

    const { token, expiresAt } = issueLinkToken({
      userId: context.currentUserId,
      channel: context.currentChannel,
      channelUserId: context.currentChannelUserId,
    });

    return {
      content: asTextContent(
        `Token: ${token}\nExpires: ${expiresAt}\n\nOn the other channel, ask the agent to run \`identity_link_confirm\` with this token. The token must be used from a different channel than this one (${context.currentChannel}).\n`,
      ),
      details: { token, expiresAt, channel: context.currentChannel },
    };
  },
});

export const createIdentityLinkConfirmTool = (
  context: ToolContext,
): PolicyAwareTool<typeof IdentityLinkConfirmParams> => ({
  policy: { kind: 'fixed', grants: [{ type: 'any' }] },
  name: 'identity_link_confirm',
  label: 'Confirm Identity Link',
  description:
    'Redeem a token issued by identity_link_request on another channel. Links the current channel identity to the same user. Must be invoked from a different channel than the one that issued the token.',
  parameters: IdentityLinkConfirmParams,
  execute: async (_toolCallId, args: IdentityLinkConfirmArgs) => {
    if (!context.userStore) {
      throw new ValidationError('identity_link_confirm is unavailable: no user store is configured.');
    }
    if (!context.currentChannel || !context.currentChannelUserId) {
      throw new ValidationError('identity_link_confirm requires a known caller channel.');
    }

    const token = args.token.trim();
    if (!token) {
      throw new ValidationError('identity_link_confirm requires a non-empty token.');
    }

    const link = consumeLinkToken(token);
    if (!link) {
      throw new ValidationError('Token is invalid, already used, or expired. Issue a new one with identity_link_request.');
    }

    if (link.channel === context.currentChannel) {
      throw new ValidationError(
        `Token must be redeemed from a different channel than the one that issued it (issued from ${link.channel}, redeemed from ${context.currentChannel}). The cross-channel constraint is what proves the two identities belong to the same person.`,
      );
    }

    // Verify requesting user still exists.
    const targetUser = await context.userStore.get(link.userId);
    if (!targetUser) {
      throw new ValidationError(`Requesting user ${link.userId} no longer exists.`);
    }

    // On public agents, resolveSessionUser auto-creates a guest for unknown
    // channel identities.  So the confirming caller almost always arrives as
    // a *different* user (the auto-created guest).  If the guest is ephemeral
    // (single identity = this channel), we absorb it: re-link the identity
    // and delete the empty shell.  If the caller already has multiple
    // identities they're an established user — refuse and suggest user_merge.
    let deletedGhostUserId: string | undefined;
    if (context.currentUserId && context.currentUserId !== link.userId) {
      const callerIdentities = await context.userStore.listIdentities(context.currentUserId);
      const isEphemeral =
        callerIdentities.length === 1 &&
        callerIdentities[0]!.channel === context.currentChannel &&
        callerIdentities[0]!.channelUserId === context.currentChannelUserId;

      if (!isEphemeral) {
        throw new ValidationError(
          `This channel identity already belongs to user ${context.currentUserId}, which is different from the requesting user ${link.userId}. Ask the owner to merge the two users with user_merge if that is intentional.`,
        );
      }

      deletedGhostUserId = context.currentUserId;
    }

    await context.userStore.linkIdentity({
      userId: link.userId,
      channel: context.currentChannel,
      channelUserId: context.currentChannelUserId,
      createdAt: new Date().toISOString(),
    });

    if (deletedGhostUserId) {
      await context.userStore.delete(deletedGhostUserId);
    }

    return {
      content: asTextContent(
        `Linked ${context.currentChannel}:${context.currentChannelUserId} to user ${link.userId}. You are now recognised as the same user across both channels.\n`,
      ),
      details: {
        userId: link.userId,
        linkedChannel: context.currentChannel,
        linkedChannelUserId: context.currentChannelUserId,
        sourceChannel: link.channel,
        ...(deletedGhostUserId ? { deletedGhostUserId } : {}),
      },
    };
  },
});

// ── Toolsets ────────────────────────────────────────────────────────

const USER_DESCRIPTION = `\
### User Management

You can manage users and their cross-channel identities. Only the owner can use these tools.

When the owner mentions managing users, use these tools. For example:
- "give Bob user access" → \`user_role_set\`
- "who are my users?" → \`user_list\`
- "merge these duplicate users" → \`user_merge\` (rare; prefer self-service link below)`;

export const createUserToolset = (context: ToolContext): Toolset => ({
  id: 'user',
  description: USER_DESCRIPTION,
  tools: [
    createUserListTool(context),
    createUserIdentityLinkTool(context),
    createUserIdentityUnlinkTool(context),
    createUserRoleSetTool(context),
    createUserMergeTool(context),
  ],
});

const IDENTITY_DESCRIPTION = `\
### Cross-channel Identity Link

When a user asks to "link accounts", "connect identities", "merge my accounts",
"link my Telegram/CLI/web", "generate a link token", or anything about being
recognised as the same person across channels — use these tools.

Flow:
1. On channel A: call \`identity_link_request\` → returns a short token.
2. On channel B: call \`identity_link_confirm\` with that token.

The two channels must be different — that cross-channel proof is what links
the identities. Tokens are single-use and expire in ~10 minutes.`;

export const createIdentityToolset = (context: ToolContext): Toolset => ({
  id: 'identity',
  description: IDENTITY_DESCRIPTION,
  tools: [
    createIdentityLinkRequestTool(context),
    createIdentityLinkConfirmTool(context),
  ],
});
