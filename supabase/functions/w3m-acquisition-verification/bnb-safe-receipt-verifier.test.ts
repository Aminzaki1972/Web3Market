import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { keccak_256 } from "jsr:@noble/hashes@1.7.1/sha3";
import {
  BnbSafeReceiptVerificationError,
  finalizeBnbSafeReleaseAfterRpcVerification,
  finalizeBnbSafeReleaseFromFreshSnapshot,
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
  packageIssuedAt: "2026-11-06T12:00:00.000Z",
  packageExpiresAt: "2026-11-06T12:02:00.000Z",
  acquisitionAttestation: {
    authorized: true,
    signature_valid: true,
    report_id: "report-1",
    report_version: 1,
    report_hash: "a".repeat(64),
    evidence_hash: "b".repeat(64),
    signer_key_id: "signer-1",
    terms_version_id: "terms-1",
    terms_version: 1,
    terms_hash: "c".repeat(64),
    recomputed_evidence_hash: "b".repeat(64),
  },
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
    data: wordUint(75n * 10n ** 17n),
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
  const blockTimestamp = overrides.blockTimestamp ?? "0x6aedc17c";
  const decimals = overrides.decimals ?? wordUint(18n);
  const rpc = {
    async request<T>(method: string, params: unknown[]): Promise<T> {
      calls.push(method);
      let value: unknown;
      if (method === "eth_chainId") value = chainId;
      else if (method === "eth_getTransactionReceipt") value = receipt;
      else if (method === "eth_blockNumber") value = head;
      else if (method === "eth_getBlockByNumber") value = { hash: canonicalHash, timestamp: blockTimestamp };
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
  assertEquals(result.block_timestamp, "2026-11-06T12:01:00.000Z");
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
    "not BNB Chain mainnet",
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

Deno.test("verified raw BNB receipt is required before atomic finalization RPC", async () => {
  const { rpc } = mockRpc();
  let calls = 0;
  const database = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls += 1;
      assertEquals(name, "w3m_finalize_safe_execution_attempt");
      assertEquals(args.p_attempt_id, expected.attemptId);
      return {
        data: {
          finalized: true,
          idempotent_replay: false,
          attempt_id: expected.attemptId,
          state: "CONFIRMED",
          broadcast_tx_hash: expected.broadcastTxHash,
        },
        error: null,
      };
    },
  };
  const result = await finalizeBnbSafeReleaseAfterRpcVerification(database, rpc, expected);
  assertEquals(result.state, "CONFIRMED");
  assertEquals(calls, 1);
});

Deno.test("wrong BNB chain blocks atomic finalization RPC", async () => {
  const { rpc } = mockRpc({ chainId: "0x1" });
  let calls = 0;
  const database = {
    async rpc() {
      calls += 1;
      return { data: {}, error: null };
    },
  };
  await assertRejects(
    () => finalizeBnbSafeReleaseAfterRpcVerification(database, rpc, expected),
    Error,
    "receipt verification unavailable",
  );
  assertEquals(calls, 0);
});

Deno.test("fresh acquisition bundle failure blocks BNB receipt read and finalization", async () => {
  const { rpc, calls: rpcCalls } = mockRpc();
  const snapshot = {
    attempt_id: expected.attemptId,
    deal_id: "deal-1",
    transaction_id: "tx-1",
    report_id: "report-1",
    safe_tx_hash: expected.safeTxHash,
    broadcast_tx_hash: expected.broadcastTxHash,
    chain_id: 56,
    safe_address: expected.safeAddress,
    token_contract: expected.tokenContract,
    seller_wallet: expected.sellerWallet,
    seller_net_amount: expected.sellerAmount,
    platform_wallet: expected.platformWallet,
    platform_fee: expected.platformFee,
    buyer_id: expected.actorId,
    seller_id: "seller-1",
    deal_status: "funded",
    policy_status: "locked",
    transaction_status: "submitted",
    attempt_state: "BROADCAST",
    package_actor_id: expected.actorId,
    package_hash: "c".repeat(64),
    package_issued_at: expected.packageIssuedAt,
    package_expires_at: expected.packageExpiresAt,
  };
  const calls: string[] = [];
  const database = {
    async rpc(name: string) {
      calls.push(name);
      if (name === "w3m_read_safe_finalization_snapshot") return { data: snapshot, error: null };
      if (name === "w3m_read_safe_finalization_acquisition_bundle") {
        return { data: null, error: new Error("acquisition bundle unavailable") };
      }
      throw new Error("Unexpected database RPC");
    },
  };
  await assertRejects(
    () => finalizeBnbSafeReleaseFromFreshSnapshot(
      database,
      rpc,
      { attemptId: expected.attemptId, actorId: expected.actorId, minConfirmations: 6 },
    ),
    Error,
    "acquisition finalization bundle read failed",
  );
  assertEquals(calls, [
    "w3m_read_safe_finalization_snapshot",
    "w3m_read_safe_finalization_acquisition_bundle",
  ]);
  assertEquals(rpcCalls.length, 0);
});

Deno.test("missing fresh snapshot blocks BNB receipt read and finalization", async () => {
  const { rpc, calls: rpcCalls } = mockRpc();
  let databaseCalls = 0;
  const database = {
    async rpc() {
      databaseCalls += 1;
      return { data: null, error: new Error("snapshot unavailable") };
    },
  };
  await assertRejects(
    () => finalizeBnbSafeReleaseFromFreshSnapshot(
      database,
      rpc,
      { attemptId: expected.attemptId, actorId: expected.actorId, minConfirmations: 6 },
    ),
    Error,
    "snapshot read failed",
  );
  assertEquals(databaseCalls, 1);
  assertEquals(rpcCalls.length, 0);
});


Deno.test("raw receipt timestamp outside the stored wallet package window is rejected", async () => {
  const early = mockRpc({ blockTimestamp: "0x6aedc0f0" });
  await assertRejects(
    () => verifyBnbSafeReleaseReceipt(early.rpc, expected),
    BnbSafeReceiptVerificationError,
    "outside the issued W3M wallet package window",
  );
});
