// W3M Protocol V1 — fail-closed receipt verification boundary for finalization.
// The injected verifier must independently fetch BNB receipt/logs and verify the
// Safe ExecutionSuccess/ExecutionFailure events. This module validates its
// normalized attestation against the locked attempt/policy before invoking RPC.
import { finalizeSafeExecutionAttempt, type W3MRpcClient } from "./supabase-rpc-adapter.ts";

export interface SafeReceiptTransfer {
  from_address: string;
  to_address: string;
  amount: string;
}
export interface VerifiedSafeReceiptEvidence {
  chain_id: number;
  transaction_hash: string;
  receipt_status: number;
  execution_success: boolean;
  execution_failure: boolean;
  safe_address: string;
  safe_tx_hash: string;
  token_contract: string;
  transfers: SafeReceiptTransfer[];
}
export interface SafeFinalizationExpectation {
  attemptId: string;
  broadcastTxHash: string;
  actorId: string;
  safeTxHash: string;
  safeAddress: string;
  tokenContract: string;
  sellerWallet: string;
  sellerAmount: string;
  platformWallet: string;
  platformFee: string;
}
export type FreshReceiptVerifier = () => Promise<VerifiedSafeReceiptEvidence>;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^(0|[1-9]\d*)(?:\.(\d+))?$/;

function sameAddress(a: unknown, b: unknown): boolean {
  return typeof a === "string" && typeof b === "string" &&
    ADDRESS.test(a) && ADDRESS.test(b) && a.toLowerCase() === b.toLowerCase();
}
function normalizeDecimal(value: unknown): string | null {
  if (typeof value !== "string" || !DECIMAL.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? whole + "." + normalizedFraction : whole;
}

export function validateVerifiedSafeReceipt(
  expected: SafeFinalizationExpectation,
  evidence: VerifiedSafeReceiptEvidence,
): { valid: true } | { valid: false; issues: string[] } {
  const issues: string[] = [];
  if (!HASH.test(expected.broadcastTxHash) || !HASH.test(expected.safeTxHash)) issues.push("EXPECTED_HASH_INVALID");
  if (evidence.chain_id !== 56) issues.push("RECEIPT_CHAIN_MISMATCH");
  if (typeof evidence.transaction_hash !== "string" ||
      evidence.transaction_hash.toLowerCase() !== expected.broadcastTxHash.toLowerCase()) issues.push("BROADCAST_HASH_MISMATCH");
  if (evidence.receipt_status !== 1) issues.push("RECEIPT_NOT_SUCCESSFUL");
  if (evidence.execution_success !== true || evidence.execution_failure !== false) issues.push("SAFE_EXECUTION_EVENT_INVALID");
  if (!sameAddress(evidence.safe_address, expected.safeAddress)) issues.push("SAFE_ADDRESS_MISMATCH");
  if (typeof evidence.safe_tx_hash !== "string" ||
      evidence.safe_tx_hash.toLowerCase() !== expected.safeTxHash.toLowerCase()) issues.push("SAFE_TX_HASH_MISMATCH");
  if (!sameAddress(evidence.token_contract, expected.tokenContract)) issues.push("TOKEN_CONTRACT_MISMATCH");
  if (!sameAddress(expected.sellerWallet, expected.platformWallet)) {
    if (!Array.isArray(evidence.transfers) || evidence.transfers.length !== 2) {
      issues.push("EXACTLY_TWO_TRANSFERS_REQUIRED");
    } else {
      const transfers = evidence.transfers;
      const seller = transfers.filter((t) =>
        sameAddress(t?.from_address, expected.safeAddress) &&
        sameAddress(t?.to_address, expected.sellerWallet) &&
        normalizeDecimal(t?.amount) === normalizeDecimal(expected.sellerAmount)
      );
      const platform = transfers.filter((t) =>
        sameAddress(t?.from_address, expected.safeAddress) &&
        sameAddress(t?.to_address, expected.platformWallet) &&
        normalizeDecimal(t?.amount) === normalizeDecimal(expected.platformFee)
      );
      if (seller.length !== 1) issues.push("SELLER_TRANSFER_MISMATCH");
      if (platform.length !== 1) issues.push("PLATFORM_FEE_TRANSFER_MISMATCH");
    }
  } else {
    issues.push("RECIPIENTS_MUST_BE_DISTINCT");
  }
  return issues.length === 0 ? { valid: true } : { valid: false, issues };
}

export async function finalizeOnlyAfterVerifiedSafeReceipt(
  client: W3MRpcClient,
  expected: SafeFinalizationExpectation,
  verifyReceiptFresh: FreshReceiptVerifier,
) {
  let evidence: VerifiedSafeReceiptEvidence;
  try {
    evidence = await verifyReceiptFresh();
  } catch {
    throw new Error("W3M receipt verification unavailable; finalization blocked.");
  }
  const validation = validateVerifiedSafeReceipt(expected, evidence);
  if (!validation.valid) {
    throw new Error("W3M receipt verification failed: " + validation.issues.join(","));
  }
  return await finalizeSafeExecutionAttempt(client, {
    attemptId: expected.attemptId,
    broadcastTxHash: expected.broadcastTxHash,
    actorId: expected.actorId,
    receiptEvidence: evidence as unknown as Record<string, unknown>,
  });
}
