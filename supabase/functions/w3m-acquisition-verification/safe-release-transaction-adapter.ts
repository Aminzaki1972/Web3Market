// W3M Protocol V1 — adapter for the exact stored Safe release transaction row.
// It decodes the actual `data` field and validates it against a separately
// loaded, trusted, immutable release policy. It does not authorize or broadcast.
import { decodeSafeMultiSendCalldata } from "./safe-multisend-decoder.ts";
import {
  validateSafeReleasePayload,
  type SafeReleasePayloadDecision,
} from "./safe-payload-validator.ts";

export interface SafeReleasePolicySnapshot {
  expectedDealId: string;
  expectedSafeAddress: string;
  expectedMultiSendCallOnly: string;
  expectedTokenAddress: string;
  sellerWallet: string;
  platformWallet: string;
  sellerNetAmount: string;
  platformFeeAmount: string;
  dealAmount: string;
}

export interface SafeReleaseTransactionRow {
  deal_id: unknown;
  action: unknown;
  safe_tx_hash: unknown;
  safe_address: unknown;
  chain_id: unknown;
  to_address: unknown;
  data: unknown;
  value_wei: unknown;
  operation: unknown;
}

export interface SafeReleaseTransactionValidation {
  valid: boolean;
  issues: string[];
  payloadDecision: SafeReleasePayloadDecision | null;
  decodedCallCount: number;
}

function integer(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function validateStoredSafeReleaseTransaction(
  row: SafeReleaseTransactionRow,
  policy: SafeReleasePolicySnapshot,
): SafeReleaseTransactionValidation {
  const issues: string[] = [];
  const dealId = text(row.deal_id);
  const action = text(row.action);
  const safeTransactionHash = text(row.safe_tx_hash);
  const safeAddress = text(row.safe_address);
  const chainId = integer(row.chain_id);
  const outerTo = text(row.to_address);
  const calldata = text(row.data);
  const outerValue = typeof row.value_wei === "string" ? row.value_wei :
    typeof row.value_wei === "number" && Number.isSafeInteger(row.value_wei)
      ? String(row.value_wei)
      : null;
  const outerOperation = integer(row.operation);

  if (!dealId || dealId !== policy.expectedDealId) issues.push("SAFE_ROW_DEAL_BINDING_MISMATCH");
  if (action !== "release_to_seller") issues.push("SAFE_ROW_ACTION_NOT_RELEASE");
  if (!safeTransactionHash || !/^0x[0-9a-fA-F]{64}$/.test(safeTransactionHash)) issues.push("SAFE_ROW_TX_HASH_INVALID");
  if (!safeAddress) issues.push("SAFE_ROW_ADDRESS_MISSING");
  if (chainId === null) issues.push("SAFE_ROW_CHAIN_ID_INVALID");
  if (!outerTo) issues.push("SAFE_ROW_TARGET_MISSING");
  if (!calldata) issues.push("SAFE_ROW_CALLDATA_MISSING");
  if (outerValue === null) issues.push("SAFE_ROW_VALUE_INVALID");
  if (outerOperation === null) issues.push("SAFE_ROW_OPERATION_INVALID");
  if (issues.length > 0) {
    return { valid: false, issues, payloadDecision: null, decodedCallCount: 0 };
  }

  const decoded = decodeSafeMultiSendCalldata(calldata!);
  if (!decoded.valid) {
    return {
      valid: false,
      issues: decoded.issues.map((code) => "MULTISEND_DECODE_" + code),
      payloadDecision: null,
      decodedCallCount: decoded.calls.length,
    };
  }

  const decision = validateSafeReleasePayload({
    chainId: chainId!,
    safeAddress: safeAddress!,
    expectedSafeAddress: policy.expectedSafeAddress,
    outerTo: outerTo!,
    expectedMultiSendCallOnly: policy.expectedMultiSendCallOnly,
    outerOperation: outerOperation!,
    outerValue: outerValue!,
    tokenAddress: policy.expectedTokenAddress,
    expectedTokenAddress: policy.expectedTokenAddress,
    sellerWallet: policy.sellerWallet,
    platformWallet: policy.platformWallet,
    sellerNetAmount: policy.sellerNetAmount,
    platformFeeAmount: policy.platformFeeAmount,
    dealAmount: policy.dealAmount,
    calls: decoded.calls,
  });
  return {
    valid: decision.valid,
    issues: decision.issues,
    payloadDecision: decision,
    decodedCallCount: decoded.calls.length,
  };
}
