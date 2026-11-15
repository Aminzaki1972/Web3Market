import { assertEquals } from "jsr:@std/assert@1.0.14";
import { prepareDisputePayout, prepareOrdinaryPayout } from "./payout-readiness.ts";
import { openDispute, submitClaimantEvidence, submitRespondentResponse, issueDisputeDecision } from "./disputes.ts";
import { parseUsdtAmount } from "./core.ts";
import { confirmDisputeLock, releaseDeclinedDisputeHold, reviewDisputeRequest, submitDisputeRequest } from "./dispute-intake.ts";

const recipients = {
  buyer: "0x1111111111111111111111111111111111111111",
  seller: "0x2222222222222222222222222222222222222222",
  platform: "0x3333333333333333333333333333333333333333",
};
const agreementHash = "0x" + "c".repeat(64);
function approvedAgreementSnapshot(grossAmount: bigint, approved = true, accepted = true) {
  return {
    version: 1, hash: agreementHash, grossAmount,
    approvals: {
      buyer: { approved, version: 1, hash: agreementHash },
      seller: { approved, version: 1, hash: agreementHash },
      platform: { approved, version: 1, hash: agreementHash },
    },
    requiredAssets: [
      { id: "repo", evidenceStatus: "verified", buyerStatus: accepted ? "accepted" : "pending" },
      { id: "domain", evidenceStatus: "verified", buyerStatus: accepted ? "accepted" : "pending" },
    ],
    buyerFinalAcceptance: accepted ? { accepted: true, version: 1, hash: agreementHash, acceptedAssetIds: ["repo", "domain"] } : null,
  };
}
const ordinary = {
  agreementSnapshot: approvedAgreementSnapshot(7_000_000_000n),
  depositVerified: true, depositedAmount: 7_000_000_000n,
  originalGrossAgreedAmount: 7_000_000_000n,
  requiredAssetsVerified: true, openDispute: false,
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
  const decided = issueDisputeDecision(dispute, "Administrative decision", allocation, gross, gross, 130);
  return {
    ...decided,
    decision: {
      ...decided.decision!,
      authorization: { adminId: "admin-1", dealId: "deal-10000", disputeRequestId: id },
    },
  };
}

function approvedLockConfirmedRequest(id: string) {
  const submitted = submitDisputeRequest(id, "deal-10000", "buyer", "Evidence reviewed", 100, initialEvidence);
  const approved = reviewDisputeRequest(submitted, "approved", "Formal dispute opened", "admin-1", 110);
  return confirmDisputeLock(approved, {
    chainId: 56, safeAddress: recipients.buyer, expectedSafeAddress: recipients.buyer,
    txHash: "0x" + "a".repeat(64), receiptStatus: "success", confirmations: 15,
    requiredConfirmations: 12, canonicalBlockHash: "0x" + "b".repeat(64),
    lockEventObserved: true, lockStateVerified: true,
  });
}

function disputeInput(dispute: ReturnType<typeof resolvedDispute>) {
  return {
    agreementSnapshot: approvedAgreementSnapshot(gross, true, false),
    depositVerified: true, depositedAmount: gross,
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

Deno.test("ordinary payout requires a genuine recorded release after a declined request", () => {
  const submitted = submitDisputeRequest(
    "ordinary-release", "deal-10000", "buyer", "Request review", 100, initialEvidence,
  );
  const declined = reviewDisputeRequest(
    submitted, "declined", "No qualifying grounds", "admin-1", 110,
  );
  const released = releaseDeclinedDisputeHold(
    declined, "No other active hold remains", "admin-1", 120, false,
  );
  const valid = prepareOrdinaryPayout({ ...ordinary, disputeRequest: released }, recipients);
  assertEquals(valid.ready, true);

  const forgedRelease = {
    ...released, payoutHold: true, holdRelease: null,
  };
  const invalid = prepareOrdinaryPayout({ ...ordinary, disputeRequest: forgedRelease }, recipients);
  assertEquals(invalid.ready, false);
  if (!invalid.ready) assertEquals(
    invalid.blockers.includes("administrative_hold_release_inconsistent"), true,
  );

  const approvedButRelabelled = {
    ...released,
    review: { ...released.review!, outcome: "approved" as const },
  };
  const invalidApproval = prepareOrdinaryPayout({
    ...ordinary, disputeRequest: approvedButRelabelled,
  }, recipients);
  assertEquals(invalidApproval.ready, false);
  if (!invalidApproval.ready) assertEquals(
    invalidApproval.blockers.includes("administrative_hold_release_inconsistent"), true,
  );
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

Deno.test("ordinary payout rejects a deposit that differs from the approved gross agreement amount", () => {
  const mismatch = prepareOrdinaryPayout({
    ...ordinary, originalGrossAgreedAmount: 6_999_000_000n,
  }, recipients);
  assertEquals(mismatch.ready, false);
  if (!mismatch.ready) assertEquals(mismatch.blockers.includes("deposit_amount_differs_from_agreement"), true);

  const missingGross = prepareOrdinaryPayout({
    ...ordinary, originalGrossAgreedAmount: 0n,
  }, recipients);
  assertEquals(missingGross.ready, false);
  if (!missingGross.ready) assertEquals(missingGross.blockers.includes("invalid_original_agreed_amount"), true);
});

Deno.test("ordinary payout is blocked by every missing gate", () => {
  const result = prepareOrdinaryPayout({
    ...ordinary, agreementSnapshot: approvedAgreementSnapshot(ordinary.originalGrossAgreedAmount, false, false), depositVerified: false,
    agreementSnapshot: {...approvedAgreementSnapshot(ordinary.originalGrossAgreedAmount, false, false), requiredAssets:[{id:"repo",evidenceStatus:"pending",buyerStatus:"pending"}]}, openDispute: true,
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

Deno.test("dispute payout rejects contradictory approval, hold and claimant records", () => {
  const valid = resolvedDispute("consistent", {
    buyerGrossRefund: gross, sellerPayout: 0n, platformFee: fee,
  });
  const validInput = disputeInput(valid);
  const approvedRequest = validInput.disputeRequest;

  const declinedButForgedLocked = {
    ...approvedRequest,
    review: { ...approvedRequest.review!, outcome: "declined" as const },
  };
  const declinedResult = prepareDisputePayout({
    ...validInput, disputeRequest: declinedButForgedLocked,
  });
  assertEquals(declinedResult.ready, false);
  if (!declinedResult.ready) assertEquals(
    declinedResult.blockers.includes("dispute_approval_or_hold_inconsistent"), true,
  );

  const releasedHold = { ...approvedRequest, payoutHold: false };
  const releasedResult = prepareDisputePayout({
    ...validInput, disputeRequest: releasedHold,
  });
  assertEquals(releasedResult.ready, false);
  if (!releasedResult.ready) assertEquals(
    releasedResult.blockers.includes("dispute_approval_or_hold_inconsistent"), true,
  );

  const wrongClaimant = { ...approvedRequest, claimant: "seller" as const };
  const claimantResult = prepareDisputePayout({
    ...validInput, disputeRequest: wrongClaimant,
  });
  assertEquals(claimantResult.ready, false);
  if (!claimantResult.ready) assertEquals(
    claimantResult.blockers.includes("dispute_request_mismatch"), true,
  );
});

Deno.test("dispute payout rejects non-integer or non-finite lock confirmation counts", () => {
  const dispute = resolvedDispute("lock-counts", {
    buyerGrossRefund: gross, sellerPayout: 0n, platformFee: fee,
  });
  const input = disputeInput(dispute);
  for (const malformed of [
    { confirmations: Number.NaN },
    { confirmations: Number.POSITIVE_INFINITY },
    { confirmations: 12.5 },
    { requiredConfirmations: Number.NaN },
    { requiredConfirmations: Number.POSITIVE_INFINITY },
    { requiredConfirmations: 12.5 },
  ]) {
    const badRequest = {
      ...input.disputeRequest,
      lockProof: { ...input.disputeRequest.lockProof!, ...malformed },
    };
    const result = prepareDisputePayout({ ...input, disputeRequest: badRequest });
    assertEquals(result.ready, false);
    if (!result.ready) assertEquals(
      result.blockers.includes("dispute_lock_not_confirmed"), true,
    );
  }
});

Deno.test("dispute payout waits for final decision and verified agreement/deposit", () => {
  const pending = openDispute("pending", "buyer", 100, 1_000);
  const pendingResult = prepareDisputePayout({
    agreementSnapshot: approvedAgreementSnapshot(gross, true, false), depositVerified: true, depositedAmount: gross,
    originalGrossAgreedAmount: gross, dealId: "deal-10000", dealSafeAddress: recipients.buyer, dispute: pending, disputeRequest: submitDisputeRequest("pending", "deal-10000", "buyer", "Awaiting admin", 100, initialEvidence), recipients,
  });
  assertEquals(pendingResult.ready, false);
  if (!pendingResult.ready) assertEquals(pendingResult.blockers.includes("dispute_decision_not_finalized"), true);

  const decided = resolvedDispute("missing-gates", {
    buyerGrossRefund: gross, sellerPayout: 0n, platformFee: fee,
  });
  const gateResult = prepareDisputePayout({
    agreementSnapshot: approvedAgreementSnapshot(gross, false, false), depositVerified: false, depositedAmount: gross,
    originalGrossAgreedAmount: gross, dealId: "deal-10000", dealSafeAddress: recipients.buyer, dispute: decided, disputeRequest: approvedLockConfirmedRequest(decided.id), recipients,
  });
  assertEquals(gateResult.ready, false);
  if (!gateResult.ready) assertEquals(gateResult.blockers.includes("agreement_not_approved"), true);
});


Deno.test("dispute payout rejects a decision without matching single-admin workflow authorization metadata", () => {
  const valid = resolvedDispute("decision-auth", {
    buyerGrossRefund: gross, sellerPayout: 0n, platformFee: fee,
  });
  const input = disputeInput(valid);
  const missing = {
    ...valid,
    decision: { ...valid.decision!, authorization: null },
  };
  const missingResult = prepareDisputePayout({ ...input, dispute: missing });
  assertEquals(missingResult.ready, false);
  if (!missingResult.ready) assertEquals(missingResult.blockers.includes("dispute_decision_authorization_missing_or_mismatched"), true);
  const wrongDeal = {
    ...valid,
    decision: { ...valid.decision!, authorization: { adminId: "admin-1", dealId: "deal-other", disputeRequestId: valid.id } },
  };
  const wrongDealResult = prepareDisputePayout({ ...input, dispute: wrongDeal });
  assertEquals(wrongDealResult.ready, false);
  if (!wrongDealResult.ready) assertEquals(wrongDealResult.blockers.includes("dispute_decision_authorization_missing_or_mismatched"), true);
  const wrongRequest = {
    ...valid,
    decision: { ...valid.decision!, authorization: { adminId: "admin-1", dealId: "deal-10000", disputeRequestId: "another-request" } },
  };
  const wrongRequestResult = prepareDisputePayout({ ...input, dispute: wrongRequest });
  assertEquals(wrongRequestResult.ready, false);
  if (!wrongRequestResult.ready) assertEquals(wrongRequestResult.blockers.includes("dispute_decision_authorization_missing_or_mismatched"), true);
});


Deno.test("ordinary payout rejects non-finite review timestamps in a declined-hold release", () => {
  const submitted = submitDisputeRequest("ordinary-bad-review-time", "deal-10000", "buyer", "Request review", 100, initialEvidence);
  const declined = reviewDisputeRequest(submitted, "declined", "No qualifying grounds", "admin-1", 110);
  const released = releaseDeclinedDisputeHold(declined, "No other active hold", "admin-1", 120, false);
  const badReview = {...released, review:{...released.review!, reviewedAt:Number.NaN}};
  const result = prepareOrdinaryPayout({...ordinary, disputeRequest:badReview}, recipients);
  assertEquals(result.ready, false);
  if (!result.ready) assertEquals(result.blockers.includes("administrative_hold_release_inconsistent"), true);
});

Deno.test("dispute payout rejects a released hold or a decision by a different admin", () => {
  const dispute = resolvedDispute("hold-auth", {
    buyerGrossRefund: gross, sellerPayout: 0n, platformFee: fee,
  });
  const input = disputeInput(dispute);
  const released = {...input.disputeRequest, holdRelease:{reason:"forged",reviewerId:"admin-1",releasedAt:140}};
  const releasedResult = prepareDisputePayout({...input, disputeRequest:released});
  assertEquals(releasedResult.ready, false);
  if (!releasedResult.ready) assertEquals(releasedResult.blockers.includes("dispute_approval_or_hold_inconsistent"), true);
  const wrongAdmin = {...dispute, decision:{...dispute.decision!,authorization:{...dispute.decision!.authorization!,adminId:"admin-2"}}};
  const adminResult = prepareDisputePayout({...input, dispute:wrongAdmin});
  assertEquals(adminResult.ready, false);
  if (!adminResult.ready) assertEquals(adminResult.blockers.includes("dispute_decision_authorization_missing_or_mismatched"), true);
});


Deno.test("ordinary payout binds approvals and final acceptance to current agreement version and hash", () => {
  assertEquals(prepareOrdinaryPayout(ordinary, recipients).ready, true);
  const staleBuyer = {...ordinary, agreementSnapshot:{...ordinary.agreementSnapshot,approvals:{...ordinary.agreementSnapshot.approvals,buyer:{approved:true,version:0,hash:agreementHash}}}};
  const staleSeller = {...ordinary, agreementSnapshot:{...ordinary.agreementSnapshot,approvals:{...ordinary.agreementSnapshot.approvals,seller:{approved:true,version:1,hash:"0x"+"d".repeat(64)}}}};
  const staleAcceptance = {...ordinary, agreementSnapshot:{...ordinary.agreementSnapshot,buyerFinalAcceptance:{accepted:true,version:0,hash:agreementHash,acceptedAssetIds:["repo","domain"]}}};
  for (const invalid of [staleBuyer,staleSeller]) {
    const result = prepareOrdinaryPayout(invalid, recipients);
    assertEquals(result.ready, false);
    if (!result.ready) assertEquals(result.blockers.includes("agreement_not_approved"), true);
  }
  const acceptanceResult = prepareOrdinaryPayout(staleAcceptance, recipients);
  assertEquals(acceptanceResult.ready, false);
  if (!acceptanceResult.ready) assertEquals(acceptanceResult.blockers.includes("buyer_final_acceptance_missing"), true);
});


Deno.test("ordinary payout requires every required asset verified and individually accepted", () => {
  const unverified = {...ordinary, agreementSnapshot:{...ordinary.agreementSnapshot,requiredAssets:[...ordinary.agreementSnapshot.requiredAssets,{id:"domain",evidenceStatus:"pending" as const,buyerStatus:"accepted" as const}]}};
  const evidenceResult = prepareOrdinaryPayout(unverified, recipients);
  assertEquals(evidenceResult.ready, false);
  if (!evidenceResult.ready) assertEquals(evidenceResult.blockers.includes("required_assets_not_verified"), true);
  const pendingAsset = {...ordinary, agreementSnapshot:{...ordinary.agreementSnapshot,requiredAssets:ordinary.agreementSnapshot.requiredAssets.map(a=>a.id==="domain"?{...a,buyerStatus:"pending" as const}:a)}};
  const pendingResult = prepareOrdinaryPayout(pendingAsset, recipients);
  assertEquals(pendingResult.ready, false);
  if (!pendingResult.ready) assertEquals(pendingResult.blockers.includes("buyer_final_acceptance_missing"), true);
  const incompleteIds = {...ordinary, agreementSnapshot:{...ordinary.agreementSnapshot,buyerFinalAcceptance:{...ordinary.agreementSnapshot.buyerFinalAcceptance!,acceptedAssetIds:["repo"]}}};
  const idsResult = prepareOrdinaryPayout(incompleteIds, recipients);
  assertEquals(idsResult.ready, false);
  if (!idsResult.ready) assertEquals(idsResult.blockers.includes("buyer_final_acceptance_missing"), true);
});
