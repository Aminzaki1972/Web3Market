import { assertEquals } from "jsr:@std/assert@1.0.14";
import { assessSafeConfiguration } from "./w3m-safe-configuration.js";

const A = "0x" + "1".repeat(40);
const B = "0x" + "2".repeat(40);
const C = "0x" + "3".repeat(40);
const LETTER_ADDRESS = "0x" + "abcdef".repeat(6) + "abcd";
const CODE = "0x60006000";

Deno.test("accepts only the approved 2-of-3 Safe configuration", () => {
  assertEquals(assessSafeConfiguration({ owners: [A, B, C], threshold: 2n, code: CODE }), {
    ok: true, ownerCount: 3, threshold: "2", reason: "valid",
  });
  assertEquals(assessSafeConfiguration({ owners: [A, B, C], threshold: 3n, code: CODE }).reason, "threshold_must_be_two_of_three");
  assertEquals(assessSafeConfiguration({ owners: [A, B], threshold: 1n, code: CODE }).reason, "owner_count_must_be_three");
});

Deno.test("rejects absent contract code, empty owners, and malformed owner addresses", () => {
  assertEquals(assessSafeConfiguration({ owners: [A], threshold: 1n, code: "0x" }).reason, "safe_contract_not_found");
  assertEquals(assessSafeConfiguration({ owners: [], threshold: 1n, code: CODE }).reason, "owners_missing");
  assertEquals(assessSafeConfiguration({ owners: ["not-an-address"], threshold: 1n, code: CODE }).reason, "invalid_owner_address");
  assertEquals(assessSafeConfiguration({ owners: ["0x" + "0".repeat(40)], threshold: 1n, code: CODE }).reason, "zero_owner_address");
});

Deno.test("rejects duplicate owners regardless of address casing", () => {
  assertEquals(assessSafeConfiguration({
    owners: [LETTER_ADDRESS, LETTER_ADDRESS.toUpperCase().replace("0X", "0x")],
    threshold: 1n,
    code: CODE,
  }).reason, "duplicate_owners");
});

Deno.test("rejects zero, negative, excessive, and non-numeric thresholds", () => {
  for (const threshold of [0n, -1n, 1n, 3n, "not-a-number"]) {
    assertEquals(assessSafeConfiguration({ owners: [A, B], threshold, code: CODE }).ok, false);
  }
});
