import { assertEquals } from "jsr:@std/assert@1.0.14";
import { prepareDisputePayout, prepareOrdinaryPayout } from "./payout-readiness.ts";
import { openDispute, submitClaimantEvidence, submitRespondentResponse, issueDisputeDecision } from "./disputes.ts";
import { parseUsdtAmount } from "./core.ts";
import { confirmDisputeLock, reviewDisputeRequest, submitDisputeRequest } from "./dispute-intake.ts";

const recipients = {
  buyer: "0x1111111111111111111111111111111111111111",
  seller: "0x2222222222222222222222222222222222222222",
  platform: "0x3333333333333333333333333333333333333333",
};
const ordinary = {
  agreementApproved: true, depositVerified: true, depositedAmount: 7_000_000_000n,
  requiredAssetsVerified: true, buyerFinalAcceptance: true, openDispute: false,
  disputeEverOpened: false,
  disputeRequest: null,
};
const gross = parseUsdtAmount("10000");
const fee = parseUsdtAmount("750");
const initialEvidence = [{ id: "initial-evidence", description: "Initial evidence attached to the dispute request", submittedAt: 95 }];

function resolvedDispute(id: string, allocation: {
  buyerGrossRefund: bigint; sellerPayout: bigint; platformFee: bigint;
}) {
  let dispute = openDispute(id, "buyer", 100, 1_000);
  dispute = submitClaimantEvidence(dispute, "buyer", {
    id: id + "-e1", submittedBy: "buyer", description: "Evidence", submittedAt: 110,
  });
  dispute = submitRespondentResponse(dispute, "seller", {
    id: id + "-e2", submittedBy: "seller", description: "Response", submittedAt: 120,
  }, 120);
  return issueDisputeDecision(dispute, "Administrative decision", allocation, gross, gross, 130);
}

function approvedLockConfirmedRequest(id: string) {
  const submitted = submitDisputeRequest(id, "deal-10000", "buyer", "Evidence reviewed", 100, initialEvidence);
  const approved = reviewDisputeRequest(submitted, "approved", "Formal dispute opened", "admin", 110);
  return confirmDisputeLock(approved, {
    chainId: 56, safeAddress: recipients.buyer, expectedSafeAddress: recipients.buyer,
    txHash: "0x" + "a".repeat(64), receiptStatus: "success", confirmations: 15,
    requiredConfirmations: 12, canonicalBlockHash: "0x" + "b".repeat(64),
    lockEventObserved: true, lockStateVerified: true,
  });
}

function disputeInput(dispute: ReturnType<typeof resolvedDispute>) {
  return {
    agreementApproved: true, depositVerified: true, depositedAmount: gross,
    originalGrossAgreedAmount: gross, dealId: "deal-10000", dealSafeAddress: recipients.buyer, dispute, disputeRequest: approvedLockConfirmedRequest(dispute.id), recipients,
  };
}


Deno.test("ordinary payout is blocked during administrative review and after approval pending Safe lock", () => {
  const pending = submitDisputeRequest("ordinary-pending", "deal-10000", "buyer", "Pending review", 100, initialEvidence);
  const pendingResult = prepareOrdinaryPayout({ ...ordinary, disputeRequest: pending }, recipients);
  assertEquals(pendingResult.ready, false);
  if (!pendingResult.ready) assertEquals(pendingResult.blockers.includes("administrative_review_hold"), true);

  const approved = reviewDisputeRequest(pending, "approved", "Open dispute", "admin", 110);
  const approvedResult = prepareOrdinaryPayout({ ...ordinary, disputeRequest: approved }, recipients);
  assertEquals(approvedResult.ready, false);
  if (!approvedResult.ready) assertEquals(approvedResult.blockers.includes("dispute_requires_decision_payout"), true);
});

Deno.test("ordinary payout remains blocked after declined review until explicit hold release", () => {
  const pending = submitDisputeRequest("ordinary-declined", "deal-10000", "seller", "Request review", 100, initialEvidence);
  const declined = reviewDisputeRequest(pending, "declined", "Declined with reasons", "admin", 110);
  const blocked = prepareOrdinaryPayout({ ...ordinary, disputeRequest: declined }, recipients);
  assertEquals(blocked.ready, false);
  if (!blocked.ready) assertEquals(blocked.blockers.includes("administrative_review_hold"), true);
});

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

Deno.test("ordinary payout cannot be used after a dispute has been opened", () => {
  const result = prepareOrdinaryPayout({ ...ordinary, disputeEverOpened: true }, recipients);
  assertEquals(result.ready, false);
  if (!result.ready) assertEquals(result.blockers, ["dispute_requires_decision_payout"]);
});

Deno.test("ordinary payout rejects invalid or duplicate active recipient addresses", () => {
  assertEquals(prepareOrdinaryPayout(ordinary, { ...recipients, seller: "not-an-address" }).ready, false);
  assertEquals(prepareOrdinaryPayout(ordinary, { ...recipients, platform: recipients.seller }).ready, false);
});

Deno.test("partial refund deducts full commission from buyer gross refund, not seller allocation", () => {
  const dispute = resolvedDispute("partial", {
    buyerGrossRefund: parseUsdtAmount("4000"),
    sellerPayout: parseUsdtAmount("6000"),
    platformFee: fee,
  });
  const result = prepareDisputePayout(disputeInput(dispute));
  assertEquals(result.ready, true);
  if (result.ready) {
    assertEquals(result.plan.buyerRefund, parseUsdtAmount("3250"));
    assertEquals(result.plan.sellerPayout, parseUsdtAmount("6000"));
    assertEquals(result.plan.platformFee, fee);
    assertEquals(result.plan.buyerRefund + result.plan.sellerPayout + result.plan.platformFee, gross);
  }
});

Deno.test("full refund returns gross deposit less full buyer-paid commission", () => {
  const dispute = resolvedDispute("full-refund", {
    buyerGrossRefund: gross, sellerPayout: 0n, platformFee: fee,
  });
  const result = prepareDisputePayout(disputeInput(dispute));
  assertEquals(result.ready, true);
  if (result.ready) {
    assertEquals(result.plan.buyerRefund, parseUsdtAmount("9250"));
    assertEquals(result.plan.sellerPayout, 0n);
    assertEquals(result.plan.platformFee, fee);
  }
});

Deno.test("seller-only dispute outcome still allocates fee from buyer's gross bucket", () => {
  const dispute = resolvedDispute("seller-only", {
    buyerGrossRefund: fee, sellerPayout: parseUsdtAmount("9250"), platformFee: fee,
  });
  const result = prepareDisputePayout(disputeInput(dispute));
  assertEquals(result.ready, true);
  if (result.ready) {
    assertEquals(result.plan.buyerRefund, 0n);
    assertEquals(result.plan.sellerPayout, parseUsdtAmount("9250"));
    assertEquals(result.plan.platformFee, fee);
  }
});

Deno.test("payout blocks wrong fee, wrong agreement amount and mismatched deposit", () => {
  const valid = resolvedDispute("valid", {
    buyerGrossRefund: parseUsdtAmount("2000"),
    sellerPayout: parseUsdtAmount("8000"),
    platformFee: fee,
  });
  const wrongFee = {
    ...valid,
    decision: { ...valid.decision!, allocation: { ...valid.decision!.allocation, platformFee: 1n } },
  };
  const feeResult = prepareDisputePayout({ ...disputeInput(wrongFee), dispute: wrongFee });
  assertEquals(feeResult.ready, false);
  if (!feeResult.ready) assertEquals(feeResult.blockers, ["dispute_platform_fee_mismatch"]);

  const grossResult = prepareDisputePayout({
    ...disputeInput(valid), originalGrossAgreedAmount: parseUsdtAmount("8000"),
  });
  assertEquals(grossResult.ready, false);
  if (!grossResult.ready) assertEquals(grossResult.blockers.includes("deposit_amount_differs_from_agreement"), true);

  const depositResult = prepareDisputePayout({
    ...disputeInput(valid), depositedAmount: parseUsdtAmount("9999"),
  });
  assertEquals(depositResult.ready, false);
  if (!depositResult.ready) assertEquals(depositResult.blockers.includes("deposit_amount_differs_from_agreement"), true);
});

Deno.test("dispute payout waits for final decision and verified agreement/deposit", () => {
  const pending = openDispute("pending", "buyer", 100, 1_000);
  const pendingResult = prepareDisputePayout({
    agreementApproved: true, depositVerified: true, depositedAmount: gross,
    originalGrossAgreedAmount: gross, dealId: "deal-10000", dealSafeAddress: recipients.buyer, dispute: pending, disputeRequest: submitDisputeRequest("pending", "deal-10000", "buyer", "Awaiting admin", 100, initialEvidence), recipients,
  });
  assertEquals(pendingResult.ready, false);
  if (!pendingResult.ready) assertEquals(pendingResult.blockers.includes("dispute_decision_not_finalized"), true);

  const decided = resolvedDispute("missing-gates", {
    buyerGrossRefund: gross, sellerPayout: 0n, platformFee: fee,
  });
  const gateResult = prepareDisputePayout({
    agreementApproved: false, depositVerified: false, depositedAmount: gross,
    originalGrossAgreedAmount: gross, dealId: "deal-10000", dealSafeAddress: recipients.buyer, dispute: decided, disputeRequest: approvedLockConfirmedRequest(decided.id), recipients,
  });
  assertEquals(gateResult.ready, false);
  if (!gateResult.ready) assertEquals(gateResult.blockers.includes("agreement_not_approved"), true);
});
