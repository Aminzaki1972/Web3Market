import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertCanonicalReceiptBlock, assertPaymentBlockBeforeExpiry, assertSupportedPaymentAsset, BNB_PEG_BSC_USD_CONTRACT, findExactTransferLog, TRANSFER_TOPIC } from "./payment-verification.ts";
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

Deno.test("rejects mint events from the zero address as customer payments", () => {
  const zeroAddressTopic = topic("0x" + "0".repeat(40));
  assertThrows(() => findExactTransferLog([log({ topics: [TRANSFER_TOPIC, zeroAddressTopic, topic(recipient)] })], token, recipient, 9000000n));
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

Deno.test("accepts a receipt whose block hash and number match the canonical block", () => {
  assertEquals(assertCanonicalReceiptBlock("0x10", "0x" + "a".repeat(64), { number: "0x10", hash: "0x" + "A".repeat(64) }), undefined);
});
Deno.test("rejects a receipt when the canonical block hash differs", () => {
  assertThrows(() => assertCanonicalReceiptBlock("0x10", "0x" + "a".repeat(64), { number: "0x10", hash: "0x" + "b".repeat(64) }));
});
Deno.test("rejects a missing canonical block or mismatched block number", () => {
  assertThrows(() => assertCanonicalReceiptBlock("0x10", "0x" + "a".repeat(64), null));
  assertThrows(() => assertCanonicalReceiptBlock("0x10", "0x" + "a".repeat(64), { number: "0x11", hash: "0x" + "a".repeat(64) }));
});

Deno.test("accepts a payment included before order expiry even if checked later", () => {
  const expiry = "2026-11-03T12:00:00.000Z";
  const before = "0x" + BigInt(Math.floor(Date.parse(expiry) / 1000) - 1).toString(16);
  assertEquals(assertPaymentBlockBeforeExpiry(expiry, before), undefined);
});
Deno.test("rejects a payment included after order expiry", () => {
  const expiry = "2026-11-03T12:00:00.000Z";
  const after = "0x" + BigInt(Math.floor(Date.parse(expiry) / 1000) + 1).toString(16);
  assertThrows(() => assertPaymentBlockBeforeExpiry(expiry, after));
});
Deno.test("rejects invalid order expiry or missing canonical block timestamp", () => {
  assertThrows(() => assertPaymentBlockBeforeExpiry("not-a-date", "0x1"));
  assertThrows(() => assertPaymentBlockBeforeExpiry("2026-11-03T12:00:00.000Z", null));
});
