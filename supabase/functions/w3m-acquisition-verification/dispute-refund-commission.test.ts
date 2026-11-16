import {
  calculateW3MDisputeRefundFunding,
  type W3MDisputeRefundFundingInput,
} from "./dispute-refund-commission.ts";

function evaluate(overrides: Partial<W3MDisputeRefundFundingInput> = {}) {
  return calculateW3MDisputeRefundFunding({
    originalAgreedDealValue: "100",
    authorizedBuyerRefundAmount: "92.5",
    confirmedFundedAmount: "100",
    confirmedSafeBalance: "100",
    ...overrides,
  });
}

Deno.test("uses original agreed deal value as the fixed commission base", () => {
  const result = evaluate();
  if (!result.valid || result.commissionBase !== "100" ||
      result.platformFeeAmount !== "7.5" || result.feePercent !== "7.5") {
    throw new Error("Expected 7.5% of the original 100-unit deal value.");
  }
});

Deno.test("keeps the fee fixed but rejects partial refunds without seller-residual authorization", () => {
  const small = evaluate({ authorizedBuyerRefundAmount: "20" });
  const large = evaluate({ authorizedBuyerRefundAmount: "80" });
  if (small.platformFeeAmount !== "7.5" || large.platformFeeAmount !== "7.5" ||
      small.valid || large.valid ||
      !small.issues.includes("PARTIAL_REFUND_ALLOCATION_NOT_APPROVED") ||
      !large.issues.includes("PARTIAL_REFUND_ALLOCATION_NOT_APPROVED")) {
    throw new Error("Commission must remain fixed and unapproved residuals must fail closed.");
  }
});

Deno.test("allows a refund plus fixed fee when both fit in confirmed Safe balance", () => {
  const result = evaluate({ authorizedBuyerRefundAmount: "92.5" });
  if (!result.valid || result.requiredSafeBalance !== "100" ||
      result.unallocatedSafeBalance !== "0") {
    throw new Error("Expected the authorized refund and fixed fee to fit exactly.");
  }
});

Deno.test("fails closed when a full original-value refund plus fee exceeds confirmed deal funding", () => {
  const result = evaluate({ authorizedBuyerRefundAmount: "100" });
  if (result.valid ||
      !result.issues.includes("PARTIAL_REFUND_ALLOCATION_NOT_APPROVED") ||
      !result.issues.includes("SAFE_BALANCE_INSUFFICIENT_FOR_FIXED_FEE_AND_REFUND")) {
    throw new Error("Refund plus fixed fee must not exceed the confirmed deal allocation.");
  }
});

Deno.test("rejects using extra Safe funds to supplement an unapproved buyer refund allocation", () => {
  const result = evaluate({
    authorizedBuyerRefundAmount: "100",
    confirmedFundedAmount: "100",
    confirmedSafeBalance: "107.5",
  });
  if (result.valid || !result.issues.includes("PARTIAL_REFUND_ALLOCATION_NOT_APPROVED")) {
    throw new Error("Extra Safe balance must not be treated as part of this deal funding.");
  }
});

Deno.test("bounds the buyer refund by confirmed funded amount even when Safe has extra funds", () => {
  const result = evaluate({
    authorizedBuyerRefundAmount: "101",
    confirmedFundedAmount: "100",
    confirmedSafeBalance: "200",
  });
  if (result.valid || !result.issues.includes("BUYER_REFUND_EXCEEDS_CONFIRMED_FUNDED_AMOUNT")) {
    throw new Error("Buyer refund must not exceed the confirmed deal funding.");
  }
});

Deno.test("rejects positive deal residual until an explicit seller allocation is approved", () => {
  const result = evaluate({ authorizedBuyerRefundAmount: "90" });
  if (result.valid || !result.issues.includes("PARTIAL_REFUND_ALLOCATION_NOT_APPROVED")) {
    throw new Error("Unallocated seller residual must fail closed.");
  }
});

Deno.test("uses exact 18-decimal arithmetic without floating point", () => {
  const result = evaluate({
    originalAgreedDealValue: "100.000000000000000001",
    authorizedBuyerRefundAmount: "92.500000000000000001",
    confirmedFundedAmount: "100.000000000000000001",
    confirmedSafeBalance: "100.000000000000000001",
  });
  if (!result.valid || result.platformFeeAmount !== "7.5" ||
      result.commissionBase !== "100.000000000000000001") {
    throw new Error("Unexpected 18-decimal commission result.");
  }
});

Deno.test("rejects malformed or over-precision amounts", () => {
  const malformed = evaluate({ originalAgreedDealValue: "1e2" });
  const overPrecision = evaluate({ authorizedBuyerRefundAmount: "1.0000000000000000001" });
  if (malformed.valid || !malformed.issues.includes("AMOUNT_FORMAT_INVALID") ||
      overPrecision.valid || !overPrecision.issues.includes("AMOUNT_FORMAT_INVALID")) {
    throw new Error("Expected malformed decimal strings to fail closed.");
  }
});

Deno.test("rejects zero original deal value and zero buyer refund", () => {
  const zeroDeal = evaluate({ originalAgreedDealValue: "0" });
  const zeroRefund = evaluate({ authorizedBuyerRefundAmount: "0" });
  if (zeroDeal.valid || !zeroDeal.issues.includes("ORIGINAL_DEAL_VALUE_MUST_BE_POSITIVE") ||
      zeroRefund.valid || !zeroRefund.issues.includes("BUYER_REFUND_MUST_BE_POSITIVE")) {
    throw new Error("Expected non-positive deal/refund values to be rejected.");
  }
});

Deno.test("rejects confirmed funding that differs from the immutable original deal value", () => {
  const result = evaluate({ confirmedFundedAmount: "99" });
  if (result.valid || !result.issues.includes("CONFIRMED_FUNDING_DOES_NOT_MATCH_ORIGINAL_DEAL_VALUE")) {
    throw new Error("Refund allocation must be bound to the exact confirmed deal funding.");
  }
});
