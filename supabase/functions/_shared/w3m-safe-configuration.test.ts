import { assertEquals } from "jsr:@std/assert@1.0.14";
import { assessSafeConfiguration } from "./w3m-safe-configuration.js";

const A = "0x" + "1".repeat(40);
const B = "0x" + "2".repeat(40);
const C = "0x" + "3".repeat(40);
const CODE = "0x60006000";
const EXPECTED = [A, B, C];

Deno.test("server Safe validator accepts only the approved exact 2-of-3 owner set", () => {
  assertEquals(assessSafeConfiguration({ owners: [A, B, C], threshold: 2n, code: CODE, expectedOwners: EXPECTED }), {
    ok: true, ownerCount: 3, threshold: "2", reason: "valid",
  });
  assertEquals(assessSafeConfiguration({ owners: [A, B, C], threshold: 1n, code: CODE, expectedOwners: EXPECTED }).reason, "threshold_must_be_two_of_three");
  assertEquals(assessSafeConfiguration({ owners: [A, B, "0x" + "4".repeat(40)], threshold: 2n, code: CODE, expectedOwners: EXPECTED }).reason, "owner_set_mismatch");
});

Deno.test("server Safe validator rejects missing code, duplicate owners, and unavailable expected owners", () => {
  assertEquals(assessSafeConfiguration({ owners: [A, B, C], threshold: 2n, code: "0x", expectedOwners: EXPECTED }).reason, "safe_contract_not_found");
  assertEquals(assessSafeConfiguration({ owners: [A, A, C], threshold: 2n, code: CODE, expectedOwners: EXPECTED }).reason, "duplicate_owners");
  assertEquals(assessSafeConfiguration({ owners: [A, B, C], threshold: 2n, code: CODE }).reason, "expected_owner_set_unavailable");
});
