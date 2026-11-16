import {
  calculateW3MDisputeRefundFunding,
  type W3MDisputeRefundFundingInput,
} from "./dispute-refund-commission.ts";

function evaluate(overrides: Partial<W3MDisputeRefundFundingInput> = {}) {
  return calculateW3MDisputeRefundFunding({
    originalAgreedDealValue: "100",
    authorizedBuyerRefundAmount: "20",
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

Deno.test("partial refund size does not change the original-value commission", () => {
  const small = evaluate({ authorizedBuyerRefundAmount: "20" });
  const large = evaluate({ authorizedBuyerRefundAmount: "80" });
  if (small.platformFeeAmount !== "7.5" || large.platformFeeAmount !== "7.5") {
    throw new Error("Commission must remain fixed for partial refunds.");
  }
});

Deno.test("allows a refund plus fixed fee when both fit in confirmed Safe balance", () => {
  const result = evaluate({ authorizedBuyerRefundAmount: "92.5" });
  if (!result.valid || result.requiredSafeBalance !== "100" ||
      result.unallocatedSafeBalance !== "0") {
    throw new Error("Expected the authorized refund and fixed fee to fit exactly.");
  }
});

Deno.test("fails closed when a full original-value refund plus fixed fee exceeds Safe balance", () => {
  const result = evaluate({ authorizedBuyerRefundAmount: "100" });
  if (result.valid ||
      !result.issues.includes("SAFE_BALANCE_INSUFFICIENT_FOR_FIXED_FEE_AND_REFUND")) {
    throw new Error("Expected insufficient Safe balance to block refund funding.");
  }
});

Deno.test("permits a full original-value refund only when Safe balance also covers the fixed fee", () => {
  const result = evaluate({
    authorizedBuyerRefundAmount: "100",
    confirmedFundedAmount: "100",
    confirmedSafeBalance: "107.5",
  });
  if (!result.valid || result.requiredSafeBalance !== "107.5" ||
      result.unallocatedSafeBalance !== "0") {
    throw new Error("A full refund plus fee should pass when the confirmed Safe balance covers both.");
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

Deno.test("does not assign residual Safe balance to seller", () => {
  const result = evaluate({ authorizedBuyerRefundAmount: "90" });
  if (!result.valid || result.unallocatedSafeBalance !== "2.5") {
    throw new Error("Expected residual balance to remain unallocated.");
  }
});

Deno.test("uses exact 18-decimal arithmetic without floating point", () => {
  const result = evaluate({
    originalAgreedDealValue: "100.000000000000000001",
    authorizedBuyerRefundAmount: "92.5",
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
