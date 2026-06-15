# Vexa meeting transcription & memory

Equip an OpenHermit agent to **join, transcribe, and remember** Google Meet /
Zoom / Teams calls with self-hosted [Vexa](https://github.com/Vexa-ai/vexa).
The integration has two halves:

- **Pull (tools):** Vexa's MCP server is registered with OpenHermit, so the
  agent gets the `mcp__vexa__*` tools (request a bot, fetch transcripts, list
  recordings, …). See [`mcp-servers.md`](mcp-servers.md).
- **Push (auto-capture):** the `@openhermit/channel-vexa` adapter receives
  Vexa's `meeting.status_change`/`recording.completed` webhooks and triggers an
  owner-scoped agent turn that runs the [`vexa-meetings`](../skills/vexa-meetings/SKILL.md)
  skill to capture the transcript + decisions + action items into long-term
  [memory](memory-model.md).

Scope: **post-meeting capture** (no live speak/chat/screen). Recordings are
referenced by URL/id, not downloaded.

## Architecture

```
Meet/Zoom call → Vexa bot records + transcribes
   │ mcp__vexa__* tools (pull)            │ webhook on completion (push)
   ▼                                      ▼
OpenHermit agent  ◄── finalization turn ── apps/channels/vexa  ◄── POST /api/agents/:id/channels/vexa/webhook
   └── memory_add → meeting/<date>/<slug>{,/transcript,/decision/n,/action/n}
```

## 1. Run Vexa (Docker Compose)

Vexa is its own stack. Bring it up from the Vexa repo and join it to a network
shared with OpenHermit:

```bash
docker network create openhermit-net

git clone https://github.com/Vexa-ai/vexa && cd vexa
# Configure Vexa: transcription/HuggingFace token, recording storage (MinIO/S3),
# and attach its services to the external `openhermit-net` network.
make all     # or: docker compose -f deploy/compose/docker-compose.yml up -d
```

From the OpenHermit repo, the companion overlay declares the shared network and
an optional MCP transport bridge:

```bash
docker compose -f docker-compose.yml -f docker-compose.vexa.yml up -d
```

Mint an API key via Vexa's Admin API:

```bash
curl -X POST http://localhost:8057/admin/users \
  -H "X-Admin-API-Key: $VEXA_ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"email":"agent@example.com"}'
curl -X POST "http://localhost:8057/admin/users/<id>/tokens?scopes=bot,tx" \
  -H "X-Admin-API-Key: $VEXA_ADMIN_TOKEN"   # → the VEXA_API_KEY
```

Set the OpenHermit-side env (see [`.env.example`](../.env.example)):
`VEXA_BASE_URL`, `VEXA_MCP_URL`, `VEXA_API_KEY`, `VEXA_WEBHOOK_SECRET`.

## 2. Verify the MCP transport

OpenHermit's MCP client only speaks **Streamable HTTP** (`apps/agent/src/mcp-client.ts`).
Probe Vexa's MCP endpoint before registering:

```bash
curl -sS -X POST "$VEXA_MCP_URL" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "X-API-Key: $VEXA_API_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}'
```

- An `initialize` result (JSON or SSE-framed) ⇒ Streamable HTTP works; register
  directly (step 3).
- A 405 / "session required" / GET-only event stream ⇒ legacy SSE only. Run the
  bridge sidecar and register **its** URL instead:
  `docker compose -f docker-compose.yml -f docker-compose.vexa.yml --profile bridge up -d`
  then use `http://localhost:18057/mcp`. (Verify the bridge's flags against the
  proxy tool's docs.)

## 3. Register the Vexa MCP server

```bash
hermit mcp register vexa \
  --url "$VEXA_MCP_URL" \
  --name "Vexa" \
  --description "Meeting bots + transcripts + recordings" \
  --header "X-API-Key:\${{VEXA_API_KEY}}"
hermit mcp enable vexa --all          # or: --agent <agentId>
```

**Per-agent secret (load-bearing).** `${{VEXA_API_KEY}}` is expanded against
each agent's own secret store — enabling for `*` does **not** make the key
global. Set it on every agent that should use Vexa:

```bash
hermit config secrets set VEXA_API_KEY <token> --agent <agentId>
```

Confirm the tools attached: the agent's MCP status should show `vexa` =
`connected` with ~32 `mcp__vexa__*` tools
(`GET /api/agents/<id>/mcp-servers`). The agent can now request bots and fetch
transcripts on demand.

## 4. Enable auto-capture (the Vexa channel)

1. Make the adapter loadable. It's a workspace package, so after `npm install`
   add it to the gateway config and restart:

   ```bash
   hermit gateway config set channelPackages '["@openhermit/channel-vexa"]'
   hermit gateway restart
   ```

2. In **Admin → the agent → Channels**, add **Vexa Meetings**, set the **Vexa
   webhook secret** (stored as the `VEXA_WEBHOOK_SECRET` agent secret), and copy
   the displayed **Webhook URL**:
   `https://<gateway-public-url>/api/agents/<agentId>/channels/vexa/webhook`.
   (`<gateway-public-url>` comes from `OPENHERMIT_GATEWAY_PUBLIC_URL`.)

3. Register that URL in Vexa with the same secret:

   ```bash
   curl -X PUT "$VEXA_BASE_URL/user/webhook" \
     -H "X-API-Key: $VEXA_API_KEY" -H 'Content-Type: application/json' \
     -d '{"webhook_url":"https://<gateway-public-url>/api/agents/<agentId>/channels/vexa/webhook","webhook_secret":"'"$VEXA_WEBHOOK_SECRET"'"}'
   ```

When a call ends, Vexa POSTs the webhook → the adapter verifies the secret,
opens an owner-scoped `vexa:<meetingId>` session, and posts a finalization
prompt. The agent runs the `vexa-meetings` skill and writes the meeting to
memory. One Vexa account routes to one agent (its webhook URL); a meeting is
finalized once (in-process dedup + the skill's memory check).

> Optional safety net: a periodic `hermit schedules` job that asks the agent to
> "capture any completed Vexa meetings not yet in memory" catches any missed
> webhook — no extra code.

## 5. What lands in memory

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
   `decision/*` + `action/*` with a working `recording_url`.

## Troubleshooting

- **No `mcp__vexa__*` tools:** the MCP server is `error`/`disconnected` — recheck
  the transport (step 2), the URL, and that `VEXA_API_KEY` is set *on the agent*.
- **Webhook 401:** the channel secret and Vexa's `webhook_secret` differ.
- **Channel won't start ("disabled until secret configured"):** set the
  `VEXA_WEBHOOK_SECRET` agent secret, then restart the gateway.
- **Owner-scoped writes missing:** the agent has no `owner` member; the
  finalization turn logs `act_as_owner requested … but no owner member found`.
