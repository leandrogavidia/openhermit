import type { NormalizedMeetingEvent, VexaWebhookEvent } from './types.js';

/**
 * Reduce a raw Vexa webhook to the completion event we act on, or `null` if it
 * is not a completion we care about.
 *
 * We finalize on EITHER a meeting status change to `completed` OR a
 * `recording.completed` event, deduped per meeting downstream — whichever
 * arrives first wins. This way capture works whether or not recording was
 * enabled, and a late `recording.completed` does not double-trigger.
 */
export function normalizeEvent(
  event: VexaWebhookEvent | null | undefined,
): NormalizedMeetingEvent | null {
  if (!event) return null;
  const type = event.event_type ?? event.type;

  if (type === 'meeting.status_change') {
    if (event.status_change?.to !== 'completed') return null;
    const meeting = event.meeting ?? {};
    if (meeting.id == null) return null;
    const out: NormalizedMeetingEvent = {
      meetingId: String(meeting.id),
      kind: 'meeting_completed',
    };
    if (meeting.platform) out.platform = meeting.platform;
    if (meeting.native_meeting_id) out.nativeMeetingId = meeting.native_meeting_id;
    return out;
  }

  if (type === 'recording.completed') {
    const recording = event.recording ?? {};
    if (recording.meeting_id == null) return null;
    const out: NormalizedMeetingEvent = {
      meetingId: String(recording.meeting_id),
      kind: 'recording_completed',
    };
    if (recording.id != null) out.recordingId = String(recording.id);
    return out;
  }

  return null;
}

/** The instruction posted to the agent to drive post-meeting capture. */
export function buildFinalizationPrompt(ref: NormalizedMeetingEvent): string {
  const where = ref.platform ? ` on ${ref.platform}` : '';
  const native = ref.nativeMeetingId ? ` (meeting ${ref.nativeMeetingId})` : '';
  return [
    `A meeting just ended${where}${native}. Vexa meeting id: ${ref.meetingId}.`,
    '',
    'Capture it using the "vexa-meetings" skill:',
    '1. Read the skill (skills/vexa-meetings/SKILL.md) if you have not already.',
    '2. Fetch the final transcript with mcp__vexa__get_meeting_transcript and the recording',
    '   metadata with mcp__vexa__list_recordings (reference the recording by id/url; do not',
    '   download the media).',
    '3. Before writing, check memory under `meeting/<date>/` so you do not duplicate an',
    '   already-captured meeting — update existing entries instead.',
    '4. Store a concise summary plus the decisions and action items in long-term memory using',
    '   the key and metadata scheme defined in the skill.',
    '',
    'If the transcript is empty or unavailable, record that the meeting produced no captured',
    'transcript rather than inventing content.',
  ].join('\n');
}
