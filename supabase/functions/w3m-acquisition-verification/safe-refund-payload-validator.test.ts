import {
  validateSafeRefundPayload,
  type SafeRefundPayloadInput,
} from "./safe-refund-payload-validator.ts";

const SAFE = "0x1111111111111111111111111111111111111111";
const MULTISEND = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const BUYER = "0x4444444444444444444444444444444444444444";
const PLATFORM = "0x5555555555555555555555555555555555555555";
const UNIT = 10n ** 18n;

function input(overrides: Partial<SafeRefundPayloadInput> = {}): SafeRefundPayloadInput {
  return {
    chainId: 56,
    safeAddress: SAFE,
    expectedSafeAddress: SAFE,
    outerTo: MULTISEND,
    expectedMultiSendCallOnly: MULTISEND,
    outerOperation: 1,
    outerValue: "0",
    tokenAddress: TOKEN,
    expectedTokenAddress: TOKEN,
    buyerWallet: BUYER,
    platformWallet: PLATFORM,
    originalDealAmount: (100n * UNIT).toString(),
    buyerRefundAmount: (92n * UNIT + UNIT / 2n).toString(),
    platformFeeAmount: (75n * UNIT / 10n).toString(),
    confirmedSafeBalance: (100n * UNIT).toString(),
    calls: [
      { operation: 0, to: TOKEN, value: "0", method: "transfer", recipient: BUYER, amount: (92n * UNIT + UNIT / 2n).toString() },
      { operation: 0, to: TOKEN, value: "0", method: "transfer", recipient: PLATFORM, amount: (75n * UNIT / 10n).toString() },
    ],
    ...overrides,
  };
}
function assertValid(candidate: SafeRefundPayloadInput, label: string) {
  const result = validateSafeRefundPayload(candidate);
  if (!result.valid) throw new Error(label + ": " + result.issues.join(", "));
}
function assertDenied(candidate: SafeRefundPayloadInput, code: string) {
  const result = validateSafeRefundPayload(candidate);
  if (result.valid || !result.issues.includes(code)) {
    throw new Error("Expected rejection " + code + ", got " + JSON.stringify(result));
  }
}

Deno.test("accepts exact buyer refund plus 7.5% of original deal value", () => {
  assertValid(input(), "valid buyer refund payload");
});

Deno.test("rejects commission prorated from the partial refund amount", () => {
  const x = input({ platformFeeAmount: (69n * UNIT / 10n).toString() });
  x.calls[1].amount = x.platformFeeAmount;
  assertDenied(x, "PLATFORM_FEE_NOT_7_5_PERCENT_OF_ORIGINAL_DEAL");
});

Deno.test("rejects a refund plus fixed fee that exceeds Safe balance", () => {
  const x = input({ buyerRefundAmount: (100n * UNIT).toString() });
  x.calls[0].amount = x.buyerRefundAmount;
  assertDenied(x, "SAFE_BALANCE_INSUFFICIENT_FOR_REFUND_AND_FEE");
});

Deno.test("accepts a full original-value refund when Safe also holds the fixed fee", () => {
  const x = input({
    buyerRefundAmount: (100n * UNIT).toString(),
    confirmedSafeBalance: (1075n * UNIT / 10n).toString(),
  });
  x.calls[0].amount = x.buyerRefundAmount;
  assertValid(x, "full refund plus separately funded fixed fee");
});

Deno.test("rejects extra or missing transfer calls", () => {
  const extra = input();
  extra.calls.push({ operation: 0, to: TOKEN, value: "0", method: "transfer", recipient: BUYER, amount: "1" });
  assertDenied(extra, "MULTISEND_MUST_CONTAIN_EXACTLY_BUYER_AND_PLATFORM_TRANSFERS");
  const missing = input({ calls: [] });
  assertDenied(missing, "MULTISEND_MUST_CONTAIN_EXACTLY_BUYER_AND_PLATFORM_TRANSFERS");
});

Deno.test("rejects wrong buyer recipient, token, and chain", () => {
  const recipient = input();
  recipient.calls[0].recipient = PLATFORM;
  assertDenied(recipient, "EXACT_BUYER_REFUND_TRANSFER_MISSING_OR_DUPLICATED");
  const token = input();
  token.calls[0].to = BUYER;
  assertDenied(token, "UNEXPECTED_INNER_TOKEN");
  assertDenied(input({ chainId: 97 }), "CHAIN_NOT_APPROVED");
});

Deno.test("rejects nonzero native value and inner delegatecall", () => {
  const native = input();
  native.calls[0].value = "1";
  assertDenied(native, "INNER_NATIVE_VALUE_NOT_ZERO");
  const operation = input();
  operation.calls[1].operation = 1;
  assertDenied(operation, "INNER_OPERATION_MUST_BE_CALL");
});

Deno.test("rejects malformed amounts and invalid fee", () => {
  assertDenied(input({ buyerRefundAmount: "-1" }), "AMOUNT_FORMAT_INVALID");
  assertDenied(input({ platformFeeAmount: "1" }), "PLATFORM_FEE_NOT_7_5_PERCENT_OF_ORIGINAL_DEAL");
});
