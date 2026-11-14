/**
 * Payout readiness gates for the isolated Web3Market sandbox.
 * Produces a reviewable allocation only; never builds, signs or submits Safe transactions.
 */
import { calculateOrdinaryPayout, validateDisputeAllocation } from "./core.ts";
import type { DisputeCase } from "./disputes.ts";

export type PayoutRecipientSet = {
  buyer: string;
  seller: string;
  platform: string;
};

export type PayoutReadinessInput = {
  agreementApproved: boolean;
  depositVerified: boolean;
  depositedAmount: bigint;
  requiredAssetsVerified: boolean;
  buyerFinalAcceptance: boolean;
  openDispute: boolean;
};

export type PayoutBlocker =
  | "agreement_not_approved"
  | "deposit_not_verified"
  | "invalid_deposit_amount"
  | "required_assets_not_verified"
  | "buyer_final_acceptance_missing"
  | "dispute_open";

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
  if (!input.agreementApproved) blockers.push("agreement_not_approved");
  if (!input.depositVerified) blockers.push("deposit_not_verified");
  if (input.depositedAmount <= 0n) blockers.push("invalid_deposit_amount");
  if (!input.requiredAssetsVerified) blockers.push("required_assets_not_verified");
  if (!input.buyerFinalAcceptance) blockers.push("buyer_final_acceptance_missing");
  if (input.openDispute) blockers.push("dispute_open");
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

/**
 * Dispute payout requires an issued platform decision and explicit agreement-consistent allocation.
 * Platform fee is never inferred or recalculated here; it must be stated in the decision.
 */
export function prepareDisputePayout(
  agreementApproved: boolean,
  depositVerified: boolean,
  depositedAmount: bigint,
  dispute: DisputeCase,
  recipients: PayoutRecipientSet,
): { ready: true; plan: PayoutPlan } | { ready: false; blockers: string[] } {
  const blockers: string[] = [];
  if (!agreementApproved) blockers.push("agreement_not_approved");
  if (!depositVerified) blockers.push("deposit_not_verified");
  if (depositedAmount <= 0n) blockers.push("invalid_deposit_amount");
  if (dispute.status !== "decided" || !dispute.decision ||
      !dispute.decision.reason.trim() || !Number.isFinite(dispute.decision.decidedAt)) {
    blockers.push("dispute_decision_not_finalized");
  }
  if (blockers.length) return { ready: false, blockers };

  const allocation = dispute.decision!.allocation;
  if (!validateDisputeAllocation(depositedAmount, allocation)) {
    return { ready: false, blockers: ["dispute_allocation_does_not_match_deposit"] };
  }
  const recipientBlockers = validateRecipients(recipients, allocation);
  if (recipientBlockers.length) return { ready: false, blockers: recipientBlockers };

  return {
    ready: true,
    plan: {
      status: "ready_for_safe_review", mode: "dispute_decision", total: depositedAmount,
      ...allocation, recipients,
      note: "Uses the explicit dispute decision allocation; no automatic commission rule is applied. Requires separate Safe review and authorized signatures.",
    },
  };
}
