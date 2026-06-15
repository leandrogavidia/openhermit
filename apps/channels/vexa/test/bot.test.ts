import assert from 'node:assert/strict';
import { test } from 'node:test';

import { VexaWebhookReceiver } from '../src/bot.js';
import type { NormalizedMeetingEvent } from '../src/types.js';

const SECRET = 'webhook-secret';
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

function makeReceiver() {
  const calls: NormalizedMeetingEvent[] = [];
  const bridge = { finalizeMeeting: async (ref: NormalizedMeetingEvent): Promise<void> => { calls.push(ref); } };
  const receiver = new VexaWebhookReceiver(bridge as never, SECRET, () => {});
  return { receiver, calls };
}

const completedBody = JSON.stringify({
  event_type: 'meeting.status_change',
  meeting: { id: 42, platform: 'google_meet', native_meeting_id: 'abc' },
  status_change: { to: 'completed' },
});

test('rejects a request with a bad signature and does not dispatch', async () => {
  const { receiver, calls } = makeReceiver();
  const res = await receiver.handleWebhook({ headers: { authorization: 'Bearer wrong' }, rawBody: completedBody });
  await tick();
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test('rejects invalid JSON with 400 (after a valid signature)', async () => {
  const { receiver, calls } = makeReceiver();
  const res = await receiver.handleWebhook({ headers: { authorization: `Bearer ${SECRET}` }, rawBody: 'not json' });
  await tick();
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test('acks 200 and dispatches finalization on a completion event', async () => {
  const { receiver, calls } = makeReceiver();
  const res = await receiver.handleWebhook({ headers: { authorization: `Bearer ${SECRET}` }, rawBody: completedBody });
  await tick();
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.meetingId, '42');
});

test('acks 200 but does not dispatch on a non-completion event', async () => {
  const { receiver, calls } = makeReceiver();
  const body = JSON.stringify({ event_type: 'meeting.status_change', meeting: { id: 42 }, status_change: { to: 'active' } });
  const res = await receiver.handleWebhook({ headers: { authorization: `Bearer ${SECRET}` }, rawBody: body });
  await tick();
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
});
