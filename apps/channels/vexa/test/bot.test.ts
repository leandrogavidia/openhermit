import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import { VexaWebhookReceiver } from '../src/bot.js';
import type { VexaBridge } from '../src/bridge.js';
import type { NormalizedMeetingEvent } from '../src/types.js';

const SECRET = 'whsec_test';

class FakeBridge {
  calls: NormalizedMeetingEvent[] = [];
  async finalizeMeeting(ref: NormalizedMeetingEvent): Promise<void> {
    this.calls.push(ref);
  }
}

const sign = (ts: string, body: string): Record<string, string> => ({
  'content-type': 'application/json',
  'x-webhook-timestamp': ts,
  'x-webhook-signature':
    'sha256=' + createHmac('sha256', SECRET).update(`${ts}.`).update(body).digest('hex'),
});

const make = (): { bridge: FakeBridge; receiver: VexaWebhookReceiver } => {
  const bridge = new FakeBridge();
  const receiver = new VexaWebhookReceiver(bridge as unknown as VexaBridge, SECRET, () => {});
  return { bridge, receiver };
};

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

test('rejects bad signature with 401', async () => {
  const { bridge, receiver } = make();
  const res = await receiver.handleWebhook({ rawBody: '{}', headers: { authorization: 'Bearer nope' } });
  assert.equal(res.status, 401);
  assert.equal(bridge.calls.length, 0);
});

test('acks and dispatches finalize on meeting.completed', async () => {
  const { bridge, receiver } = make();
  const body = JSON.stringify({
    event_type: 'meeting.completed',
    data: { meeting: { id: 11, platform: 'zoom' } },
  });
  const res = await receiver.handleWebhook({ rawBody: body, headers: sign('1700000000', body) });
  assert.equal(res.status, 200);
  await flush();
  assert.equal(bridge.calls.length, 1);
  assert.equal(bridge.calls[0].meetingId, '11');
});

test('acks but does not dispatch on a non-completion event', async () => {
  const { bridge, receiver } = make();
  const body = JSON.stringify({ event_type: 'meeting.started', data: { meeting: { id: 1 } } });
  const res = await receiver.handleWebhook({ rawBody: body, headers: sign('1700000000', body) });
  assert.equal(res.status, 200);
  await flush();
  assert.equal(bridge.calls.length, 0);
});

test('returns 400 on invalid json with a valid signature', async () => {
  const { receiver } = make();
  const body = 'not json';
  const res = await receiver.handleWebhook({ rawBody: body, headers: sign('1700000000', body) });
  assert.equal(res.status, 400);
});
