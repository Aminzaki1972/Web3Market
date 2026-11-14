import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import {
  confirmDisputeLock, releaseDeclinedDisputeHold, reviewDisputeRequest, submitDisputeRequest,
} from "./dispute-intake.ts";

const evidence = [{ id: "ev1", description: "Initial transfer evidence", submittedAt: 95 }];

Deno.test("either buyer or seller can submit a request and it immediately raises a payout hold", () => {
  const buyer = submitDisputeRequest("r1", "deal-1", "buyer", "Assets not delivered", 100, evidence);
  const seller = submitDisputeRequest("r2", "deal-2", "seller", "Buyer did not complete agreed step", 100, [{ id: "ev-required", description: "Initial evidence submitted with the dispute request", submittedAt: 95 }]);
  assertEquals(buyer.status, "pending_admin_review");
  assertEquals(buyer.payoutHold, true);
  assertEquals(buyer.review, null);
  assertEquals(buyer.evidence.length, 1);
  assertEquals(seller.claimant, "seller");
  assertEquals(seller.payoutHold, true);
});

Deno.test("submission rejects missing fields, invalid time and duplicate/invalid initial evidence", () => {
  assertThrows(() => submitDisputeRequest("", "deal", "buyer", "Reason", 100));
  assertThrows(() => submitDisputeRequest("r", "", "buyer", "Reason", 100));
  assertThrows(() => submitDisputeRequest("r", "deal", "buyer", " ", 100));
  assertThrows(() => submitDisputeRequest("r", "deal", "buyer", "Reason", Number.NaN));
  assertThrows(() => submitDisputeRequest("r", "deal", "buyer", "Reason", 100, []));
  assertThrows(() => submitDisputeRequest("r", "deal", "buyer", "Reason", 100, [
    ...evidence, { ...evidence[0], submittedAt: 90 },
  ]));
  assertThrows(() => submitDisputeRequest("r", "deal", "buyer", "Reason", 100, [
    { ...evidence[0], submittedAt: 101 },
  ]));
});

Deno.test("administrative approval opens the formal dispute path but does not claim Safe lock confirmation", () => {
  const request = submitDisputeRequest("r3", "deal-3", "buyer", "Ownership transfer incomplete", 100, [{ id: "ev-required", description: "Initial evidence submitted with the dispute request", submittedAt: 95 }]);
  const reviewed = reviewDisputeRequest(request, "approved", "Evidence supports opening a dispute", "admin-1", 120);
  assertEquals(reviewed.status, "approved_lock_pending");
  assertEquals(reviewed.payoutHold, true);
  assertEquals(reviewed.review?.outcome, "approved");
  assertEquals(reviewed.holdRelease, null);
});

Deno.test("administrative decline does not automatically release the payout hold", () => {
  const request = submitDisputeRequest("r4", "deal-4", "seller", "Buyer claims non-delivery", 100, [{ id: "ev-required", description: "Initial evidence submitted with the dispute request", submittedAt: 95 }]);
  const reviewed = reviewDisputeRequest(request, "declined", "Insufficient grounds to open a dispute", "admin-2", 120);
  assertEquals(reviewed.status, "declined_hold");
  assertEquals(reviewed.payoutHold, true);
  assertEquals(reviewed.holdRelease, null);
});

Deno.test("a request cannot be reviewed twice or before submission", () => {
  const request = submitDisputeRequest("r5", "deal-5", "buyer", "Reason", 100, [{ id: "ev-required", description: "Initial evidence submitted with the dispute request", submittedAt: 95 }]);
  assertThrows(() => reviewDisputeRequest(request, "approved", "Reason", "admin", 99));
  const reviewed = reviewDisputeRequest(request, "approved", "Reason", "admin", 101);
  assertThrows(() => reviewDisputeRequest(reviewed, "declined", "Changed mind", "admin", 102));
});

Deno.test("review requires a reason and reviewer audit identity", () => {
  const request = submitDisputeRequest("r6", "deal-6", "buyer", "Reason", 100, [{ id: "ev-required", description: "Initial evidence submitted with the dispute request", submittedAt: 95 }]);
  assertThrows(() => reviewDisputeRequest(request, "approved", " ", "admin", 101));
  assertThrows(() => reviewDisputeRequest(request, "approved", "Reason", " ", 101));
  assertThrows(() => reviewDisputeRequest(request, "unexpected" as "approved", "Reason", "admin", 101));
});

Deno.test("declined hold is released only by a separate explicit action after no other hold is confirmed", () => {
  const request = submitDisputeRequest("r7", "deal-7", "buyer", "Reason", 100, [{ id: "ev-required", description: "Initial evidence submitted with the dispute request", submittedAt: 95 }]);
  const declined = reviewDisputeRequest(request, "declined", "No qualifying breach", "admin-1", 120);
  assertThrows(() => releaseDeclinedDisputeHold(declined, "Release", "admin-1", 130, true));
  assertThrows(() => releaseDeclinedDisputeHold(declined, " ", "admin-1", 130, false));
  assertThrows(() => releaseDeclinedDisputeHold(declined, "Release", "admin-1", 119, false));
  const released = releaseDeclinedDisputeHold(declined, "No other active hold after review", "admin-2", 130, false);
  assertEquals(released.status, "administrative_hold_released");
  assertEquals(released.payoutHold, false);
  assertEquals(released.holdRelease?.reviewerId, "admin-2");
});


const validLockProof = {
  chainId: 56,
  safeAddress: "0x1111111111111111111111111111111111111111",
  expectedSafeAddress: "0x1111111111111111111111111111111111111111",
  txHash: "0x" + "a".repeat(64),
  receiptStatus: "success" as const,
  confirmations: 15,
  requiredConfirmations: 12,
  canonicalBlockHash: "0x" + "b".repeat(64),
  lockEventObserved: true,
  lockStateVerified: true,
};

Deno.test("approved dispute becomes lock-confirmed only with matching canonical Safe lock evidence", () => {
  const request = submitDisputeRequest("r9", "deal-9", "buyer", "Reason", 100, [{ id: "ev-required", description: "Initial evidence submitted with the dispute request", submittedAt: 95 }]);
  const approved = reviewDisputeRequest(request, "approved", "Open dispute", "admin", 110);
  const locked = confirmDisputeLock(approved, validLockProof);
  assertEquals(locked.status, "lock_confirmed");
  assertEquals(locked.payoutHold, true);
  assertEquals(locked.lockProof?.chainId, 56);
});

Deno.test("lock confirmation rejects unapproved requests and unsafe/incomplete chain evidence", () => {
  const pending = submitDisputeRequest("r10", "deal-10", "seller", "Reason", 100, [{ id: "ev-required", description: "Initial evidence submitted with the dispute request", submittedAt: 95 }]);
  assertThrows(() => confirmDisputeLock(pending, validLockProof));
  const approved = reviewDisputeRequest(pending, "approved", "Open", "admin", 110);
  for (const proof of [
    { ...validLockProof, chainId: 97 },
    { ...validLockProof, safeAddress: "0x2222222222222222222222222222222222222222" },
    { ...validLockProof, receiptStatus: "failed" as const },
    { ...validLockProof, confirmations: 2 },
    { ...validLockProof, lockEventObserved: false },
    { ...validLockProof, lockStateVerified: false },
    { ...validLockProof, canonicalBlockHash: "0x1234" },
  ]) {
    assertThrows(() => confirmDisputeLock(approved, proof));
  }
});

Deno.test("pending and approved requests cannot use the decline-only hold-release action", () => {
  const pending = submitDisputeRequest("r8", "deal-8", "buyer", "Reason", 100, [{ id: "ev-required", description: "Initial evidence submitted with the dispute request", submittedAt: 95 }]);
  assertThrows(() => releaseDeclinedDisputeHold(pending, "Release", "admin", 110, false));
  const approved = reviewDisputeRequest(pending, "approved", "Open", "admin", 110);
  assertThrows(() => releaseDeclinedDisputeHold(approved, "Release", "admin", 120, false));
});
