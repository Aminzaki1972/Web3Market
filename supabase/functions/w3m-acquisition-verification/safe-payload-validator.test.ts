import {
  validateSafeReleasePayload,
  type SafeReleasePayloadInput,
} from "./safe-payload-validator.ts";

const SAFE = "0x1111111111111111111111111111111111111111";
const MULTISEND = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const SELLER = "0x4444444444444444444444444444444444444444";
const PLATFORM = "0x5555555555555555555555555555555555555555";

function input(overrides: Partial<SafeReleasePayloadInput> = {}): SafeReleasePayloadInput {
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
    sellerWallet: SELLER,
    platformWallet: PLATFORM,
    sellerNetAmount: "9250000000000000000",
    platformFeeAmount: "750000000000000000",
    dealAmount: "10000000000000000000",
    calls: [
      { operation: 0, to: TOKEN, value: "0", method: "transfer", recipient: SELLER, amount: "9250000000000000000" },
      { operation: 0, to: TOKEN, value: "0", method: "transfer", recipient: PLATFORM, amount: "750000000000000000" },
    ],
    ...overrides,
  };
}

function assertValid(candidate: SafeReleasePayloadInput, label: string) {
  const result = validateSafeReleasePayload(candidate);
  if (!result.valid) throw new Error(label + ": " + result.issues.join(", "));
}
function assertDenied(candidate: SafeReleasePayloadInput, code: string) {
  const result = validateSafeReleasePayload(candidate);
  if (result.valid || !result.issues.includes(code)) {
    throw new Error("Expected rejection " + code + ", got " + JSON.stringify(result));
  }
}

Deno.test("accepts exactly the intended seller and platform transfers", () => {
  assertValid(input(), "valid two-transfer payload");
});
Deno.test("rejects an extra MultiSend call", () => {
  const x = input(); x.calls.push({ operation: 0, to: TOKEN, value: "0", method: "transfer", recipient: SELLER, amount: "1" });
  assertDenied(x, "MULTISEND_MUST_CONTAIN_EXACTLY_TWO_CALLS");
});
Deno.test("rejects a substituted seller recipient", () => {
  const x = input(); x.calls[0].recipient = PLATFORM;
  assertDenied(x, "EXACT_SELLER_TRANSFER_MISSING_OR_DUPLICATED");
});
Deno.test("rejects a substituted transfer amount", () => {
  const x = input(); x.calls[0].amount = "1";
  assertDenied(x, "EXACT_SELLER_TRANSFER_MISSING_OR_DUPLICATED");
});
Deno.test("rejects a wrong token contract", () => {
  const x = input(); x.calls[0].to = SELLER;
  assertDenied(x, "UNEXPECTED_INNER_TOKEN");
});
Deno.test("rejects Safe CALL instead of DELEGATECALL", () => {
  assertDenied(input({ outerOperation: 0 }), "OUTER_OPERATION_MUST_BE_DELEGATECALL");
});
Deno.test("rejects inner DELEGATECALL", () => {
  const x = input(); x.calls[0].operation = 1;
  assertDenied(x, "INNER_OPERATION_MUST_BE_CALL");
});
Deno.test("rejects nonzero native value", () => {
  const x = input(); x.calls[1].value = "1";
  assertDenied(x, "INNER_NATIVE_VALUE_NOT_ZERO");
});
Deno.test("rejects wrong chain and Safe address", () => {
  assertDenied(input({ chainId: 97 }), "CHAIN_NOT_APPROVED");
  assertDenied(input({ safeAddress: PLATFORM }), "SAFE_ADDRESS_MISMATCH");
});
Deno.test("rejects a fee split that does not equal the deal amount", () => {
  assertDenied(input({ platformFeeAmount: "1" }), "FEE_SPLIT_TOTAL_MISMATCH");
});
Deno.test("rejects an unexpected method such as approve", () => {
  const x = input(); x.calls[0].method = "approve";
  assertDenied(x, "UNEXPECTED_INNER_METHOD");
});
Deno.test("rejects duplicate seller and platform recipients", () => {
  assertDenied(input({ platformWallet: SELLER }), "SELLER_AND_PLATFORM_WALLETS_MUST_DIFFER");
});
