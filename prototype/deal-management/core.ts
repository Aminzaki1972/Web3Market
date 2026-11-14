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

export function calculateOrdinaryPayout(grossUsdt: bigint) {
  if (grossUsdt <= 0n) throw new Error("Gross amount must be positive");
  const platformFee = grossUsdt * BigInt(PLATFORM_FEE_BPS) / BigInt(BPS_DENOMINATOR);
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
      e.tokenAddress.toLowerCase() !== e.expectedTokenAddress.toLowerCase()) return { ok: false, reason: "wrong_token" };
  if (!/^0x[0-9a-fA-F]{40}$/.test(e.expectedSafeAddress) ||
      e.safeAddress.toLowerCase() !== e.expectedSafeAddress.toLowerCase() ||
      e.transferLogTo.toLowerCase() !== e.expectedSafeAddress.toLowerCase()) return { ok: false, reason: "wrong_safe_recipient" };
  if (e.amount !== e.expectedAmount || e.expectedAmount <= 0n) return { ok: false, reason: "amount_mismatch" };
  if (!/^0x[0-9a-fA-F]{64}$/.test(e.txHash)) return { ok: false, reason: "invalid_tx_hash" };
  if (e.alreadyUsedTxHash) return { ok: false, reason: "duplicate_tx_hash" };
  if (e.receiptStatus !== "success") return { ok: false, reason: "transaction_not_successful" };
  if (!Number.isInteger(e.confirmations) || e.confirmations < e.requiredConfirmations || e.requiredConfirmations < 1) {
    return { ok: false, reason: "insufficient_confirmations" };
  }
  return { ok: true };
}

export function canAdvance(stage: DealStage, next: DealStage, flags: {
  finalAgreementApproved: boolean; depositConfirmed: boolean; assetsTransferred: boolean;
  aiVerificationComplete: boolean; buyerAccepted: boolean; disputeOpen: boolean;
  safeExecutionConfirmed: boolean;
}): boolean {
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
  if (next === "awaiting_deposit" && !flags.finalAgreementApproved) return false;
  if (next === "funded" && !flags.depositConfirmed) return false;
  if (next === "ai_verification" && !flags.assetsTransferred) return false;
  if (next === "buyer_review" && !flags.aiVerificationComplete) return false;
  if (next === "payout_ready" && !flags.buyerAccepted && !stage.startsWith("dispute")) return false;
  if (next === "completed" && !flags.safeExecutionConfirmed) return false;
  return true;
}

/** Dispute allocations are explicit agreed outcomes; no automatic commission is inferred. */
export function validateDisputeAllocation(total: bigint, allocations: { buyerRefund: bigint; sellerPayout: bigint; platformFee: bigint }) {
  if (total <= 0n || allocations.buyerRefund < 0n || allocations.sellerPayout < 0n || allocations.platformFee < 0n) return false;
  return allocations.buyerRefund + allocations.sellerPayout + allocations.platformFee === total;
}
