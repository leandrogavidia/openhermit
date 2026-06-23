import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildFinalizationPrompt, normalizeEvent } from '../src/events.js';

test('normalizes meeting.completed', () => {
  const n = normalizeEvent({
    event_type: 'meeting.completed',
    data: { meeting: { id: 42, platform: 'google_meet', native_meeting_id: 'abc-defg-hij' } },
  });
  assert.deepEqual(n, {
    meetingId: '42',
    kind: 'meeting_completed',
    platform: 'google_meet',
    nativeMeetingId: 'abc-defg-hij',
  });
});

test('normalizes status_change resolving to completed', () => {
  const n = normalizeEvent({
    event_type: 'meeting.status_change',
    data: { meeting: { id: 5, platform: 'zoom' }, status_change: { to: 'completed' } },
  });
  assert.equal(n?.kind, 'status_completed');
  assert.equal(n?.meetingId, '5');
  assert.equal(n?.platform, 'zoom');
});

test('ignores non-completion status_change', () => {
  assert.equal(
    normalizeEvent({
      event_type: 'meeting.status_change',
      data: { meeting: { id: 5 }, status_change: { to: 'joining' } },
    }),
    null,
  );
});

test('ignores other event types and missing meeting id', () => {
  assert.equal(normalizeEvent({ event_type: 'meeting.started', data: { meeting: { id: 1 } } }), null);
  assert.equal(normalizeEvent({ event_type: 'meeting.completed', data: { meeting: {} } }), null);
  assert.equal(normalizeEvent(null), null);
  assert.equal(normalizeEvent(undefined), null);
});

test('finalization prompt references the meeting, platform, and skill', () => {
  const p = buildFinalizationPrompt({
    meetingId: '9',
    kind: 'meeting_completed',
    platform: 'zoom',
    nativeMeetingId: 'x-y-z',
  });
  assert.match(p, /Vexa meeting id: 9/);
  assert.match(p, /vexa-meetings/);
  assert.match(p, /zoom/);
});
