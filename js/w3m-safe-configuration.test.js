import { assertEquals } from "jsr:@std/assert@1.0.14";
import { assessSafeConfiguration } from "./w3m-safe-configuration.js";

const A = "0x" + "1".repeat(40);
const B = "0x" + "2".repeat(40);
const C = "0x" + "3".repeat(40);
const LETTER_ADDRESS = "0x" + "abcdef".repeat(6) + "abcd";
const CODE = "0x60006000";
const EXPECTED = [A, B, C];

Deno.test("accepts only the approved 2-of-3 Safe configuration", () => {
  assertEquals(assessSafeConfiguration({ owners: [A, B, C], threshold: 2n, code: CODE, expectedOwners: EXPECTED }), {
    ok: true, ownerCount: 3, threshold: "2", reason: "valid",
  });
  assertEquals(assessSafeConfiguration({ owners: [A, B, C], threshold: 3n, code: CODE, expectedOwners: EXPECTED }).reason, "threshold_must_be_two_of_three");
  assertEquals(assessSafeConfiguration({ owners: [A, B], threshold: 1n, code: CODE, expectedOwners: EXPECTED }).reason, "owner_count_must_be_three");
});

Deno.test("rejects absent contract code, empty owners, and malformed owner addresses", () => {
  assertEquals(assessSafeConfiguration({ owners: [A], threshold: 1n, code: "0x", expectedOwners: EXPECTED }).reason, "safe_contract_not_found");
  assertEquals(assessSafeConfiguration({ owners: [], threshold: 1n, code: CODE, expectedOwners: EXPECTED }).reason, "owners_missing");
  assertEquals(assessSafeConfiguration({ owners: ["not-an-address", B, C], threshold: 2n, code: CODE, expectedOwners: EXPECTED }).reason, "invalid_owner_address");
  assertEquals(assessSafeConfiguration({ owners: ["0x" + "0".repeat(40), B, C], threshold: 2n, code: CODE, expectedOwners: EXPECTED }).reason, "zero_owner_address");
});

Deno.test("rejects duplicate owners regardless of address casing", () => {
  assertEquals(assessSafeConfiguration({
    owners: [LETTER_ADDRESS, LETTER_ADDRESS.toUpperCase().replace("0X", "0x"), C],
    threshold: 2n,
    code: CODE,
    expectedOwners: EXPECTED,
  }).reason, "duplicate_owners");
});

Deno.test("rejects a live owner set that differs from the buyer, seller, and platform expected set", () => {
  assertEquals(assessSafeConfiguration({ owners: [A, B, "0x" + "4".repeat(40)], threshold: 2n, code: CODE, expectedOwners: EXPECTED }).reason, "owner_set_mismatch");
});

Deno.test("fails closed when the expected owner set is unavailable or invalid", () => {
  assertEquals(assessSafeConfiguration({ owners: [A, B, C], threshold: 2n, code: CODE }).reason, "expected_owner_set_unavailable");
  assertEquals(assessSafeConfiguration({ owners: [A, B, C], threshold: 2n, code: CODE, expectedOwners: [A, B, A] }).reason, "expected_owner_set_invalid");
  assertEquals(assessSafeConfiguration({ owners: [A, B, C], threshold: 2n, code: CODE, expectedOwners: [A, B, "invalid"] }).reason, "expected_owner_set_invalid");
});
Deno.test("rejects zero, negative, excessive, and non-numeric thresholds", () => {
  for (const threshold of [0n, -1n, 1n, 3n, "not-a-number"]) {
    assertEquals(assessSafeConfiguration({ owners: [A, B], threshold, code: CODE, expectedOwners: EXPECTED }).ok, false);
  }
});
