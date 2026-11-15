import { assertEquals } from "jsr:@std/assert@1.0.14";
import { canRecordAgreementApproval, haveAllCurrentAgreementApprovals } from "./agreement-approval-gate.js";

const hashA = "0x" + "a".repeat(64);
const hashB = "0x" + "b".repeat(64);
const approved = { buyer: true, seller: true, platform: true };
const hashesA = { buyer: hashA, seller: hashA, platform: hashA };

Deno.test("approval can only be recorded for a known role and exact current version and digest", () => {
  assertEquals(canRecordAgreementApproval("buyer", 2, hashA, 2, hashA), true);
  assertEquals(canRecordAgreementApproval("platform", 2, hashA, 2, hashA), true);
  assertEquals(canRecordAgreementApproval("attacker", 2, hashA, 2, hashA), false);
  assertEquals(canRecordAgreementApproval("seller", 1, hashA, 2, hashA), false);
  assertEquals(canRecordAgreementApproval("seller", 2, hashA, 2, hashB), false);
  assertEquals(canRecordAgreementApproval("seller", 2, "bad-hash", 2, "bad-hash"), false);
});

Deno.test("deposit gate requires all three approvals to match the current fingerprint", () => {
  assertEquals(haveAllCurrentAgreementApprovals(approved, hashesA, 2, hashA), true);
  assertEquals(haveAllCurrentAgreementApprovals({ ...approved, platform: false }, hashesA, 2, hashA), false);
  assertEquals(haveAllCurrentAgreementApprovals(approved, { ...hashesA, seller: hashB }, 2, hashA), false);
  assertEquals(haveAllCurrentAgreementApprovals(approved, hashesA, 3, hashA), true);
  assertEquals(haveAllCurrentAgreementApprovals(approved, hashesA, 0, hashA), false);
  assertEquals(haveAllCurrentAgreementApprovals(approved, hashesA, 2, null), false);
});

Deno.test("old approvals cannot satisfy the gate after the agreement digest changes", () => {
  assertEquals(haveAllCurrentAgreementApprovals(approved, hashesA, 3, hashB), false);
});
