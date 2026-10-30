import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifiedAal } from '../supabase/functions/_shared/aal.mjs';

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

const adminReviewSource = readFileSync(new URL('../supabase/functions/admin-review/index.ts', import.meta.url), 'utf8');

test('requires verified JWT, admin membership, and AAL2 before parsing or routing any action', () => {
  const jwtVerification = adminReviewSource.indexOf('admin.auth.getUser(token)');
  const adminMembership = adminReviewSource.indexOf("admin.from('admin_users')");
  const aal2Guard = adminReviewSource.indexOf("if(verifiedAal(token)!=='aal2')");
  const bodyParsing = adminReviewSource.indexOf('await req.json()');

  assert.ok(jwtVerification >= 0, 'JWT must be verified by Supabase');
  assert.ok(adminMembership > jwtVerification, 'admin membership must be checked after JWT verification');
  assert.ok(aal2Guard > adminMembership, 'AAL2 must be checked after admin membership');
  assert.ok(bodyParsing > aal2Guard, 'request body must not be parsed before the AAL2 guard');

  for (const route of [
    "if(action==='audit_archive')",
    "if(action==='list')",
    "if(action==='monitoring')",
    "if(!['approved','approved_for_test','changes_requested','rejected'].includes(action))"
  ]) {
    const routeIndex = adminReviewSource.indexOf(route);
    assert.ok(routeIndex > bodyParsing, `protected route must remain behind the AAL2 guard: ${route}`);
  }
});
