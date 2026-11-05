import {
  validateStoredSafeReleaseTransaction,
  type SafeReleasePolicySnapshot,
  type SafeReleaseTransactionRow,
} from "./safe-release-transaction-adapter.ts";

const SAFE = "0x1111111111111111111111111111111111111111";
const MULTISEND = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const SELLER = "0x4444444444444444444444444444444444444444";
const PLATFORM = "0x5555555555555555555555555555555555555555";
const policy: SafeReleasePolicySnapshot = {
  expectedSafeAddress: SAFE, expectedMultiSendCallOnly: MULTISEND,
  expectedTokenAddress: TOKEN, sellerWallet: SELLER, platformWallet: PLATFORM,
  sellerNetAmount: "9250000000000000000",
  platformFeeAmount: "750000000000000000",
  dealAmount: "10000000000000000000",
};
function word(value: bigint): string { return value.toString(16).padStart(64, "0"); }
function transfer(to: string, amount: bigint): string {
  return "a9059cbb" + to.slice(2).toLowerCase().padStart(64, "0") + word(amount);
}
function packedCall(to: string, data: string, operation = 0, value = 0n): string {
  return operation.toString(16).padStart(2, "0") + to.slice(2).toLowerCase() +
    word(value) + word(BigInt(data.length / 2)) + data;
}
function multisend(calls: string[]): string {
  const body = calls.join(""), bytes = body.length / 2;
  return "0x8d80ff0a" + word(32n) + word(BigInt(bytes)) +
    body.padEnd(Math.ceil(bytes / 32) * 64, "0");
}
function calldata(seller = SELLER, sellerAmount = 9250000000000000000n): string {
  return multisend([
    packedCall(TOKEN, transfer(seller, sellerAmount)),
    packedCall(TOKEN, transfer(PLATFORM, 750000000000000000n)),
  ]);
}
function row(overrides: Partial<SafeReleaseTransactionRow> = {}): SafeReleaseTransactionRow {
  return {
    safe_address: SAFE, chain_id: 56, to_address: MULTISEND,
    data: calldata(), value_wei: "0", operation: 1, ...overrides,
  };
}
function denied(candidate: SafeReleaseTransactionRow, code: string) {
  const result = validateStoredSafeReleaseTransaction(candidate, policy);
  if (result.valid || !result.issues.includes(code)) {
    throw new Error("Expected " + code + ", got " + JSON.stringify(result));
  }
}

Deno.test("validates the exact stored Safe transaction data against locked policy", () => {
  const result = validateStoredSafeReleaseTransaction(row(), policy);
  if (!result.valid || result.decodedCallCount !== 2) throw new Error(JSON.stringify(result));
});
Deno.test("rejects wrong chain", () => denied(row({ chain_id: "97" }), "CHAIN_NOT_APPROVED"));
Deno.test("rejects wrong Safe address", () => denied(row({ safe_address: PLATFORM }), "SAFE_ADDRESS_MISMATCH"));
Deno.test("rejects wrong MultiSend target", () => denied(row({ to_address: TOKEN }), "MULTISEND_TARGET_MISMATCH"));
Deno.test("rejects wrong outer operation", () => denied(row({ operation: 0 }), "OUTER_OPERATION_MUST_BE_DELEGATECALL"));
Deno.test("rejects nonzero outer BNB value", () => denied(row({ value_wei: "1" }), "OUTER_NATIVE_VALUE_NOT_ZERO"));
Deno.test("rejects attacker seller recipient in actual calldata", () => denied(row({ data: calldata(PLATFORM) }), "EXACT_SELLER_TRANSFER_MISSING_OR_DUPLICATED"));
Deno.test("rejects altered seller amount in actual calldata", () => denied(row({ data: calldata(SELLER, 1n) }), "EXACT_SELLER_TRANSFER_MISSING_OR_DUPLICATED"));
Deno.test("rejects malformed MultiSend selector", () => denied(row({ data: "0x12345678" }), "MULTISEND_DECODE_CALLDATA_TOO_SHORT_OR_UNALIGNED"));
Deno.test("rejects missing transaction target before decoding", () => denied(row({ to_address: null }), "SAFE_ROW_TARGET_MISSING"));
Deno.test("rejects malformed chain ID", () => denied(row({ chain_id: "56.0" }), "SAFE_ROW_CHAIN_ID_INVALID"));
Deno.test("rejects a transaction row with absent calldata", () => denied(row({ data: null }), "SAFE_ROW_CALLDATA_MISSING"));
