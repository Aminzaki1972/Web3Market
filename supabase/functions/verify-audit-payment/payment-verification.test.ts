import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertSupportedPaymentAsset, BNB_PEG_BSC_USD_CONTRACT, findExactTransferLog, TRANSFER_TOPIC } from "./payment-verification.ts";
const token = "0x" + "a".repeat(40);
const payer = "0x" + "b".repeat(40);
const recipient = "0x" + "c".repeat(40);
const topic = (address: string) => "0x" + "0".repeat(24) + address.slice(2);
const log = (overrides: Record<string, unknown> = {}) => ({
  address: token,
  topics: [TRANSFER_TOPIC, topic(payer), topic(recipient)],
  data: "0x" + (9000000n).toString(16).padStart(64, "0"),
  logIndex: "0x2",
  ...overrides,
});
Deno.test("accepts one exact token transfer", () => {
  assertEquals(findExactTransferLog([log()], token, recipient, 9000000n), { payerAddress: payer, logIndex: 2 });
});
Deno.test("rejects a wrong token contract", () => {
  assertThrows(() => findExactTransferLog([log()], "0x" + "d".repeat(40), recipient, 9000000n));
});
Deno.test("rejects wrong recipient and amount", () => {
  assertThrows(() => findExactTransferLog([log()], token, "0x" + "e".repeat(40), 9000000n));
  assertThrows(() => findExactTransferLog([log()], token, recipient, 9000001n));
});
Deno.test("rejects removed and malformed logs", () => {
  assertThrows(() => findExactTransferLog([log({ removed: true })], token, recipient, 9000000n));
  assertThrows(() => findExactTransferLog([log({ data: "0x01" })], token, recipient, 9000000n));
});
Deno.test("rejects ambiguous duplicate matching events", () => {
  assertThrows(() => findExactTransferLog([log(), log({ logIndex: "0x3" })], token, recipient, 9000000n));
});
Deno.test("rejects a missing or unsafe log index", () => {
  assertThrows(() => findExactTransferLog([log({ logIndex: undefined })], token, recipient, 9000000n));
});

Deno.test("accepts only the approved Binance-Peg BSC-USD payment asset", () => {
  assertEquals(assertSupportedPaymentAsset(56, BNB_PEG_BSC_USD_CONTRACT, "BSC-USD", 18), undefined);
});
Deno.test("rejects wrong chain, token contract, label, or decimals", () => {
  assertThrows(() => assertSupportedPaymentAsset(1, BNB_PEG_BSC_USD_CONTRACT, "BSC-USD", 18));
  assertThrows(() => assertSupportedPaymentAsset(56, "0x" + "d".repeat(40), "BSC-USD", 18));
  assertThrows(() => assertSupportedPaymentAsset(56, BNB_PEG_BSC_USD_CONTRACT, "USDT", 18));
  assertThrows(() => assertSupportedPaymentAsset(56, BNB_PEG_BSC_USD_CONTRACT, "BSC-USD", 6));
});
