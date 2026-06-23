# Vexa meeting transcription & memory

Equip an OpenHermit agent to **join, transcribe, and remember** Google Meet /
Zoom / Teams calls with self-hosted [Vexa](https://github.com/Vexa-ai/vexa).
The integration has two halves:

- **Pull (tools):** Vexa's MCP server is registered with OpenHermit, so the
  agent gets the `mcp__vexa__*` tools (request a bot, fetch transcripts, list
  recordings, …). See [`mcp-servers.md`](mcp-servers.md).
- **Push (auto-capture):** the `@openhermit/channel-vexa` adapter receives
  Vexa's `meeting.completed` webhook and triggers an **owner-scoped,
  non-interactive** agent turn that runs the
  [`vexa-meetings`](../skills/vexa-meetings/SKILL.md) skill to capture the
  transcript + decisions + action items into long-term [memory](memory-model.md).

Scope: **post-meeting capture** (no live speak/chat/screen). Recordings are
referenced by URL/id, never downloaded.

## Architecture

```
Meet/Zoom call → Vexa bot records + transcribes
   │ mcp__vexa__* tools (pull)              │ meeting.completed webhook (push)
   ▼                                        ▼
OpenHermit agent ◄── finalization turn ── apps/channels/vexa ◄── POST /api/agents/:id/channels/vexa/webhook
   └── memory_add → meeting/<date>/<slug>{,/transcript,/decision/n,/action/n}
```

## 1. Run Vexa (self-hosted, local)

Vexa is its own stack. Bring it up from the Vexa repo. For a fully-local,
GPU-free test the transcription service runs on CPU (use a small Whisper model
for near-real-time). See the project's own deploy docs and OpenHermit's
self-hosting notes; the short version:

```bash
# Transcription service (CPU faster-whisper, OpenAI-compatible, :8083)
cd ~/amiko/vexa/services/transcription-service
MODEL_SIZE=small docker compose -f docker-compose.cpu.yml up -d

# Point Vexa at the local transcriber + bypass the cloud-token prompt in .env:
#   TRANSCRIPTION_SERVICE_URL=http://transcription-service/v1/audio/transcriptions
#   TRANSCRIPTION_SERVICE_TOKEN=local          # any non-empty value except "your-token"
# then bring up the full stack:
cd ~/amiko/vexa/deploy/compose && make all
# join the transcription LB to the stack network so bots can reach it:
docker network connect --alias transcription-service vexa_vexa transcription-lb-cpu
```

Default Vexa ports: **REST/API gateway `8056`**, **Admin API `8057`**, **MCP `18888`**.
Mint an API key via the Admin API:

```bash
curl -X POST http://localhost:8057/admin/users \
  -H "X-Admin-API-Key: $VEXA_ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"email":"agent@example.com","name":"Agent","max_concurrent_bots":2}'
curl -X POST "http://localhost:8057/admin/users/<id>/tokens?scopes=bot,tx" \
  -H "X-Admin-API-Key: $VEXA_ADMIN_TOKEN"   # → the VEXA_API_KEY
```

Set the OpenHermit-side env (see [`.env.example`](../.env.example)):
`VEXA_BASE_URL=http://localhost:8056`, `VEXA_MCP_URL=http://localhost:18888/mcp`,
`VEXA_API_KEY`, `VEXA_WEBHOOK_SECRET`.

## 2. Register the Vexa MCP server (pull side)

OpenHermit's MCP client speaks **Streamable HTTP**. Probe Vexa's MCP endpoint,
then register it and enable for your agent(s):

```bash
hermit mcp register vexa \
  --url "$VEXA_MCP_URL" \
  --name "Vexa" \
  --description "Meeting bots + transcripts + recordings" \
  --header "X-API-Key:\${{VEXA_API_KEY}}"
hermit mcp enable vexa --all          # or: --agent <agentId>
```

`${{VEXA_API_KEY}}` is expanded **per agent** from the agent secret store —
enabling for `*` does not make the key global. Set it on each agent that uses
Vexa:

```bash
hermit config secrets set VEXA_API_KEY <token> --agent <agentId>
```

Confirm the agent's MCP status shows `vexa` = connected with `mcp__vexa__*`
tools attached (`GET /api/agents/<id>/mcp-servers`).

## 3. Enable auto-capture (the Vexa channel)

1. Make the adapter loadable (workspace package). After `npm install`, add it to
   the gateway config and restart:

   ```bash
   hermit channel install @openhermit/channel-vexa   # or edit channelPackages
   hermit gateway restart
   ```

2. In **Admin → the agent → Channels**, add **Vexa Meetings**, set the **Vexa
   webhook secret** (stored as the `VEXA_WEBHOOK_SECRET` agent secret), and copy
   the displayed **Webhook URL**:
   `https://<gateway-public-url>/api/agents/<agentId>/channels/vexa/webhook`.

3. Register that URL + the same secret in Vexa (per-user webhook):

   ```bash
   curl -X PUT "$VEXA_BASE_URL/user/webhook" \
     -H "X-API-Key: $VEXA_API_KEY" -H 'Content-Type: application/json' \
     -d '{"webhook_url":"https://<gateway-public-url>/api/agents/<agentId>/channels/vexa/webhook","webhook_secret":"'"$VEXA_WEBHOOK_SECRET"'"}'
   ```

When a call ends, Vexa POSTs `meeting.completed` (its only default-enabled
event) → the adapter verifies the signature, opens an owner-scoped
`vexa:<meetingId>` session, and posts a finalization prompt. The agent runs the
`vexa-meetings` skill and writes the meeting to memory. A meeting finalizes once
(in-process dedup + the skill's memory check).

### Webhook authentication

Vexa signs each delivery (meeting-api `webhook_delivery.build_headers`):

- `Authorization: Bearer <webhook_secret>`
- `X-Webhook-Signature: sha256=<hmac>` — HMAC-SHA256 over `"<timestamp>." + rawBody`
- `X-Webhook-Timestamp: <unix seconds>`

The adapter verifies the HMAC signature (preferred) or the Bearer token
(fallback). A mismatch returns `401`.

> Optional safety net: a periodic `hermit schedules` job that asks the agent to
> "capture any completed Vexa meetings not yet in memory" catches any missed
> webhook — no extra code.

## 4. What lands in memory

| Key | Holds |
|-----|-------|
| `meeting/<date>/<slug>` | summary (metadata: platform, participants, recording_url, counts) |
| `meeting/<date>/<slug>/transcript` | full transcript text |
| `meeting/<date>/<slug>/decision/<n>` | one decision each |
| `meeting/<date>/<slug>/action/<n>` | one action item (owner, due, status) |

Children carry `source_meeting_key` backlinks. Full schema:
[`skills/vexa-meetings/SKILL.md`](../skills/vexa-meetings/SKILL.md).

## Verify end-to-end

1. Ask the agent to send a bot to a real Meet link; confirm it joins.
2. Speak; end the call.
3. Confirm the finalization turn fired (gateway logs) and that
   `memory_list prefix:"meeting/<today>/"` shows the summary + `/transcript` +
   `decision/*` + `action/*`, with a working `recording_url`.

## Troubleshooting

- **No `mcp__vexa__*` tools:** the MCP server is `error`/`disconnected` — recheck
  the URL/transport and that `VEXA_API_KEY` is set *on the agent*.
- **Webhook 401:** the channel secret and Vexa's `webhook_secret` differ, or the
  HMAC/timestamp headers were altered by a proxy.
- **Channel won't start ("disabled until secret configured"):** set the
  `VEXA_WEBHOOK_SECRET` agent secret, then restart the gateway.
- **Owner-scoped writes missing:** the agent has no `owner` member; the
  finalization turn logs `act_as_owner requested … but no owner member found`.
