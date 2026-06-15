import assert from 'node:assert/strict';
import { test } from 'node:test';

import { VexaBridge } from '../src/bridge.js';

interface RecordedCall {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

function makeBridge() {
  const calls: RecordedCall[] = [];
  const fakeFetch = async (input: unknown, init?: { method?: string; body?: string }): Promise<Response> => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {},
    });
    return new Response(JSON.stringify({ sessionId: 'vexa:42', triggered: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const bridge = new VexaBridge({ baseUrl: 'http://gw', token: 't', fetch: fakeFetch as unknown as typeof fetch });
  return { bridge, calls };
}

test('finalizeMeeting opens an owner-scoped session and posts the capture prompt', async () => {
  const { bridge, calls } = makeBridge();
  await bridge.finalizeMeeting({
    meetingId: '42',
    kind: 'meeting_completed',
    platform: 'google_meet',
    nativeMeetingId: 'abc',
  });

  const open = calls.find((c) => c.url.endsWith('/sessions'));
  const post = calls.find((c) => c.url.endsWith('/messages'));
  assert.ok(open, 'should open a session');
  assert.ok(post, 'should post a message');

  assert.equal(open.body.sessionId, 'vexa:42');
  assert.deepEqual(open.body.source, { kind: 'channel', interactive: false, platform: 'vexa', type: 'direct' });
  const meta = open.body.metadata as Record<string, unknown>;
  assert.equal(meta.act_as_owner, true);
  assert.equal(meta.vexa_meeting_id, '42');
  assert.equal(meta.vexa_platform, 'google_meet');

  assert.equal(post.url.endsWith('/sessions/vexa%3A42/messages'), true);
  assert.equal(post.body.messageId, 'vexa:42:finalize');
  assert.equal(post.body.mentioned, true);
  assert.match(String(post.body.text), /42/);
});

test('a duplicate completion for the same meeting is ignored (dedup)', async () => {
  const { bridge, calls } = makeBridge();
  const ref = { meetingId: '42', kind: 'meeting_completed' as const };
  await bridge.finalizeMeeting(ref);
  const afterFirst = calls.length;
  await bridge.finalizeMeeting(ref); // e.g. recording.completed retry / second event
  assert.equal(calls.length, afterFirst, 'second finalize for the same meeting must not call the gateway again');
});
