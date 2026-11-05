// W3M Protocol V1 — exact Safe release payload validator.
// Pure domain logic. The caller must decode the actual Safe/MultiSend calldata
// with a trusted ABI decoder before passing these normalized calls here.

export interface DecodedSafeCall {
  operation: number; // Safe MultiSend inner operation: 0 = CALL
  to: string;
  value: string; // native BNB value in wei
  method: string;
  recipient?: string;
  amount?: string; // token base units
}

export interface SafeReleasePayloadInput {
  chainId: number;
  safeAddress: string;
  expectedSafeAddress: string;
  outerTo: string;
  expectedMultiSendCallOnly: string;
  outerOperation: number; // Safe operation: 1 = DELEGATECALL
  outerValue: string;
  tokenAddress: string;
  expectedTokenAddress: string;
  sellerWallet: string;
  platformWallet: string;
  sellerNetAmount: string;
  platformFeeAmount: string;
  dealAmount: string;
  calls: DecodedSafeCall[];
}

export interface SafeReleasePayloadDecision {
  valid: boolean;
  issues: string[];
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UINT = /^(0|[1-9][0-9]*)$/;

function sameAddress(a: string, b: string): boolean {
  return ADDRESS.test(a || "") && ADDRESS.test(b || "") && a.toLowerCase() === b.toLowerCase();
}

function validUint(value: string): boolean {
  return UINT.test(value || "");
}

export function validateSafeReleasePayload(
  input: SafeReleasePayloadInput,
): SafeReleasePayloadDecision {
  const issues: string[] = [];

  if (input.chainId !== 56) issues.push("CHAIN_NOT_APPROVED");
  if (!sameAddress(input.safeAddress, input.expectedSafeAddress)) issues.push("SAFE_ADDRESS_MISMATCH");
  if (!sameAddress(input.outerTo, input.expectedMultiSendCallOnly)) issues.push("MULTISEND_TARGET_MISMATCH");
  if (input.outerOperation !== 1) issues.push("OUTER_OPERATION_MUST_BE_DELEGATECALL");
  if (!validUint(input.outerValue) || input.outerValue !== "0") issues.push("OUTER_NATIVE_VALUE_NOT_ZERO");
  if (!sameAddress(input.tokenAddress, input.expectedTokenAddress)) issues.push("TOKEN_ADDRESS_MISMATCH");

  if (!sameAddress(input.sellerWallet, input.platformWallet)) {
    // Distinct recipients are required; invalid addresses are also rejected below.
  } else {
    issues.push("SELLER_AND_PLATFORM_WALLETS_MUST_DIFFER");
  }
  if (!ADDRESS.test(input.sellerWallet || "")) issues.push("SELLER_WALLET_INVALID");
  if (!ADDRESS.test(input.platformWallet || "")) issues.push("PLATFORM_WALLET_INVALID");

  const amounts = [input.sellerNetAmount, input.platformFeeAmount, input.dealAmount];
  if (amounts.some((value) => !validUint(value))) {
    issues.push("AMOUNT_FORMAT_INVALID");
  } else {
    const seller = BigInt(input.sellerNetAmount);
    const fee = BigInt(input.platformFeeAmount);
    const total = BigInt(input.dealAmount);
    if (seller <= 0n || fee < 0n || total <= 0n || seller + fee !== total) {
      issues.push("FEE_SPLIT_TOTAL_MISMATCH");
    }
  }

  if (!Array.isArray(input.calls) || input.calls.length !== 2) {
    issues.push("MULTISEND_MUST_CONTAIN_EXACTLY_TWO_CALLS");
  } else {
    const sellerCalls = input.calls.filter((call) =>
      call.method === "transfer" &&
      sameAddress(call.to, input.expectedTokenAddress) &&
      sameAddress(call.recipient || "", input.sellerWallet) &&
      call.amount === input.sellerNetAmount
    );
    const feeCalls = input.calls.filter((call) =>
      call.method === "transfer" &&
      sameAddress(call.to, input.expectedTokenAddress) &&
      sameAddress(call.recipient || "", input.platformWallet) &&
      call.amount === input.platformFeeAmount
    );

    for (const call of input.calls) {
      if (call.operation !== 0) issues.push("INNER_OPERATION_MUST_BE_CALL");
      if (!validUint(call.value) || call.value !== "0") issues.push("INNER_NATIVE_VALUE_NOT_ZERO");
      if (call.method !== "transfer") issues.push("UNEXPECTED_INNER_METHOD");
      if (!sameAddress(call.to, input.expectedTokenAddress)) issues.push("UNEXPECTED_INNER_TOKEN");
      if (!call.recipient || !ADDRESS.test(call.recipient)) issues.push("INNER_RECIPIENT_INVALID");
      if (!validUint(call.amount || "")) issues.push("INNER_AMOUNT_INVALID");
    }

    if (sellerCalls.length !== 1) issues.push("EXACT_SELLER_TRANSFER_MISSING_OR_DUPLICATED");
    if (feeCalls.length !== 1) issues.push("EXACT_PLATFORM_FEE_TRANSFER_MISSING_OR_DUPLICATED");
  }

  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}
