import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeEvent, buildFinalizationPrompt } from '../src/events.js';

test('meeting.status_change → completed yields a normalized event', () => {
  const out = normalizeEvent({
    event_type: 'meeting.status_change',
    meeting: { id: 219, platform: 'google_meet', native_meeting_id: 'abc-defg-hij' },
    status_change: { from: 'active', to: 'completed' },
  });
  assert.deepEqual(out, {
    meetingId: '219',
    kind: 'meeting_completed',
    platform: 'google_meet',
    nativeMeetingId: 'abc-defg-hij',
  });
});

test('meeting.status_change to a non-completed status is ignored', () => {
  assert.equal(
    normalizeEvent({ event_type: 'meeting.status_change', meeting: { id: 1 }, status_change: { to: 'active' } }),
    null,
  );
});

test('recording.completed yields a normalized event with the recording id', () => {
  const out = normalizeEvent({
    event_type: 'recording.completed',
    recording: { id: 906, meeting_id: 16, status: 'completed' },
  });
  assert.deepEqual(out, { meetingId: '16', kind: 'recording_completed', recordingId: '906' });
});

test('accepts the WebSocket `type` field as well as `event_type`', () => {
  const out = normalizeEvent({ type: 'meeting.status_change', meeting: { id: 7 }, status_change: { to: 'completed' } });
  assert.equal(out?.meetingId, '7');
});

test('unknown event types and missing ids return null', () => {
  assert.equal(normalizeEvent({ event_type: 'meeting.status_change', meeting: { id: 1 } }), null); // no status_change.to
  assert.equal(normalizeEvent({ event_type: 'transcript.mutable' }), null);
  assert.equal(normalizeEvent({ event_type: 'recording.completed', recording: {} }), null);
  assert.equal(normalizeEvent(null), null);
  assert.equal(normalizeEvent(undefined), null);
});

test('finalization prompt names the meeting and points at the skill', () => {
  const prompt = buildFinalizationPrompt({
    meetingId: '219',
    kind: 'meeting_completed',
    platform: 'google_meet',
    nativeMeetingId: 'abc-defg-hij',
  });
  assert.match(prompt, /219/);
  assert.match(prompt, /google_meet/);
  assert.match(prompt, /vexa-meetings/);
  assert.match(prompt, /mcp__vexa__get_meeting_transcript/);
});
