/**
 * Payout readiness gates for the isolated Web3Market sandbox.
 * Produces a reviewable allocation only; never builds, signs or submits Safe transactions.
 */
import { calculateOrdinaryPayout, validateDisputeAllocation } from "./core.ts";
import type { DisputeCase } from "./disputes.ts";
import type { DisputeRequest } from "./dispute-intake.ts";

export type PayoutRecipientSet = {
  buyer: string;
  seller: string;
  platform: string;
};

export type PayoutAgreementEvidence = {
  version: number;
  hash: string;
  grossAmount: bigint;
  approvals: Record<"buyer" | "seller" | "platform", { approved: boolean; version: number; hash: string }>;
  requiredAssets: Array<{
    id: string;
    evidenceStatus: "verified" | "pending" | "rejected";
    evidenceCheckedAt: number | null;
    buyerStatus: "accepted" | "pending" | "rejected";
    buyerReviewedAt: number | null;
  }>;
  buyerFinalAcceptance: null | {
    accepted: boolean; version: number; hash: string; acceptedAssetIds: string[]; acceptedAt: number;
  };
};

export type PayoutReadinessInput = {
  agreementSnapshot: PayoutAgreementEvidence;
  depositVerified: boolean;
  depositedAmount: bigint;
  /** Must come from the immutable, finally approved agreement snapshot. */
  originalGrossAgreedAmount: bigint;
  openDispute: boolean;
  /** True if this deal has ever entered dispute; such deals must use the decision allocation path. */
  disputeEverOpened: boolean;
  /** Administrative intake state; a pending/declined/approved dispute request cannot use ordinary payout. */
  disputeRequest: DisputeRequest | null;
};

export type PayoutBlocker =
  | "agreement_not_approved"
  | "agreement_snapshot_mismatch"
  | "deposit_not_verified"
  | "invalid_deposit_amount"
  | "invalid_original_agreed_amount"
  | "deposit_amount_differs_from_agreement"
  | "required_assets_not_verified"
  | "buyer_final_acceptance_missing"
  | "dispute_open"
  | "dispute_requires_decision_payout"
  | "administrative_review_hold";

export type PayoutPlan = {
  status: "ready_for_safe_review";
  mode: "ordinary" | "dispute_decision";
  total: bigint;
  buyerRefund: bigint;
  sellerPayout: bigint;
  platformFee: bigint;
  recipients: PayoutRecipientSet;
  note: string;
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const AGREEMENT_HASH = /^0x[0-9a-f]{64}$/;

function hasCurrentAgreementApprovals(snapshot: PayoutAgreementEvidence, gross: bigint): boolean {
  if (!Number.isSafeInteger(snapshot.version) || snapshot.version <= 0 || !AGREEMENT_HASH.test(snapshot.hash) || snapshot.grossAmount !== gross || gross <= 0n) return false;
  return (["buyer", "seller", "platform"] as const).every(role => {
    const approval = snapshot.approvals?.[role];
    return approval?.approved === true && approval.version === snapshot.version && approval.hash === snapshot.hash;
  });
}

function hasAllRequiredAssetsVerified(snapshot: PayoutAgreementEvidence): boolean {
  const assets = snapshot.requiredAssets;
  return Array.isArray(assets) && assets.length > 0 &&
    assets.every(asset => !!asset.id.trim() && asset.evidenceStatus === "verified" &&
      asset.evidenceCheckedAt !== null && Number.isFinite(asset.evidenceCheckedAt)) &&
    new Set(assets.map(asset => asset.id)).size === assets.length;
}

function hasCurrentBuyerFinalAcceptance(snapshot: PayoutAgreementEvidence): boolean {
  const acceptance = snapshot.buyerFinalAcceptance;
  const assets = snapshot.requiredAssets;
  if (!acceptance || acceptance.accepted !== true || acceptance.version !== snapshot.version ||
      acceptance.hash !== snapshot.hash || !Number.isFinite(acceptance.acceptedAt) ||
      !Array.isArray(acceptance.acceptedAssetIds) ||
      !Array.isArray(assets) || assets.length === 0 ||
      assets.some(asset => asset.buyerStatus !== "accepted" || !Number.isFinite(asset.buyerReviewedAt) ||
        asset.evidenceStatus !== "verified" || !Number.isFinite(asset.evidenceCheckedAt))) return false;
  const requiredIds = assets.map(asset => asset.id).sort();
  const acceptedIds = [...acceptance.acceptedAssetIds].sort();
  return new Set(requiredIds).size === requiredIds.length &&
    new Set(acceptedIds).size === acceptedIds.length &&
    requiredIds.length === acceptedIds.length && requiredIds.every((id, index) => id === acceptedIds[index]);
}

function validateRecipients(recipients: PayoutRecipientSet, amounts: {
  buyerRefund: bigint; sellerPayout: bigint; platformFee: bigint;
}): string[] {
  const blockers: string[] = [];
  const entries = [
    ["buyer", recipients.buyer, amounts.buyerRefund],
    ["seller", recipients.seller, amounts.sellerPayout],
    ["platform", recipients.platform, amounts.platformFee],
  ] as const;
  for (const [role, address, amount] of entries) {
    if (amount > 0n && !ADDRESS.test(address)) blockers.push(`invalid_${role}_recipient`);
  }
  const active = entries.filter(([, , amount]) => amount > 0n).map(([, address]) => address.toLowerCase());
  if (new Set(active).size !== active.length) blockers.push("duplicate_active_recipient_addresses");
  return blockers;
}

/** Ordinary release requires all contract and delivery gates; fee split is 92.5/7.5. */
export function prepareOrdinaryPayout(
  input: PayoutReadinessInput, recipients: PayoutRecipientSet,
): { ready: true; plan: PayoutPlan } | { ready: false; blockers: string[] } {
  const blockers: string[] = [];
  if (!hasCurrentAgreementApprovals(input.agreementSnapshot, input.originalGrossAgreedAmount)) blockers.push("agreement_not_approved");
  if (input.agreementSnapshot.grossAmount !== input.originalGrossAgreedAmount) blockers.push("agreement_snapshot_mismatch");
  if (!input.depositVerified) blockers.push("deposit_not_verified");
  if (input.depositedAmount <= 0n) blockers.push("invalid_deposit_amount");
  if (input.originalGrossAgreedAmount <= 0n) blockers.push("invalid_original_agreed_amount");
  if (input.depositedAmount !== input.originalGrossAgreedAmount) blockers.push("deposit_amount_differs_from_agreement");
  if (!hasAllRequiredAssetsVerified(input.agreementSnapshot)) blockers.push("required_assets_not_verified");
  if (!hasCurrentBuyerFinalAcceptance(input.agreementSnapshot)) blockers.push("buyer_final_acceptance_missing");
  if (input.openDispute) blockers.push("dispute_open");
  if (input.disputeRequest && input.disputeRequest.status !== "administrative_hold_released") {
    blockers.push(input.disputeRequest.status === "pending_admin_review" || input.disputeRequest.status === "declined_hold"
      ? "administrative_review_hold" : "dispute_requires_decision_payout");
  }
  if (input.disputeRequest?.status === "administrative_hold_released") {
    const review = input.disputeRequest.review;
    const release = input.disputeRequest.holdRelease;
    if (input.disputeRequest.payoutHold !== false || review?.outcome !== "declined" ||
        !review.reviewerId.trim() || !Number.isFinite(review.reviewedAt) ||
        !release || !release.reason.trim() || !release.reviewerId.trim() ||
        !Number.isFinite(release.releasedAt) || release.releasedAt < review.reviewedAt) {
      blockers.push("administrative_hold_release_inconsistent");
    }
  }
  if (input.disputeEverOpened) blockers.push("dispute_requires_decision_payout");
  if (blockers.length) return { ready: false, blockers };

  const split = calculateOrdinaryPayout(input.depositedAmount);
  const allocations = { buyerRefund: 0n, sellerPayout: split.sellerNet, platformFee: split.platformFee };
  const recipientBlockers = validateRecipients(recipients, allocations);
  if (recipientBlockers.length) return { ready: false, blockers: recipientBlockers };

  return {
    ready: true,
    plan: {
      status: "ready_for_safe_review", mode: "ordinary", total: split.gross,
      ...allocations, recipients,
      note: "92.5% seller / 7.5% platform. Requires separate Safe transaction review and authorized signatures.",
    },
  };
}

export type DisputePayoutInput = {
  agreementSnapshot: PayoutAgreementEvidence;
  depositVerified: boolean;
  depositedAmount: bigint;
  /** Must come from the immutable, finally approved agreement snapshot. */
  originalGrossAgreedAmount: bigint;
  dealId: string;
  dealSafeAddress: string;
  dispute: DisputeCase;
  /** Must be approved and have a trusted, canonical lock confirmation before a dispute payout plan is prepared. */
  disputeRequest: DisputeRequest;
  recipients: PayoutRecipientSet;
};

/**
 * Dispute payout recomputes the full 7.5% fee from the immutable gross agreement amount.
 * The decision stores buyerGrossRefund before commission; the buyer receives the net remainder.
 */
export function prepareDisputePayout(
  input: DisputePayoutInput,
): { ready: true; plan: PayoutPlan } | { ready: false; blockers: string[] } {
  const blockers: string[] = [];
  if (!hasCurrentAgreementApprovals(input.agreementSnapshot, input.originalGrossAgreedAmount)) blockers.push("agreement_not_approved");
  if (input.agreementSnapshot.grossAmount !== input.originalGrossAgreedAmount) blockers.push("agreement_snapshot_mismatch");
  if (!input.depositVerified) blockers.push("deposit_not_verified");
  if (input.depositedAmount <= 0n) blockers.push("invalid_deposit_amount");
  if (input.originalGrossAgreedAmount <= 0n) blockers.push("invalid_original_agreed_amount");
  if (input.disputeRequest.id !== input.dispute.id ||
      input.disputeRequest.dealId !== input.dealId ||
      input.disputeRequest.claimant !== input.dispute.claimant ||
      input.dispute.respondent !== (input.dispute.claimant === "buyer" ? "seller" : "buyer")) {
    blockers.push("dispute_request_mismatch");
  }
  const administrativeReview = input.disputeRequest.review;
  if (!administrativeReview || administrativeReview.outcome !== "approved" ||
      !administrativeReview.reason.trim() || !administrativeReview.reviewerId.trim() ||
      !Number.isFinite(administrativeReview.reviewedAt) ||
      input.disputeRequest.payoutHold !== true || input.disputeRequest.holdRelease !== null) {
    blockers.push("dispute_approval_or_hold_inconsistent");
  }
  const lock = input.disputeRequest.lockProof;
  const validAddress = /^0x[0-9a-fA-F]{40}$/;
  const validHash = /^0x[0-9a-fA-F]{64}$/;
  if (input.disputeRequest.status !== "lock_confirmed" || !lock ||
      lock.chainId !== 56 || !validAddress.test(input.dealSafeAddress) ||
      lock.safeAddress.toLowerCase() !== input.dealSafeAddress.toLowerCase() ||
      lock.expectedSafeAddress.toLowerCase() !== input.dealSafeAddress.toLowerCase() ||
      !validHash.test(lock.txHash) || lock.receiptStatus !== "success" ||
      !Number.isInteger(lock.confirmations) || !Number.isInteger(lock.requiredConfirmations) ||
      lock.confirmations < lock.requiredConfirmations || lock.requiredConfirmations <= 0 ||
      !validHash.test(lock.canonicalBlockHash) || lock.lockEventObserved !== true ||
      lock.lockStateVerified !== true) {
    blockers.push("dispute_lock_not_confirmed");
  }
  if (input.depositedAmount !== input.originalGrossAgreedAmount) blockers.push("deposit_amount_differs_from_agreement");
  if (input.dispute.status !== "decided" || !input.dispute.decision ||
      !input.dispute.decision.reason.trim() || !Number.isFinite(input.dispute.decision.decidedAt)) {
    blockers.push("dispute_decision_not_finalized");
  } else {
    const authorization = input.dispute.decision.authorization;
    if (!authorization || !authorization.adminId.trim() ||
        authorization.adminId !== input.disputeRequest.review?.reviewerId ||
        authorization.dealId !== input.dealId ||
        authorization.disputeRequestId !== input.disputeRequest.id) {
      blockers.push("dispute_decision_authorization_missing_or_mismatched");
    }
  }
  if (blockers.length) return { ready: false, blockers };

  const decision = input.dispute.decision!;
  if (decision.originalGrossAgreedAmount !== input.originalGrossAgreedAmount) {
    return { ready: false, blockers: ["decision_gross_amount_mismatch"] };
  }
  const allocation = decision.allocation;
  if (allocation.platformFee !== calculateOrdinaryPayout(input.originalGrossAgreedAmount).platformFee) {
    return { ready: false, blockers: ["dispute_platform_fee_mismatch"] };
  }
  if (allocation.buyerGrossRefund < allocation.platformFee) {
    return { ready: false, blockers: ["buyer_refund_below_full_commission"] };
  }
  if (!validateDisputeAllocation(
    input.depositedAmount, allocation, input.originalGrossAgreedAmount,
  )) {
    return { ready: false, blockers: ["dispute_allocation_does_not_match_deposit"] };
  }

  const netAllocation = {
    buyerRefund: allocation.buyerGrossRefund - allocation.platformFee,
    sellerPayout: allocation.sellerPayout,
    platformFee: allocation.platformFee,
  };
  const recipientBlockers = validateRecipients(input.recipients, netAllocation);
  if (recipientBlockers.length) return { ready: false, blockers: recipientBlockers };

  return {
    ready: true,
    plan: {
      status: "ready_for_safe_review", mode: "dispute_decision", total: input.depositedAmount,
      ...netAllocation, recipients: input.recipients,
      note: "Full 7.5% fee is deducted from the buyer gross refund bucket; only the net buyer refund is transferred. Requires separate Safe review and authorized signatures.",
    },
  };
}
