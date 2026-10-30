import test from 'node:test';
import assert from 'node:assert/strict';
import { verifiedAal } from '../supabase/functions/_shared/aal.js';

const makeToken = (claims) => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;

test('accepts an aal2 claim after the caller has verified the JWT', () => {
  assert.equal(verifiedAal(makeToken({ sub: 'user-1', aal: 'aal2' })), 'aal2');
});

test('identifies aal1 so the authorization guard can reject it', () => {
  assert.equal(verifiedAal(makeToken({ sub: 'user-1', aal: 'aal1' })), 'aal1');
});

test('returns null when the aal claim is missing', () => {
  assert.equal(verifiedAal(makeToken({ sub: 'user-1' })), null);
});

test('returns null for malformed tokens', () => {
  assert.equal(verifiedAal('not-a-jwt'), null);
});

test('handles JWT payloads containing Unicode metadata', () => {
  assert.equal(verifiedAal(makeToken({ sub: 'user-1', user_metadata: { name: 'أمين' }, aal: 'aal2' })), 'aal2');
});
