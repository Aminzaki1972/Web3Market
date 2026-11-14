/**
 * Web3Market Deal Management sandbox domain rules.
 * Pure functions only: no network, database, wallet, signing or chain side effects.
 * Do not import this module into production routes without separate review.
 */
export type DealStage =
  | "negotiation" | "agreement_pending" | "awaiting_deposit" | "funded"
  | "transfer_in_progress" | "ai_verification" | "buyer_review"
  | "dispute_open" | "payout_ready" | "completed" | "cancelled";

export const PLATFORM_FEE_BPS = 750;
export const BPS_DENOMINATOR = 10_000;
export const BSC_MAINNET_CHAIN_ID = 56;

export function parseUsdtAmount(value: string | number): bigint {
  const raw = String(value).trim();
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(raw)) {
    throw new Error("Amount must be a positive USDT value with at most 6 decimals");
  }
  const [whole, fraction = ""] = raw.split(".");
  const units = BigInt(whole) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
  if (units <= 0n) throw new Error("Amount must be greater than zero");
  return units;
}

export function formatUsdt(units: bigint): string {
  if (units < 0n) throw new Error("Amount cannot be negative");
  const whole = units / 1_000_000n;
  const fraction = (units % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? whole.toString() + "." + fraction : whole.toString();
}

/** Integer-only fee calculation. Rounds down to the nearest USDT base unit, matching the ordinary path. */
export function calculatePlatformFee(grossUsdt: bigint): bigint {
  if (grossUsdt <= 0n) throw new Error("Gross amount must be positive");
  return grossUsdt * BigInt(PLATFORM_FEE_BPS) / BigInt(BPS_DENOMINATOR);
}

export function calculateOrdinaryPayout(grossUsdt: bigint) {
  const platformFee = calculatePlatformFee(grossUsdt);
  return { gross: grossUsdt, platformFee, sellerNet: grossUsdt - platformFee };
}

export type DepositEvidence = {
  chainId: number;
  tokenAddress: string;
  expectedTokenAddress: string;
  safeAddress: string;
  expectedSafeAddress: string;
  amount: bigint;
  expectedAmount: bigint;
  txHash: string;
  receiptStatus: "success" | "failed" | "pending";
  confirmations: number;
  requiredConfirmations: number;
  transferLogTo: string;
  alreadyUsedTxHash: boolean;
};

/**
 * Validates normalized evidence supplied by a trusted server-side chain adapter.
 * This function does NOT query the chain and must never accept browser claims as evidence.
 */
export function validateDepositEvidence(e: DepositEvidence): { ok: true } | { ok: false; reason: string } {
  if (e.chainId !== BSC_MAINNET_CHAIN_ID) return { ok: false, reason: "wrong_network" };
  if (!/^0x[0-9a-fA-F]{40}$/.test(e.expectedTokenAddress) ||
      !/^0x[0-9a-fA-F]{40}$/.test(e.tokenAddress) ||
      e.tokenAddress.toLowerCase() !== e.expectedTokenAddress.toLowerCase()) return { ok: false, reason: "wrong_token" };
  if (!/^0x[0-9a-fA-F]{40}$/.test(e.expectedSafeAddress) ||
      !/^0x[0-9a-fA-F]{40}$/.test(e.safeAddress) ||
      !/^0x[0-9a-fA-F]{40}$/.test(e.transferLogTo) ||
      e.safeAddress.toLowerCase() !== e.expectedSafeAddress.toLowerCase() ||
      e.transferLogTo.toLowerCase() !== e.expectedSafeAddress.toLowerCase()) return { ok: false, reason: "wrong_safe_recipient" };
  if (e.amount !== e.expectedAmount || e.expectedAmount <= 0n) return { ok: false, reason: "amount_mismatch" };
  if (!/^0x[0-9a-fA-F]{64}$/.test(e.txHash)) return { ok: false, reason: "invalid_tx_hash" };
  if (e.alreadyUsedTxHash) return { ok: false, reason: "duplicate_tx_hash" };
  if (e.receiptStatus !== "success") return { ok: false, reason: "transaction_not_successful" };
  if (!Number.isInteger(e.confirmations) || !Number.isInteger(e.requiredConfirmations) ||
      e.confirmations < e.requiredConfirmations || e.requiredConfirmations < 1) {
    return { ok: false, reason: "insufficient_confirmations" };
  }
  return { ok: true };
}

export type DealTransitionFlags = {
  finalPriceAccepted: boolean;
  finalAgreementApproved: boolean;
  depositConfirmed: boolean;
  assetsTransferred: boolean;
  aiVerificationComplete: boolean;
  buyerAccepted: boolean;
  disputeOpen: boolean;
  /** Permanent deal history flag; prevents a disputed deal bypassing the decision payout path. */
  disputeEverOpened: boolean;
  disputeDecisionFinalized: boolean;
  safeExecutionConfirmed: boolean;
};

/**
 * A conservative transition guard. It is a domain helper, not an authorization
 * boundary: callers must derive every flag from trusted persisted/chain evidence.
 */
export function canAdvance(stage: DealStage, next: DealStage, flags: DealTransitionFlags): boolean {
  // An unresolved dispute blocks every payout/settlement transition.
  // The dispute is considered resolved only after a final decision is recorded
  // and the caller clears disputeOpen from trusted server-side state.
  if (flags.disputeOpen && next !== "dispute_open") return false;
  const allowed: Partial<Record<DealStage, DealStage[]>> = {
    negotiation: ["agreement_pending", "cancelled"],
    agreement_pending: ["awaiting_deposit", "negotiation", "cancelled"],
    awaiting_deposit: ["funded", "cancelled"],
    funded: ["transfer_in_progress", "dispute_open"],
    transfer_in_progress: ["ai_verification", "dispute_open"],
    ai_verification: ["buyer_review", "transfer_in_progress", "dispute_open"],
    buyer_review: ["payout_ready", "transfer_in_progress", "dispute_open"],
    dispute_open: ["payout_ready"],
    payout_ready: ["completed", "dispute_open"],
  };
  if (!allowed[stage]?.includes(next)) return false;
  if (next === "agreement_pending" && !flags.finalPriceAccepted) return false;
  if (next === "awaiting_deposit" && (!flags.finalPriceAccepted || !flags.finalAgreementApproved)) return false;
  // Cancellation after confirmed funding must use an explicit refund/dispute path,
  // not a database-only state change.
  if (next === "cancelled" && flags.depositConfirmed) return false;
  if (next === "funded" && !flags.depositConfirmed) return false;
  if (next === "transfer_in_progress" && !flags.depositConfirmed) return false;
  if (next === "ai_verification" && !flags.assetsTransferred) return false;
  if (next === "buyer_review" && (!flags.assetsTransferred || !flags.aiVerificationComplete)) return false;
  if (next === "payout_ready") {
    if (flags.disputeOpen) return false;
    if (flags.disputeEverOpened !== false) {
      // Fail closed if dispute history is missing. A disputed deal can only
      // enter payout-ready from the dispute decision path.
      if (flags.disputeEverOpened !== true || stage !== "dispute_open" || !flags.disputeDecisionFinalized) return false;
    } else if (!flags.buyerAccepted) {
      return false;
    }
  }
  if (next === "completed" && (
    !flags.safeExecutionConfirmed || flags.disputeOpen ||
    (flags.disputeEverOpened !== false && (flags.disputeEverOpened !== true || !flags.disputeDecisionFinalized))
  )) return false;
  return true;
}

/**
 * Dispute accounting uses the buyer's gross refund bucket before commission.
 * The fee is carved out of that bucket, so the net buyer transfer is:
 * buyerGrossRefund - platformFee.
 */
export type DisputeAllocationAmounts = {
  buyerGrossRefund: bigint;
  sellerPayout: bigint;
  platformFee: bigint;
};

export function validateDisputeAllocation(
  total: bigint,
  allocation: DisputeAllocationAmounts,
  originalGrossAgreedAmount: bigint,
): boolean {
  if (total <= 0n || originalGrossAgreedAmount <= 0n ||
      allocation.buyerGrossRefund < 0n || allocation.sellerPayout < 0n || allocation.platformFee < 0n) return false;
  const expectedFee = calculatePlatformFee(originalGrossAgreedAmount);
  if (allocation.platformFee !== expectedFee || allocation.buyerGrossRefund < expectedFee) return false;
  return allocation.buyerGrossRefund + allocation.sellerPayout === total &&
    total === originalGrossAgreedAmount;
}
