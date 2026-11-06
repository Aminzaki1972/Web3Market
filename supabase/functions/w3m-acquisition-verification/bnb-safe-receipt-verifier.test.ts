import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { keccak_256 } from "jsr:@noble/hashes@1.7.1/sha3";
import {
  BnbSafeReceiptVerificationError,
  verifyBnbSafeReleaseReceipt,
  type BnbSafeReceiptExpectation,
} from "./bnb-safe-receipt-verifier.ts";

function topic(signature: string): string {
  return "0x" + Array.from(
    keccak_256(new TextEncoder().encode(signature)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
function wordAddress(address: string): string {
  return "0x" + address.slice(2).toLowerCase().padStart(64, "0");
}
function wordUint(value: bigint): string {
  return "0x" + value.toString(16).padStart(64, "0");
}
const expected: BnbSafeReceiptExpectation = {
  attemptId: "attempt-1",
  broadcastTxHash: "0x" + "1".repeat(64),
  actorId: "buyer-1",
  safeTxHash: "0x" + "2".repeat(64),
  safeAddress: "0x" + "3".repeat(40),
  tokenContract: "0x" + "4".repeat(40),
  sellerWallet: "0x" + "5".repeat(40),
  sellerAmount: "92.5",
  platformWallet: "0x" + "6".repeat(40),
  platformFee: "7.5",
  minConfirmations: 6,
};
const safeSuccess = topic("ExecutionSuccess(bytes32,uint256)");
const safeFailure = topic("ExecutionFailure(bytes32,uint256)");
const transfer = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const blockHash = "0x" + "a".repeat(64);
const receiptLogs = [
  {
    address: expected.safeAddress,
    topics: [safeSuccess, expected.safeTxHash],
    data: wordUint(0n),
    logIndex: "0x0",
  },
  {
    address: expected.tokenContract,
    topics: [transfer, wordAddress(expected.safeAddress), wordAddress(expected.sellerWallet)],
    data: wordUint(925n * 10n ** 17n),
    logIndex: "0x1",
  },
  {
    address: expected.tokenContract,
    topics: [transfer, wordAddress(expected.safeAddress), wordAddress(expected.platformWallet)],
    data: wordUint(75n * 10n ** 16n),
    logIndex: "0x2",
  },
];
function mockRpc(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const receipt = {
    transactionHash: expected.broadcastTxHash,
    blockHash,
    blockNumber: "0x64",
    status: "0x1",
    logs: receiptLogs,
    ...((overrides.receipt as Record<string, unknown> | undefined) ?? {}),
  };
  const chainId = overrides.chainId ?? "0x38";
  const head = overrides.head ?? "0x70";
  const canonicalHash = overrides.canonicalHash ?? blockHash;
  const decimals = overrides.decimals ?? wordUint(18n);
  const rpc = {
    async request<T>(method: string, params: unknown[]): Promise<T> {
      calls.push(method);
      let value: unknown;
      if (method === "eth_chainId") value = chainId;
      else if (method === "eth_getTransactionReceipt") value = receipt;
      else if (method === "eth_blockNumber") value = head;
      else if (method === "eth_getBlockByNumber") value = { hash: canonicalHash };
      else if (method === "eth_call") value = decimals;
      else throw new Error("Unexpected RPC method " + method);
      return value as T;
    },
  };
  return { rpc, calls };
}

Deno.test("raw BNB receipt verifies Safe event and exact token transfers", async () => {
  const { rpc } = mockRpc();
  const result = await verifyBnbSafeReleaseReceipt(rpc, expected);
  assertEquals(result.chain_id, 56);
  assertEquals(result.execution_success, true);
  assertEquals(result.execution_failure, false);
  assertEquals(result.confirmations, 13);
  assertEquals(result.transfers, [
    { from_address: expected.safeAddress, to_address: expected.sellerWallet, amount: "92.5" },
    { from_address: expected.safeAddress, to_address: expected.platformWallet, amount: "7.5" },
  ]);
});

Deno.test("wrong chain is rejected before receipt lookup", async () => {
  const { rpc, calls } = mockRpc({ chainId: "0x1" });
  await assertRejects(
    () => verifyBnbSafeReleaseReceipt(rpc, expected),
    BnbSafeReceiptVerificationError,
    "not BNB Chain",
  );
  assertEquals(calls, ["eth_chainId"]);
});

Deno.test("receipt block reorg or insufficient confirmations is rejected", async () => {
  const reorg = mockRpc({ canonicalHash: "0x" + "b".repeat(64) });
  await assertRejects(() => verifyBnbSafeReleaseReceipt(reorg.rpc, expected), BnbSafeReceiptVerificationError, "canonical");
  const pending = mockRpc({ head: "0x65" });
  await assertRejects(() => verifyBnbSafeReleaseReceipt(pending.rpc, expected), BnbSafeReceiptVerificationError, "confirmations");
});

Deno.test("Safe ExecutionFailure cannot authorize finalization", async () => {
  const failedLogs = [
    { ...receiptLogs[0], topics: [safeFailure, expected.safeTxHash] },
    ...receiptLogs.slice(1),
  ];
  const { rpc } = mockRpc({ receipt: { logs: failedLogs } });
  await assertRejects(() => verifyBnbSafeReleaseReceipt(rpc, expected), BnbSafeReceiptVerificationError, "ExecutionSuccess");
});

Deno.test("missing or duplicate Safe success event is rejected", async () => {
  const missing = mockRpc({ receipt: { logs: receiptLogs.slice(1) } });
  await assertRejects(() => verifyBnbSafeReleaseReceipt(missing.rpc, expected), BnbSafeReceiptVerificationError, "ExecutionSuccess");
  const duplicate = mockRpc({ receipt: { logs: [...receiptLogs, receiptLogs[0]] } });
  await assertRejects(() => verifyBnbSafeReleaseReceipt(duplicate.rpc, expected), BnbSafeReceiptVerificationError, "ExecutionSuccess");
});

Deno.test("Safe-originating transfer from another token contract is rejected", async () => {
  const changed = [
    receiptLogs[0],
    { ...receiptLogs[1], address: "0x" + "7".repeat(40) },
    receiptLogs[2],
  ];
  const { rpc } = mockRpc({ receipt: { logs: changed } });
  await assertRejects(() => verifyBnbSafeReleaseReceipt(rpc, expected), BnbSafeReceiptVerificationError, "unapproved token");
});

Deno.test("receipt with more than two Safe-originating transfers is rejected", async () => {
  const extra = {
    ...receiptLogs[2],
    logIndex: "0x3",
    topics: [transfer, wordAddress(expected.safeAddress), wordAddress("0x" + "8".repeat(40))],
  };
  const { rpc } = mockRpc({ receipt: { logs: [...receiptLogs, extra] } });
  await assertRejects(() => verifyBnbSafeReleaseReceipt(rpc, expected), BnbSafeReceiptVerificationError, "exactly two");
});
