import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import {
  assertCanAppendW3MTermsVersion,
  filterCurrentW3MAcceptances,
  isW3MAcceptanceCurrentForTerms,
  type W3MTermsVersionRecord,
} from "./terms-version-lifecycle.ts";

const dealId = "11111111-1111-4111-8111-111111111111";
const first = (): W3MTermsVersionRecord => ({
  deal_id: dealId,
  terms_version: 1,
  terms_hash: "a".repeat(64),
  canonical_terms_json: '{"terms_version":1}',
  status: "superseded",
  published_at: "2026-11-07T10:00:00Z",
});
const second = (): W3MTermsVersionRecord => ({
  deal_id: dealId,
  terms_version: 2,
  terms_hash: "b".repeat(64),
  canonical_terms_json: '{"terms_version":2}',
  status: "published",
  published_at: "2026-11-07T11:00:00Z",
});

Deno.test("allows only the next sequential immutable version", () => {
  assertCanAppendW3MTermsVersion([first()], second());
});

Deno.test("rejects a skipped, repeated, or hash-reused version", () => {
  const skipped = second();
  skipped.terms_version = 3;
  assertThrows(() => assertCanAppendW3MTermsVersion([first()], skipped));
  const repeated = second();
  repeated.terms_version = 1;
  assertThrows(() => assertCanAppendW3MTermsVersion([first()], repeated));
  const reusedHash = second();
  reusedHash.terms_hash = first().terms_hash;
  assertThrows(() => assertCanAppendW3MTermsVersion([first()], reusedHash));
});

Deno.test("requires old published version to be superseded in the transaction", () => {
  const oldPublished = first();
  oldPublished.status = "published";
  assertThrows(() => assertCanAppendW3MTermsVersion([oldPublished], second()));
});

Deno.test("rejects mixed-deal and duplicate history", () => {
  const otherDeal = first();
  otherDeal.deal_id = "22222222-2222-4222-8222-222222222222";
  assertThrows(() => assertCanAppendW3MTermsVersion([otherDeal], second()));
  assertThrows(() => assertCanAppendW3MTermsVersion([first(), first()], second()));
});

Deno.test("acceptance counts only when deal, version and hash match current terms", () => {
  const current = second();
  const currentAcceptance = { deal_id: dealId, terms_version: 2, terms_hash: "b".repeat(64) };
  const oldVersion = { deal_id: dealId, terms_version: 1, terms_hash: "a".repeat(64) };
  const alteredHash = { deal_id: dealId, terms_version: 2, terms_hash: "c".repeat(64) };
  assertEquals(isW3MAcceptanceCurrentForTerms(currentAcceptance, current), true);
  assertEquals(isW3MAcceptanceCurrentForTerms(oldVersion, current), false);
  assertEquals(isW3MAcceptanceCurrentForTerms(alteredHash, current), false);
  assertEquals(filterCurrentW3MAcceptances([currentAcceptance, oldVersion, alteredHash], current), [currentAcceptance]);
});

Deno.test("does not count acceptance for a superseded version", () => {
  const superseded = second();
  superseded.status = "superseded";
  assertEquals(isW3MAcceptanceCurrentForTerms({
    deal_id: dealId, terms_version: 2, terms_hash: "b".repeat(64),
  }, superseded), false);
});
