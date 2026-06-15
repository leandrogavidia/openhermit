import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import { verifyVexaSignature } from '../src/signature.js';

const SECRET = 's3cret-value';
const BODY = '{"event_type":"meeting.status_change"}';
const hmac = createHmac('sha256', SECRET).update(BODY, 'utf8').digest('hex');

test('accepts the shared-secret bearer token', () => {
  assert.equal(verifyVexaSignature(BODY, { authorization: `Bearer ${SECRET}` }, SECRET), true);
});

test('accepts a body HMAC in the bearer token', () => {
  assert.equal(verifyVexaSignature(BODY, { authorization: `Bearer ${hmac}` }, SECRET), true);
});

test('accepts a body HMAC in X-Vexa-Signature (sha256= prefix)', () => {
  assert.equal(verifyVexaSignature(BODY, { 'x-vexa-signature': `sha256=${hmac}` }, SECRET), true);
});

test('rejects a wrong token', () => {
  assert.equal(verifyVexaSignature(BODY, { authorization: 'Bearer nope' }, SECRET), false);
});

test('rejects an HMAC over a tampered body', () => {
  assert.equal(verifyVexaSignature('{"tampered":true}', { authorization: `Bearer ${hmac}` }, SECRET), false);
});

test('rejects when no secret is configured (never accept unauthenticated)', () => {
  assert.equal(verifyVexaSignature(BODY, { authorization: `Bearer ${SECRET}` }, ''), false);
});

test('rejects when no signature header is present', () => {
  assert.equal(verifyVexaSignature(BODY, {}, SECRET), false);
});
