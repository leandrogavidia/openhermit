---
name: vexa-meetings
description: Join, transcribe, and remember video meetings with Vexa. Use when asked to send a transcription bot to a Google Meet/Zoom/Teams call, or to summarize a call and store its decisions and action items in memory, or when a "meeting ended" event arrives. Requires the Vexa MCP tools (mcp__vexa__*) and the memory tools.
---

# Vexa Meetings

Capture video meetings into long-term memory. Vexa sends a bot into a
Google Meet / Zoom / Teams call, records and transcribes it; you turn the
result into a durable, searchable record: a summary, the decisions made, and
the action items — plus a link to the recording.

You drive Vexa through its MCP tools (`mcp__vexa__*`) and persist with the
memory tools (`memory_add`, `memory_recall`, `memory_list`, `memory_update`).
If the `mcp__vexa__*` tools are not available, Vexa is not connected — tell the
owner to register the Vexa MCP server (see `docs/vexa-meetings.md`).

## When to use this skill

- **Send a bot**: "send a notetaker to this Meet link", "transcribe my next call".
- **Capture after a call**: "summarize the standup", "what did we decide in the planning call?".
- **Automatic trigger**: a turn that begins "A meeting just ended …" (posted by the
  Vexa channel when a call finishes). Run the post-meeting workflow below.

## Sending a bot to a meeting (pre-meeting)

Parse the meeting link, then request the bot with recording + transcription on:

1. `mcp__vexa__parse_meeting_link` with the URL → `{ platform, native_meeting_id, passcode? }`.
2. `mcp__vexa__request_meeting_bot` with that `platform` + `native_meeting_id`
   (and `passcode` for Teams), plus `recording_enabled: true`,
   `transcribe_enabled: true`.
3. Confirm to the user that the bot is joining. Do **not** poll in a loop — the
   meeting will be captured automatically when it ends.

## Post-meeting workflow (the core)

1. **Identify the meeting.** From the trigger you have the Vexa `meeting id`
   (and often `platform` + native id). Otherwise use `mcp__vexa__list_meetings`
   or `mcp__vexa__list_recordings` to find the most recent completed one.
2. **Avoid duplicates.** Call `memory_list` with `prefix: "meeting/<YYYY-MM-DD>/"`
   for the meeting's date (and `memory_recall` on the title). If this meeting is
   already captured, **update** the existing entries with `memory_update`
   instead of adding new ones.
3. **Fetch the transcript.** `mcp__vexa__get_meeting_transcript` for the
   `platform` + `native_meeting_id`. It returns speaker-labelled segments.
4. **Fetch the recording reference.** `mcp__vexa__list_recordings` (or
   `mcp__vexa__get_recording_media_download`) to get `recording_id` and a
   `recording_url`. **Reference it by id/url only — never download the media
   into memory.** If recording was off or not ready, omit these fields.
5. **Synthesize.** Produce a 3–6 sentence summary, a list of decisions, and a
   list of action items (with owner and due date where stated). Use only what
   the transcript supports — never invent decisions or owners. If the transcript
   is empty, record that the meeting had no captured transcript and stop.
6. **Write to memory** using the key + metadata scheme below.
7. **Sensitive meetings.** If the meeting is private/confidential, set
   `grants: [{ "type": "role", "value": "owner" }]` on every entry. Otherwise
   omit `grants` (open, like other project knowledge).

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
  "meeting_date": "2026-06-15",
  "title": "Weekly Standup",
  "participants": ["Leandro", "Sam"],
  "recording_id": "rec_123",
  "recording_url": "https://.../recordings/rec_123",
  "transcript_memory_key": "meeting/2026-06-15/weekly-standup/transcript",
  "decision_count": 2,
  "action_item_count": 3
}
```

Transcript entry:

```json
{ "type": "transcript", "source_meeting_key": "meeting/2026-06-15/weekly-standup",
  "recording_id": "rec_123", "platform": "google_meet", "native_meeting_id": "abc-defg-hij" }
```

Decision entry:

```json
{ "type": "decision", "source_meeting_key": "meeting/2026-06-15/weekly-standup",
  "meeting_date": "2026-06-15" }
```

Action-item entry:

```json
{ "type": "action_item", "source_meeting_key": "meeting/2026-06-15/weekly-standup",
  "owner": "Sam", "due": "2026-06-20", "status": "open", "meeting_date": "2026-06-15" }
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
