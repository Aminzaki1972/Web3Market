import { assertEquals } from "jsr:@std/assert@1.0.14";
import { verifyBscUsdtDeposit, type ReadOnlyBscClient, type ReadOnlyBscReceipt } from "./bsc-readonly-adapter.ts";
import { parseUsdtAmount } from "./core.ts";

const token = "0x1111111111111111111111111111111111111111";
const safe = "0x2222222222222222222222222222222222222222";
const txHash = "0x" + "a".repeat(64);
const topic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const recipientTopic = "0x" + "0".repeat(24) + safe.slice(2);
const receipt: ReadOnlyBscReceipt = {
  transactionHash: txHash, status: 1, blockNumber: 100,
  logs: [{ address: token, topics: [topic, "0x" + "0".repeat(64), recipientTopic],
    data: "0x" + parseUsdtAmount("7000").toString(16).padStart(64, "0") }],
};
function client(overrides: Partial<{
  chainId: number; head: number; receipt: ReadOnlyBscReceipt | null; used: boolean;
}> = {}): ReadOnlyBscClient {
  return {
    getChainId: async () => overrides.chainId ?? 56,
    getBlockNumber: async () => overrides.head ?? 111,
    getTransactionReceipt: async () => overrides.receipt === undefined ? receipt : overrides.receipt,
    isTransactionHashUsed: async () => overrides.used ?? false,
  };
}
const config = { txHash, expectedTokenAddress: token, expectedSafeAddress: safe,
  expectedAmount: parseUsdtAmount("7000"), requiredConfirmations: 12 };

Deno.test("read-only adapter verifies the exact BSC Transfer and confirmation count", async () => {
  const result = await verifyBscUsdtDeposit(client(), config);
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.confirmations, 12);
});

Deno.test("read-only adapter rejects wrong network and duplicate transaction hashes", async () => {
  assertEquals(await verifyBscUsdtDeposit(client({ chainId: 97 }), config),
    { ok: false, reason: "wrong_network" });
  const duplicate = await verifyBscUsdtDeposit(client({ used: true }), config);
  assertEquals(duplicate.ok, false);
  if (!duplicate.ok) assertEquals(duplicate.reason, "duplicate_tx_hash");
});

Deno.test("read-only adapter rejects missing receipt and insufficient confirmations", async () => {
  assertEquals(await verifyBscUsdtDeposit(client({ receipt: null }), config),
    { ok: false, reason: "receipt_not_found" });
  const low = await verifyBscUsdtDeposit(client({ head: 105 }), config);
  assertEquals(low.ok, false);
  if (!low.ok) assertEquals(low.reason, "insufficient_confirmations");
});

Deno.test("read-only adapter rejects failed receipts and mismatched transfer amounts", async () => {
  const failed = { ...receipt, status: 0 as const };
  const result = await verifyBscUsdtDeposit(client({ receipt: failed }), config);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "transaction_not_successful");

  const wrongAmount = { ...receipt, logs: [{ ...receipt.logs[0], data: "0x" + "1".padStart(64, "0") }] };
  const mismatch = await verifyBscUsdtDeposit(client({ receipt: wrongAmount }), config);
  assertEquals(mismatch.ok, false);
  if (!mismatch.ok) assertEquals(mismatch.reason, "amount_mismatch");
});
