import { assertEquals } from "jsr:@std/assert@1.0.14";
import { prepareDisputePayout, prepareOrdinaryPayout } from "./payout-readiness.ts";
import { openDispute, submitClaimantEvidence, submitRespondentResponse, issueDisputeDecision } from "./disputes.ts";

const recipients = {
  buyer: "0x1111111111111111111111111111111111111111",
  seller: "0x2222222222222222222222222222222222222222",
  platform: "0x3333333333333333333333333333333333333333",
};
const ordinary = {
  agreementApproved: true, depositVerified: true, depositedAmount: 7_000_000_000n,
  requiredAssetsVerified: true, buyerFinalAcceptance: true, openDispute: false,
};

Deno.test("ordinary payout requires every gate and produces 92.5/7.5 split", () => {
  const result = prepareOrdinaryPayout(ordinary, recipients);
  assertEquals(result.ready, true);
  if (result.ready) {
    assertEquals(result.plan.sellerPayout, 6_475_000_000n);
    assertEquals(result.plan.platformFee, 525_000_000n);
    assertEquals(result.plan.buyerRefund, 0n);
    assertEquals(result.plan.status, "ready_for_safe_review");
  }
});

Deno.test("ordinary payout is blocked by every missing gate", () => {
  const result = prepareOrdinaryPayout({
    ...ordinary, agreementApproved: false, depositVerified: false,
    requiredAssetsVerified: false, buyerFinalAcceptance: false, openDispute: true,
  }, recipients);
  assertEquals(result.ready, false);
  if (!result.ready) assertEquals(result.blockers, [
    "agreement_not_approved", "deposit_not_verified",
    "required_assets_not_verified", "buyer_final_acceptance_missing", "dispute_open",
  ]);
});

Deno.test("ordinary payout rejects invalid or duplicate active recipient addresses", () => {
  const invalid = prepareOrdinaryPayout(ordinary, { ...recipients, seller: "not-an-address" });
  assertEquals(invalid.ready, false);
  const duplicate = prepareOrdinaryPayout(ordinary, { ...recipients, platform: recipients.seller });
  assertEquals(duplicate.ready, false);
});

Deno.test("dispute payout waits for a decision and uses explicit allocation without recalculating fee", () => {
  let dispute = openDispute("d-1", "buyer", 100, 1_000);
  dispute = submitClaimantEvidence(dispute, "buyer", {
    id: "e1", submittedBy: "buyer", description: "Evidence", submittedAt: 110,
  });
  dispute = submitRespondentResponse(dispute, "seller", {
    id: "e2", submittedBy: "seller", description: "Response", submittedAt: 120,
  }, 120);
  const pending = prepareDisputePayout(true, true, 7_000_000_000n, dispute, recipients);
  assertEquals(pending.ready, false);
  if (!pending.ready) assertEquals(pending.blockers.includes("dispute_decision_not_finalized"), true);

  dispute = issueDisputeDecision(dispute, "Partial refund justified", {
    buyerRefund: 2_000_000_000n, sellerPayout: 4_500_000_000n, platformFee: 500_000_000n,
  }, 7_000_000_000n, 130);
  const ready = prepareDisputePayout(true, true, 7_000_000_000n, dispute, recipients);
  assertEquals(ready.ready, true);
  if (ready.ready) {
    assertEquals(ready.plan.buyerRefund, 2_000_000_000n);
    assertEquals(ready.plan.sellerPayout, 4_500_000_000n);
    assertEquals(ready.plan.platformFee, 500_000_000n);
    assertEquals(ready.plan.mode, "dispute_decision");
  }
});

Deno.test("dispute payout rejects allocation that does not reconcile to deposited amount", () => {
  let dispute = openDispute("d-2", "buyer", 100, 1_000);
  dispute = submitClaimantEvidence(dispute, "buyer", {
    id: "e1", submittedBy: "buyer", description: "Evidence", submittedAt: 110,
  });
  dispute = submitRespondentResponse(dispute, "seller", {
    id: "e2", submittedBy: "seller", description: "Response", submittedAt: 120,
  }, 120);
  dispute = issueDisputeDecision(dispute, "Decision", {
    buyerRefund: 1n, sellerPayout: 1n, platformFee: 1n,
  }, 3n, 130);
  const result = prepareDisputePayout(true, true, 7_000_000_000n, dispute, recipients);
  assertEquals(result.ready, false);
  if (!result.ready) assertEquals(result.blockers, ["dispute_allocation_does_not_match_deposit"]);
});

Deno.test("dispute payout cannot proceed without verified deposit or agreement", () => {
  const dispute = openDispute("d-3", "buyer", 100, 1_000);
  const result = prepareDisputePayout(false, false, 7_000_000_000n, dispute, recipients);
  assertEquals(result.ready, false);
  if (!result.ready) assertEquals(result.blockers.includes("agreement_not_approved"), true);
});

Deno.test("full buyer refund follows explicit dispute allocation and does not create seller/platform payments", () => {
  let dispute = openDispute("d-refund", "buyer", 100, 1_000);
  dispute = submitClaimantEvidence(dispute, "buyer", {
    id: "e1", submittedBy: "buyer", description: "Evidence", submittedAt: 110,
  });
  dispute = submitRespondentResponse(dispute, "seller", {
    id: "e2", submittedBy: "seller", description: "Response", submittedAt: 120,
  }, 120);
  dispute = issueDisputeDecision(dispute, "Full refund under agreement", {
    buyerRefund: 7_000_000_000n, sellerPayout: 0n, platformFee: 0n,
  }, 7_000_000_000n, 130);
  const result = prepareDisputePayout(true, true, 7_000_000_000n, dispute, recipients);
  assertEquals(result.ready, true);
  if (result.ready) {
    assertEquals(result.plan.buyerRefund, 7_000_000_000n);
    assertEquals(result.plan.sellerPayout, 0n);
    assertEquals(result.plan.platformFee, 0n);
  }
});
