---
name: vexa-meetings
description: Join, transcribe, and remember video meetings with Vexa. Use when asked to send a transcription bot to a Google Meet / Zoom / Teams call, to summarize a call and store its decisions and action items in memory, or when a turn begins "A meeting just ended …". Requires the Vexa MCP tools (mcp__vexa__*) and the memory tools.
---

# Vexa Meetings

Capture video meetings into long-term memory. Vexa sends a bot into a Google
Meet / Zoom / Teams call, records and transcribes it; you turn the result into
a durable, searchable record — a summary, the decisions made, and the action
items — plus a reference to the recording.

You drive Vexa through its MCP tools (`mcp__vexa__*`) and persist with the
memory tools (`memory_add`, `memory_recall`, `memory_list`, `memory_get`,
`memory_update`). If the `mcp__vexa__*` tools are not available, Vexa is not
connected — tell the owner to register the Vexa MCP server (see
`docs/vexa-meetings.md`). Tool names below are the common Vexa set; if yours
differ, list your `mcp__vexa__*` tools and map by purpose.

## When to use this skill

- **Send a bot**: "send a notetaker to this Meet link", "transcribe my next call".
- **Capture after a call**: "summarize the standup", "what did we decide in planning?".
- **Automatic trigger**: a turn that begins "A meeting just ended …" (posted by the
  Vexa channel when a call finishes). Run the post-meeting workflow below.

## Sending a bot to a meeting (pre-meeting)

1. Parse the link with `mcp__vexa__parse_meeting_link` (URL → `{ platform,
   native_meeting_id, passcode? }`).
2. Request the bot with `mcp__vexa__request_meeting_bot`, passing that
   `platform` + `native_meeting_id`, `recording_enabled: true`,
   `transcribe_enabled: true`, and the **`passcode` when present — most Zoom
   calls and many Teams calls require one** (Google Meet usually does not).
3. Confirm to the user that the bot is joining. Do **not** poll in a loop — the
   meeting is captured automatically when it ends (the Vexa channel triggers it).

## Post-meeting workflow (the core)

1. **Identify the meeting.** The trigger gives the Vexa `meeting id` (often with
   `platform` + native id). Otherwise use `mcp__vexa__list_meetings` to find the
   most recent completed one.
2. **Avoid duplicates.** `memory_list` with `prefix: "meeting/<YYYY-MM-DD>/"` for
   the meeting's date, and `memory_recall` on the likely title. If it is already
   captured, **update** existing entries with `memory_update` instead of adding.
3. **Fetch the transcript** with `mcp__vexa__get_meeting_transcript` (by
   `platform` + `native_meeting_id`). It returns speaker-labelled segments.
4. **Fetch the recording reference** with `mcp__vexa__list_recordings` (or
   `mcp__vexa__get_recording_media_download`) to get `recording_id` + a
   `recording_url`. **Reference it by id/url only — never download the media
   into memory.** If recording was off or not ready, omit these fields.
5. **Synthesize.** A 3–6 sentence summary, a list of decisions, and a list of
   action items (owner + due date where stated). Use only what the transcript
   supports — never invent decisions, owners, or dates. If the transcript is
   empty, record that the meeting had no captured transcript and stop.
6. **Write to memory** using the keys + metadata below.
7. **Sensitive meetings.** If private/confidential, pass
   `grants: [{ "type": "role", "value": "owner" }]` to `memory_add` on every
   entry. Otherwise omit `grants` (open, like other project knowledge). Note:
   `memory_update` does **not** change grants — to restrict an entry that was
   already written open, call `memory_set_grants` with the same key.

## Memory layout

Slug = a short kebab-case title (e.g. `weekly-standup`), or the native meeting
id if there is no clear title. Date = the meeting's start date (`YYYY-MM-DD`).

| Key | Holds |
|-----|-------|
| `meeting/<date>/<slug>` | the summary (one per meeting) |
| `meeting/<date>/<slug>/transcript` | the full transcript text |
| `meeting/<date>/<slug>/decision/<n>` | one decision each (n = 1, 2, …) |
| `meeting/<date>/<slug>/action/<n>` | one action item each |

Keep the summary entry short — the full transcript lives in the `/transcript`
child so recalling the summary stays cheap.

### Metadata templates

Summary entry (`memory_add` `metadata`):

```json
{
  "type": "meeting",
  "platform": "google_meet",
  "native_meeting_id": "abc-defg-hij",
  "meeting_date": "2026-06-23",
  "title": "Weekly Standup",
  "participants": ["Leandro", "Sam"],
  "recording_id": "rec_123",
  "recording_url": "https://.../recordings/rec_123",
  "transcript_memory_key": "meeting/2026-06-23/weekly-standup/transcript",
  "decision_count": 2,
  "action_item_count": 3
}
```

Transcript entry:

```json
{ "type": "transcript", "source_meeting_key": "meeting/2026-06-23/weekly-standup",
  "recording_id": "rec_123", "platform": "google_meet", "native_meeting_id": "abc-defg-hij" }
```

Decision entry:

```json
{ "type": "decision", "source_meeting_key": "meeting/2026-06-23/weekly-standup",
  "meeting_date": "2026-06-23" }
```

Action-item entry:

```json
{ "type": "action_item", "source_meeting_key": "meeting/2026-06-23/weekly-standup",
  "owner": "Sam", "due": "2026-06-27", "status": "open", "meeting_date": "2026-06-23" }
```

Every child carries `source_meeting_key` so you can walk from any decision or
action item back to its meeting summary and transcript.

## Recalling later

- "What did we decide about X?" → `memory_recall` with the topic; decisions and
  summaries surface by keyword.
- "Open action items for Sam" → `memory_list` with `prefix: "meeting/"`, then
  filter by `metadata.type == "action_item"` and `metadata.owner`.
- "Show the <date> standup" → `memory_get` the `meeting/<date>/<slug>` summary,
  then its `/transcript` child if the full text is needed.

## Guardrails

- Post-meeting capture only — do not speak, chat, or screen-share in the call.
- One summary entry per meeting; re-running must `memory_update`, not duplicate.
- Never paste the whole transcript into the summary entry.
- Reference recordings by URL/id; do not store media bytes in memory.
- Never fabricate decisions, action items, owners, or due dates.
