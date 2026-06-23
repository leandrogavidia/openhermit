# @openhermit/channel-vexa

Webhook-driven OpenHermit channel plugin for [Vexa](https://github.com/Vexa-ai/vexa) meeting transcription.

When a Vexa-captured meeting (Google Meet / Zoom / Teams) finishes, Vexa POSTs a `meeting.completed` webhook to the gateway. This adapter verifies it and triggers an **owner-scoped, non-interactive** agent turn that runs the `vexa-meetings` skill to store the transcript, decisions, and action items in long-term memory.

Webhook-only: no outbound surface, no background loop. The agent pulls transcripts and recordings through Vexa's own MCP server (`mcp__vexa__*`), registered separately.

## Enable

```bash
hermit channel install @openhermit/channel-vexa   # or add to gateway channelPackages
hermit gateway restart
```

Then add the **Vexa Meetings** channel to an agent (admin UI), set `VEXA_WEBHOOK_SECRET`, and register the same secret + the displayed webhook URL in Vexa via `PUT /user/webhook`. Full runbook: [`docs/vexa-meetings.md`](../../../docs/vexa-meetings.md).

## Webhook authentication

Verifies Vexa's `X-Webhook-Signature` — `sha256=` HMAC-SHA256 over `"<X-Webhook-Timestamp>." + rawBody` — and falls back to `Authorization: Bearer <secret>`. Matches Vexa meeting-api `webhook_delivery.build_headers`.

## Events

Acts on `meeting.completed` (Vexa's only default-enabled event). Also accepts `meeting.status_change` resolving to `completed` for operators who opt extra events in; both are deduped per meeting id.
