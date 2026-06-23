import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import { verifyVexaSignature } from '../src/signature.js';

const SECRET = 'whsec_test_123';
const body = JSON.stringify({ event_type: 'meeting.completed', data: { meeting: { id: 7 } } });

const signed = (ts: string, b: string, secret = SECRET): Record<string, string> => ({
  'x-webhook-timestamp': ts,
  'x-webhook-signature':
    'sha256=' + createHmac('sha256', secret).update(`${ts}.`).update(b).digest('hex'),
});

test('accepts a valid HMAC signature', () => {
  assert.equal(verifyVexaSignature(body, signed('1700000000', body), SECRET), true);
});

test('rejects a tampered body', () => {
  assert.equal(verifyVexaSignature(body + 'x', signed('1700000000', body), SECRET), false);
});

test('rejects a wrong secret', () => {
  assert.equal(verifyVexaSignature(body, signed('1700000000', body, 'other'), SECRET), false);
});

test('falls back to Bearer token when no signature header', () => {
  assert.equal(verifyVexaSignature(body, { authorization: `Bearer ${SECRET}` }, SECRET), true);
  assert.equal(verifyVexaSignature(body, { authorization: 'Bearer nope' }, SECRET), false);
});

test('rejects when no secret configured or no auth present', () => {
  assert.equal(verifyVexaSignature(body, {}, SECRET), false);
  assert.equal(verifyVexaSignature(body, { authorization: `Bearer ${SECRET}` }, ''), false);
});
