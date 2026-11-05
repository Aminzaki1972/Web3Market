import { BnbRevenueAdapterError, verifyErc20Revenue, type JsonRpcClient } from "./bnb-revenue-adapter.ts";

const token = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const tx = "0x" + "a".repeat(64);
const blockHash = "0x" + "b".repeat(64);
const topic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const indexed = "0x" + recipient.slice(2).padStart(64, "0");
const log = {
  address: token,
  topics: [topic, "0x" + "3".repeat(64), indexed],
  data: "0x" + BigInt(2500000).toString(16).padStart(64, "0"),
  blockNumber: "0x64",
  blockHash,
  transactionHash: tx,
  logIndex: "0x0",
  removed: false,
};
const config = {
  expectedChainId: 56 as const,
  tokenAddress: token,
  revenueRecipients: [recipient],
  fromBlock: 100,
  toBlock: 110,
  minConfirmations: 5,
  maxBlockSpan: 100,
  declaredRevenueRaw: "2500000",
};

function mock(options: { head?: string; chain?: string; logs?: unknown[]; canonicalHash?: string; receiptStatus?: string } = {}): JsonRpcClient {
  return {
    async request<T>(method: string, params: unknown[]): Promise<T> {
      let value: unknown;
      if (method === "eth_chainId") value = options.chain ?? "0x38";
      else if (method === "eth_blockNumber") value = options.head ?? "0x70";
      else if (method === "eth_getLogs") value = options.logs ?? [log];
      else if (method === "eth_getTransactionReceipt") value = {
        transactionHash: tx, blockHash, blockNumber: "0x64", status: options.receiptStatus ?? "0x1",
      };
      else if (method === "eth_getBlockByNumber") value = { hash: options.canonicalHash ?? blockHash };
      else throw new Error("Unexpected RPC method");
      return value as T;
    },
  };
}

Deno.test("confirmed BNB token receipts match declared raw revenue", async () => {
  const result = await verifyErc20Revenue(mock(), config, "2026-11-05T20:00:00.000Z");
  if (result.status !== "PASS" || result.actualRevenueRaw !== "2500000" || result.receiptCount !== 1) {
    throw new Error("Expected exact confirmed revenue.");
  }
});

Deno.test("wrong chain is rejected", async () => {
  let rejected = false;
  try { await verifyErc20Revenue(mock({ chain: "0x61" }), config); }
  catch (error) { rejected = error instanceof BnbRevenueAdapterError; }
  if (!rejected) throw new Error("Wrong chain must be rejected.");
});

Deno.test("declared revenue mismatch blocks evidence", async () => {
  const result = await verifyErc20Revenue(mock(), { ...config, declaredRevenueRaw: "2500001" });
  if (result.status !== "BLOCKED") throw new Error("Revenue mismatch must block.");
});

Deno.test("unconfirmed receipt remains incomplete", async () => {
  const result = await verifyErc20Revenue(mock({ head: "0x65" }), config);
  if (result.status !== "INCOMPLETE" || result.pendingConfirmationCount !== 1) {
    throw new Error("Pending confirmations must remain incomplete.");
  }
});

Deno.test("canonical block mismatch blocks reorged evidence", async () => {
  const result = await verifyErc20Revenue(mock({ canonicalHash: "0x" + "c".repeat(64) }), config);
  if (result.status !== "BLOCKED" || !result.reasonCodes.includes("BLOCK_HASH_MISMATCH_REORG")) {
    throw new Error("Reorged evidence must be blocked.");
  }
});

Deno.test("failed receipt blocks evidence", async () => {
  const result = await verifyErc20Revenue(mock({ receiptStatus: "0x0" }), config);
  if (result.status !== "BLOCKED") throw new Error("Failed transaction must block.");
});

Deno.test("duplicate logs are counted once", async () => {
  const result = await verifyErc20Revenue(mock({ logs: [log, log] }), config);
  if (result.receiptCount !== 1 || result.actualRevenueRaw !== "2500000") {
    throw new Error("Duplicate logs must not double count.");
  }
});


Deno.test("excluded sender is not counted as project revenue", async () => {
  const result = await verifyErc20Revenue(
    mock(),
    { ...config, excludedSenders: ["0x3333333333333333333333333333333333333333"], declaredRevenueRaw: "0" },
  );
  if (result.status !== "PASS" || result.receiptCount !== 0 || result.actualRevenueRaw !== "0") {
    throw new Error("Excluded internal sender must not be counted.");
  }
});

Deno.test("removed logs block revenue evidence", async () => {
  const result = await verifyErc20Revenue(mock({ logs: [{ ...log, removed: true }] }), {
    ...config,
    declaredRevenueRaw: "0",
  });
  if (result.status !== "BLOCKED" || !result.reasonCodes.includes("REMOVED_LOG_REQUIRES_REVIEW")) {
    throw new Error("Removed logs must block evidence.");
  }
});

Deno.test("oversized block ranges are rejected", async () => {
  let rejected = false;
  try {
    await verifyErc20Revenue(mock(), { ...config, toBlock: 20000, maxBlockSpan: 20000 });
  } catch (error) {
    rejected = error instanceof BnbRevenueAdapterError;
  }
  if (!rejected) throw new Error("Oversized scans must be rejected.");
});

Deno.test("malformed transfer logs are rejected", async () => {
  let rejected = false;
  try {
    await verifyErc20Revenue(mock({ logs: [{ ...log, topics: [] }] }), config);
  } catch (error) {
    rejected = error instanceof BnbRevenueAdapterError;
  }
  if (!rejected) throw new Error("Malformed logs must be rejected.");
});
