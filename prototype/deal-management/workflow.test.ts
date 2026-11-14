import { assertEquals } from "jsr:@std/assert@1.0.14";
import { canAdvance, parseUsdtAmount, validateDepositEvidence } from "./core.ts";
import { createDealAsset, recordAssetVerification, submitAssetEvidence } from "./asset-transfer.ts";
import { finalBuyerAcceptance, reviewAsset, startBuyerReview } from "./buyer-review.ts";
import { prepareOrdinaryPayout } from "./payout-readiness.ts";
import {
  applyPriceAction, approveAgreement, createAgreement, isAgreementFullyApproved,
  startNegotiation,
} from "./negotiation.ts";

Deno.test("sandbox happy path: offer -> agreement -> deposit evidence -> transfer -> buyer acceptance -> payout plan", () => {
  const initial = startNegotiation(parseUsdtAmount("10000"), parseUsdtAmount("7000"), "buyer-offer-1");
  const preliminary = applyPriceAction(initial, "seller", {
    type: "preliminary_seller_accept", offerId: "buyer-offer-1",
  });
  assertEquals(preliminary.preliminarySellerAcceptance, true);
  assertEquals(preliminary.finalPriceAccepted, false);

  const countered = applyPriceAction(preliminary, "seller", {
    type: "counter", offerId: "seller-counter-1", amountUsdt: parseUsdtAmount("6800"),
  });
  const priceAccepted = applyPriceAction(countered, "buyer", {
    type: "accept", offerId: "seller-counter-1",
  });
  assertEquals(priceAccepted.finalPriceAccepted, true);

  let agreement = createAgreement(1, "0x" + "a".repeat(64));
  agreement = approveAgreement(agreement, "buyer", 1, agreement.snapshotHash);
  agreement = approveAgreement(agreement, "seller", 1, agreement.snapshotHash);
  agreement = approveAgreement(agreement, "platform", 1, agreement.snapshotHash);
  assertEquals(isAgreementFullyApproved(agreement), true);

  const flags = {
    finalAgreementApproved: true, depositConfirmed: true, assetsTransferred: true,
    aiVerificationComplete: true, buyerAccepted: true, disputeOpen: false,
    disputeDecisionFinalized: false, safeExecutionConfirmed: false,
  };
  assertEquals(canAdvance("agreement_pending", "awaiting_deposit", flags), true);
  assertEquals(canAdvance("funded", "transfer_in_progress", flags), true);

  const safe = "0x2222222222222222222222222222222222222222";
  const token = "0x1111111111111111111111111111111111111111";
  const deposit = validateDepositEvidence({
    chainId: 56, tokenAddress: token, expectedTokenAddress: token,
    safeAddress: safe, expectedSafeAddress: safe, transferLogTo: safe,
    amount: parseUsdtAmount("6800"), expectedAmount: parseUsdtAmount("6800"),
    txHash: "0x" + "b".repeat(64), receiptStatus: "success",
    confirmations: 15, requiredConfirmations: 12, alreadyUsedTxHash: false,
  });
  assertEquals(deposit, { ok: true });

  let asset = createDealAsset("repo-1", "github_repository");
  asset = submitAssetEvidence(asset, {
    id: "evidence-1", kind: "repository_transfer_completed", source: "mock trusted verifier",
    reference: "transfer-123", submittedAt: 100,
  });
  asset = recordAssetVerification(asset, {
    status: "verified", summary: "Transfer evidence meets the sandbox gate",
    source: "mock trusted verifier", checkedAt: 110,
  });

  let review = startBuyerReview([asset], null, 120);
  review = reviewAsset(review, "repo-1", "accept", 130);
  review = finalBuyerAcceptance(review, 140);
  assertEquals(review.finalAcceptedAt, 140);

  const payout = prepareOrdinaryPayout({
    agreementApproved: true, depositVerified: true, depositedAmount: parseUsdtAmount("6800"),
    requiredAssetsVerified: true, buyerFinalAcceptance: true, openDispute: false,
  }, {
    buyer: "0x3333333333333333333333333333333333333333",
    seller: "0x4444444444444444444444444444444444444444",
    platform: "0x5555555555555555555555555555555555555555",
  });
  assertEquals(payout.ready, true);
  if (payout.ready) {
    assertEquals(payout.plan.sellerPayout, parseUsdtAmount("6290"));
    assertEquals(payout.plan.platformFee, parseUsdtAmount("510"));
    assertEquals(payout.plan.status, "ready_for_safe_review");
  }
});
