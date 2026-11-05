// W3M Protocol V1 — one fail-closed decision for Safe release execution.
// This is pure domain composition: callers must load every input server-side,
// re-read it immediately before execution, and independently recompute the Safe
// EIP-712 transaction hash from the live Safe contract. This module never sends.
import {
  evaluateSettlementGate,
  type SettlementGateInput,
  type SettlementGateDecision,
} from "./settlement-gate.ts";
import {
  validateSafeSignatureSet,
  type SafeSignatureSetInput,
  type SafeDigestSignatureVerifier,
} from "./safe-signature-set-validator.ts";
import {
  validateStoredSafeReleaseTransaction,
  type SafeReleasePolicySnapshot,
  type SafeReleaseTransactionRow,
  type SafeReleaseTransactionValidation,
} from "./safe-release-transaction-adapter.ts";

export interface SafeExecutionGuardInput {
  settlement: SettlementGateInput;
  transaction: SafeReleaseTransactionRow;
  releasePolicy: SafeReleasePolicySnapshot;
  storedSafeTransactionHash: string;
  recomputedSafeTransactionHash: string;
  signatures: SafeSignatureSetInput;
}
export interface SafeExecutionGuardDecision {
  authorized: boolean;
  settlement: SettlementGateDecision;
  payload: SafeReleaseTransactionValidation;
  signaturesValid: boolean;
  signatureCount: number;
  issues: string[];
}

const HASH = /^0x[0-9a-fA-F]{64}$/;

export async function evaluateSafeExecutionGuard(
  input: SafeExecutionGuardInput,
  verifySignature?: SafeDigestSignatureVerifier,
): Promise<SafeExecutionGuardDecision> {
  const settlement = evaluateSettlementGate(input.settlement);
  const payload = validateStoredSafeReleaseTransaction(input.transaction, input.releasePolicy);
  const issues: string[] = [];

  if (input.settlement.stage !== "EXECUTE") issues.push("EXECUTION_STAGE_REQUIRED");
  if (!HASH.test(input.storedSafeTransactionHash || "") ||
      !HASH.test(input.recomputedSafeTransactionHash || "")) {
    issues.push("SAFE_TRANSACTION_HASH_INVALID");
  } else if (input.storedSafeTransactionHash.toLowerCase() !==
      input.recomputedSafeTransactionHash.toLowerCase()) {
    issues.push("SAFE_TRANSACTION_HASH_MISMATCH");
  }
  if (input.signatures.safeTransactionHash.toLowerCase() !==
      input.storedSafeTransactionHash.toLowerCase()) {
    issues.push("SIGNATURES_NOT_BOUND_TO_STORED_SAFE_HASH");
  }
  if (!settlement.authorized) issues.push("SETTLEMENT_GATE_BLOCKED");
  if (!payload.valid) issues.push("SAFE_RELEASE_PAYLOAD_BLOCKED");

  const signatureDecision = await validateSafeSignatureSet(
    input.signatures,
    verifySignature,
  );
  if (!signatureDecision.valid) issues.push("SAFE_SIGNATURE_SET_BLOCKED");

  return {
    authorized: issues.length === 0,
    settlement,
    payload,
    signaturesValid: signatureDecision.valid,
    signatureCount: signatureDecision.validSignatures,
    issues: [...new Set(issues)],
  };
}
