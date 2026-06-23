import type { NormalizedMeetingEvent, VexaWebhookEvent } from './types.js';

/**
 * Reduce a raw Vexa webhook envelope to the completion event we act on, or
 * `null` if it is not a completion we care about.
 *
 * Vexa enables ONLY `meeting.completed` by default (verified against
 * meeting-api `webhooks._is_event_enabled`). We additionally accept a
 * `meeting.status_change` whose status resolves to `completed`, for operators
 * who opt extra events in — deduped downstream by meeting id so the two never
 * double-trigger.
 */
export function normalizeEvent(
  event: VexaWebhookEvent | null | undefined,
): NormalizedMeetingEvent | null {
  if (!event) return null;
  const meeting = event.data?.meeting;
  if (!meeting || meeting.id == null) return null;

  const base = (kind: NormalizedMeetingEvent['kind']): NormalizedMeetingEvent => {
    const out: NormalizedMeetingEvent = { meetingId: String(meeting.id), kind };
    if (meeting.platform) out.platform = meeting.platform;
    if (meeting.native_meeting_id) out.nativeMeetingId = meeting.native_meeting_id;
    return out;
  };

  if (event.event_type === 'meeting.completed') {
    return base('meeting_completed');
  }

  if (event.event_type === 'meeting.status_change') {
    const to = event.data?.status_change?.to ?? meeting.status;
    if (to === 'completed') return base('status_completed');
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
    '2. Fetch the final transcript via the mcp__vexa__* tools (find the meeting by',
    '   platform + native_meeting_id, then get its transcript) plus the recording',
    '   metadata — reference the recording by id/url; do not download the media.',
    '3. Before writing, check memory under `meeting/<date>/` so you do not duplicate',
    '   an already-captured meeting — update existing entries instead.',
    '4. Store a concise summary plus the decisions and action items in long-term',
    '   memory using the key and metadata scheme defined in the skill.',
    '',
    'If the transcript is empty or unavailable, record that the meeting produced no',
    'captured transcript rather than inventing content.',
  ].join('\n');
}
