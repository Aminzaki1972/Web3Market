import { assertEquals } from "jsr:@std/assert@1.0.14";
import { assessSafeConfiguration } from "./w3m-safe-configuration.js";

const A = "0x" + "1".repeat(40);
const B = "0x" + "2".repeat(40);
const C = "0x" + "3".repeat(40);
const CODE = "0x60006000";

Deno.test("accepts valid Safe configurations with different owner counts and thresholds", () => {
  assertEquals(assessSafeConfiguration({ owners: [A, B], threshold: 1n, code: CODE }), {
    ok: true, ownerCount: 2, threshold: "1", reason: "valid",
  });
  assertEquals(assessSafeConfiguration({ owners: [A, B, C], threshold: 2n, code: CODE }), {
    ok: true, ownerCount: 3, threshold: "2", reason: "valid",
  });
  assertEquals(assessSafeConfiguration({ owners: [A, B, C], threshold: 3n, code: CODE }), {
    ok: true, ownerCount: 3, threshold: "3", reason: "valid",
  });
});

Deno.test("rejects absent contract code, empty owners, and malformed owner addresses", () => {
  assertEquals(assessSafeConfiguration({ owners: [A], threshold: 1n, code: "0x" }).reason, "safe_contract_not_found");
  assertEquals(assessSafeConfiguration({ owners: [], threshold: 1n, code: CODE }).reason, "owners_missing");
  assertEquals(assessSafeConfiguration({ owners: ["not-an-address"], threshold: 1n, code: CODE }).reason, "invalid_owner_address");
});

Deno.test("rejects duplicate owners regardless of address casing", () => {
  assertEquals(assessSafeConfiguration({
    owners: [A, A.toUpperCase().replace("0X", "0x")],
    threshold: 1n,
    code: CODE,
  }).reason, "duplicate_owners");
});

Deno.test("rejects zero, negative, excessive, and non-numeric thresholds", () => {
  for (const threshold of [0n, -1n, 3n, "not-a-number"]) {
    assertEquals(assessSafeConfiguration({ owners: [A, B], threshold, code: CODE }).ok, false);
  }
});
