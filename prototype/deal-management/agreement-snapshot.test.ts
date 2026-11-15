import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1.0.14";
import { canonicalizeAgreementValue, hashDealAgreementSnapshot } from "./agreement-snapshot.ts";

Deno.test("canonical serialization sorts object keys recursively and preserves array order", () => {
  assertEquals(
    canonicalizeAgreementValue({ z: 1, a: { y: true, x: "value" }, list: [2, 1] }),
    '{"a":{"x":"value","y":true},"list":[2,1],"z":1}',
  );
});

Deno.test("equivalent object key order produces the same SHA-256 agreement hash", async () => {
  const first = await hashDealAgreementSnapshot({
    grossPrice: "10000.000000", commissionBps: 750,
    assets: [{ type: "repository", id: "repo-1" }],
  });
  const second = await hashDealAgreementSnapshot({
    assets: [{ id: "repo-1", type: "repository" }],
    commissionBps: 750, grossPrice: "10000.000000",
  });
  assertEquals(first.canonicalJson, second.canonicalJson);
  assertEquals(first.termsHash, second.termsHash);
  assertEquals(/^0x[0-9a-f]{64}$/.test(first.termsHash), true);
});

Deno.test("array order changes the agreement hash", async () => {
  const first = await hashDealAgreementSnapshot({ assets: ["domain", "repository"] });
  const second = await hashDealAgreementSnapshot({ assets: ["repository", "domain"] });
  assertEquals(first.termsHash === second.termsHash, false);
});

Deno.test("Unicode strings are normalized to NFC before hashing", async () => {
  const composed = await hashDealAgreementSnapshot({ title: "\u00e9" });
  const decomposed = await hashDealAgreementSnapshot({ title: "e\u0301" });
  assertEquals(composed.termsHash, decomposed.termsHash);
});

Deno.test("rejects undefined, non-finite numbers, BigInt, functions and class instances", () => {
  for (const value of [
    { missing: undefined },
    { amount: Number.NaN },
    { amount: Number.POSITIVE_INFINITY },
    { amount: 1n },
    { callback: () => true },
    new Date(),
  ]) {
    assertThrows(() => canonicalizeAgreementValue(value));
  }
});

Deno.test("rejects unsafe keys and normalized duplicate keys", () => {
  assertThrows(() => canonicalizeAgreementValue({ constructor: "bad" }));
  const collision = Object.create(null);
  collision["\u00e9"] = 1;
  collision["e\u0301"] = 2;
  assertThrows(() => canonicalizeAgreementValue(collision));
});

Deno.test("hashing requires a plain top-level object", async () => {
  await assertRejects(() => hashDealAgreementSnapshot([]));
  await assertRejects(() => hashDealAgreementSnapshot("terms"));
});
