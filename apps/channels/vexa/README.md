# @openhermit/channel-vexa

OpenHermit channel plugin for [Vexa](https://github.com/Vexa-ai/vexa) meeting
transcription. It is the **push** half of the Vexa integration — the **pull**
half is Vexa's MCP server, registered separately so the agent gets the
`mcp__vexa__*` tools (request a bot, fetch transcripts, list recordings, …).

## What it does

This adapter has no outbound messaging and no background loop. It only exposes
a webhook handler. When a meeting the Vexa bot attended ends, Vexa POSTs to:

```
POST /api/agents/<agentId>/channels/vexa/webhook
```

The handler:

1. verifies the request against `VEXA_WEBHOOK_SECRET` (shared-secret bearer or
   body HMAC-SHA256, constant-time),
2. acks `200` immediately (Vexa retries non-2xx with backoff),
3. on `meeting.status_change → completed` or `recording.completed`, opens an
   owner-scoped, non-interactive session `vexa:<meetingId>` and posts a
   finalization prompt that drives the `vexa-meetings` skill to capture the
   transcript, decisions, and action items into long-term memory.

Owner attribution is resolved server-side: the synthesized session carries an
`act_as_owner` flag that the agent runtime's `resolveSessionUser` turns into
the agent's owner, so memory writes are owner-scoped without the bridge needing
store access.

## Setup

1. Add `@openhermit/channel-vexa` to the gateway config's `channelPackages`.
2. In the admin UI, add the **Vexa Meetings** channel to the target agent and
   set the **Vexa webhook secret** (stored as the `VEXA_WEBHOOK_SECRET` agent
   secret).
3. Copy the displayed webhook URL and register it in Vexa
   (`PUT /user/webhook` with the same `webhook_secret`).
4. Register the Vexa MCP server and set the `VEXA_API_KEY` agent secret so the
   agent has the `mcp__vexa__*` tools. See `docs/vexa-meetings.md`.
