// W3M Protocol V1 — buyer-refund Safe payload validator.
// Deliberately separate from seller-release validation. The caller must decode
// the actual Safe/MultiSend calldata with a trusted ABI decoder first.
export interface DecodedSafeRefundCall {
  operation: number;
  to: string;
  value: string;
  method: string;
  recipient?: string;
  amount?: string; // token base units
}

export interface SafeRefundPayloadInput {
  chainId: number;
  safeAddress: string;
  expectedSafeAddress: string;
  outerTo: string;
  expectedMultiSendCallOnly: string;
  outerOperation: number;
  outerValue: string;
  tokenAddress: string;
  expectedTokenAddress: string;
  buyerWallet: string;
  platformWallet: string;
  originalDealAmount: string; // token base units from immutable signed terms
  buyerRefundAmount: string; // separately authorized by immutable dispute decision
  confirmedFundedAmount: string; // canonical confirmed funding for this deal
  platformFeeAmount: string; // fixed 7.5% of originalDealAmount
  confirmedSafeBalance: string;
  calls: DecodedSafeRefundCall[];
}

export interface SafeRefundPayloadDecision {
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

/**
 * Validates exactly two Safe MultiSend token transfers: the separately
 * authorized buyer refund and the fixed platform fee. It does not assign
 * residual balance to the seller and does not sign, submit, or finalize.
 * originalDealAmount must already be verified against the signed deal terms.
 */
export function validateSafeRefundPayload(input: SafeRefundPayloadInput): SafeRefundPayloadDecision {
  const issues: string[] = [];
  if (input.chainId !== 56) issues.push("CHAIN_NOT_APPROVED");
  if (!sameAddress(input.safeAddress, input.expectedSafeAddress)) issues.push("SAFE_ADDRESS_MISMATCH");
  if (!sameAddress(input.outerTo, input.expectedMultiSendCallOnly)) issues.push("MULTISEND_TARGET_MISMATCH");
  if (input.outerOperation !== 1) issues.push("OUTER_OPERATION_MUST_BE_DELEGATECALL");
  if (!validUint(input.outerValue) || input.outerValue !== "0") issues.push("OUTER_NATIVE_VALUE_NOT_ZERO");
  if (!sameAddress(input.tokenAddress, input.expectedTokenAddress)) issues.push("TOKEN_ADDRESS_MISMATCH");
  if (!ADDRESS.test(input.buyerWallet || "")) issues.push("BUYER_WALLET_INVALID");
  if (!ADDRESS.test(input.platformWallet || "")) issues.push("PLATFORM_WALLET_INVALID");
  if (sameAddress(input.buyerWallet, input.platformWallet)) issues.push("BUYER_AND_PLATFORM_WALLETS_MUST_DIFFER");

  const amounts = [
    input.originalDealAmount,
    input.buyerRefundAmount,
    input.confirmedFundedAmount,
    input.platformFeeAmount,
    input.confirmedSafeBalance,
  ];
  if (amounts.some((value) => !validUint(value))) {
    issues.push("AMOUNT_FORMAT_INVALID");
  } else {
    const original = BigInt(input.originalDealAmount);
    const refund = BigInt(input.buyerRefundAmount);
    const funded = BigInt(input.confirmedFundedAmount);
    const fee = BigInt(input.platformFeeAmount);
    const balance = BigInt(input.confirmedSafeBalance);
    const expectedFee = (original * 75n + 500n) / 1000n;
    if (original <= 0n) issues.push("ORIGINAL_DEAL_AMOUNT_INVALID");
    if (refund <= 0n) issues.push("BUYER_REFUND_AMOUNT_INVALID");
    if (funded <= 0n) issues.push("CONFIRMED_FUNDED_AMOUNT_INVALID");
    if (refund > funded) issues.push("BUYER_REFUND_EXCEEDS_CONFIRMED_FUNDED_AMOUNT");
    if (fee !== expectedFee) issues.push("PLATFORM_FEE_NOT_7_5_PERCENT_OF_ORIGINAL_DEAL");
    if (refund + fee > balance) issues.push("SAFE_BALANCE_INSUFFICIENT_FOR_REFUND_AND_FEE");
  }

  if (!Array.isArray(input.calls) || input.calls.length !== 2) {
    issues.push("MULTISEND_MUST_CONTAIN_EXACTLY_BUYER_AND_PLATFORM_TRANSFERS");
  } else {
    const buyerCalls = input.calls.filter((call) =>
      call.method === "transfer" &&
      sameAddress(call.to, input.expectedTokenAddress) &&
      sameAddress(call.recipient || "", input.buyerWallet) &&
      call.amount === input.buyerRefundAmount
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
    if (buyerCalls.length !== 1) issues.push("EXACT_BUYER_REFUND_TRANSFER_MISSING_OR_DUPLICATED");
    if (feeCalls.length !== 1) issues.push("EXACT_PLATFORM_FEE_TRANSFER_MISSING_OR_DUPLICATED");
  }

  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}
