// W3M Protocol V1 — exact fixed commission arithmetic for dispute refunds.
// Pure arithmetic only: callers must bind originalAgreedDealValue to the immutable
// signed deal terms and independently authorize the buyer refund amount.
const SCALE = 10n ** 18n;
const DECIMAL = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,18}))?$/;

export interface W3MDisputeRefundFundingInput {
  originalAgreedDealValue: string;
  authorizedBuyerRefundAmount: string;
  confirmedFundedAmount: string;
  confirmedSafeBalance: string;
}

export interface W3MDisputeRefundFundingDecision {
  valid: boolean;
  issues: string[];
  commissionBase: string | null;
  feePercent: "7.5";
  platformFeeAmount: string | null;
  buyerRefundAmount: string | null;
  confirmedSafeBalance: string | null;
  requiredSafeBalance: string | null;
  unallocatedSafeBalance: string | null;
}

function parseUnits(value: string): bigint {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new Error("AMOUNT_FORMAT_INVALID");
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt((fraction + "0".repeat(18)).slice(0, 18));
}

function formatUnits(value: bigint): string {
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? whole.toString() + "." + fraction : whole.toString();
}

/**
 * Calculates W3M's 7.5% fee once from the original agreed deal value, then
 * checks whether that fixed fee plus the separately authorized buyer refund
 * fits within the confirmed Safe balance. It never allocates any residual
 * balance to the seller and never creates/signs/submits a Safe transaction.
 */
export function calculateW3MDisputeRefundFunding(
  input: W3MDisputeRefundFundingInput,
): W3MDisputeRefundFundingDecision {
  const result: W3MDisputeRefundFundingDecision = {
    valid: false,
    issues: [],
    commissionBase: null,
    feePercent: "7.5",
    platformFeeAmount: null,
    buyerRefundAmount: null,
    confirmedSafeBalance: null,
    requiredSafeBalance: null,
    unallocatedSafeBalance: null,
  };

  let original: bigint;
  let refund: bigint;
  let funded: bigint;
  let balance: bigint;
  try {
    original = parseUnits(input.originalAgreedDealValue);
    refund = parseUnits(input.authorizedBuyerRefundAmount);
    funded = parseUnits(input.confirmedFundedAmount);
    balance = parseUnits(input.confirmedSafeBalance);
  } catch (error) {
    result.issues.push(error instanceof Error ? error.message : "AMOUNT_FORMAT_INVALID");
    return result;
  }

  if (original <= 0n) result.issues.push("ORIGINAL_DEAL_VALUE_MUST_BE_POSITIVE");
  if (refund <= 0n) result.issues.push("BUYER_REFUND_MUST_BE_POSITIVE");
  if (funded <= 0n) result.issues.push("CONFIRMED_FUNDED_AMOUNT_MUST_BE_POSITIVE");
  if (refund > funded) result.issues.push("BUYER_REFUND_EXCEEDS_CONFIRMED_FUNDED_AMOUNT");
  if (balance < 0n) result.issues.push("SAFE_BALANCE_MUST_NOT_BE_NEGATIVE");
  if (result.issues.length) return result;

  // 7.5% = 75/1000. Add 500 before division for SQL-compatible
  // round-half-away-from-zero at 18 decimal places (all values are positive).
  const fee = (original * 75n + 500n) / 1000n;
  const required = fee + refund;

  result.commissionBase = formatUnits(original);
  result.platformFeeAmount = formatUnits(fee);
  result.buyerRefundAmount = formatUnits(refund);
  result.confirmedSafeBalance = formatUnits(balance);
  result.requiredSafeBalance = formatUnits(required);

  if (required > balance) {
    result.issues.push("SAFE_BALANCE_INSUFFICIENT_FOR_FIXED_FEE_AND_REFUND");
    return result;
  }

  result.unallocatedSafeBalance = formatUnits(balance - required);
  result.valid = true;
  return result;
}
