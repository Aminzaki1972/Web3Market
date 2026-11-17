import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { commitAtomicSafePrepare, type AtomicSafePrepareInput } from "./atomic-safe-prepare-rpc-adapter.ts";
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";

const input: AtomicSafePrepareInput = {
  dealId: "82000000-0000-4000-8000-000000000001",
  actorId: "82000000-0000-4000-8000-000000000002",
  authorization: {
    decision: "PASS", dealId: "82000000-0000-4000-8000-000000000001",
    reportId: "report-verified-1", reportVersion: 3,
    reportHash: "b".repeat(64), dealTermsHash: "c".repeat(64),
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
  policy: {
    dealAmount: "100", feePercent: "7.5", feeAmount: "7.5", sellerNetAmount: "92.5",
    sellerWallet: "0x2222222222222222222222222222222222222222",
    platformWallet: "0x2B15cC63eE3b833F502C065767695Fa2B584f8c9",
    safeAddress: "0x4444444444444444444444444444444444444444",
    tokenContract: "0x55d398326f99059ff775485246999027b3197955",
    tokenSymbol: "USDT", chainId: 56,
  },
  safeFacts: {
    chainId: 56, threshold: 2, nonce: "7", blockNumber: "0x55d4a80",
    blockHash: "0x" + "a".repeat(64),
    safeAddress: "0x4444444444444444444444444444444444444444",
    owners: [
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
      "0x2B15cC63eE3b833F502C065767695Fa2B584f8c9",
    ],
  },
};

Deno.test("atomic PREPARE adapter sends only allowlisted normalized server fields", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client: W3MRpcClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: {
        committed: true, idempotent_replay: false,
        policy_id: "82000000-0000-4000-8000-000000000010",
        transaction_id: "82000000-0000-4000-8000-000000000011",
        status: "awaiting_signatures",
      }, error: null };
    },
  };
  const result = await commitAtomicSafePrepare(client, input);
  assertEquals(result, {
    policyId: "82000000-0000-4000-8000-000000000010",
    transactionId: "82000000-0000-4000-8000-000000000011",
    status: "awaiting_signatures", idempotentReplay: false,
  });
  assertEquals(calls[0]?.name, "w3m_commit_safe_prepare");
  assertEquals(calls[0]?.args.p_deal_id, input.dealId);
  const call = calls[0];
  if (!call) throw new Error("Expected one atomic PREPARE RPC call.");
  const facts = call.args.p_safe_facts as Record<string, unknown>;
  assertEquals(facts.block_number, BigInt(input.safeFacts.blockNumber).toString());
  assertEquals(facts.owners, input.safeFacts.owners.map((owner) => owner.toLowerCase()));
  const policy = call.args.p_policy as Record<string, unknown>;
  assertEquals(Object.keys(policy).sort(), [
    "chain_id", "deal_amount", "fee_amount", "fee_percent", "platform_wallet",
    "safe_address", "seller_net_amount", "seller_wallet", "status", "token_contract", "token_symbol",
  ].sort());
});

Deno.test("atomic PREPARE adapter rejects untrusted or malformed bindings before RPC", async () => {
  let calls = 0;
  const client: W3MRpcClient = {
    async rpc() { calls++; return { data: null, error: null }; },
  };
  await assertRejects(() => commitAtomicSafePrepare(client, {
    ...input, authorization: { ...input.authorization, dealId: "82000000-0000-4000-8000-000000000099" },
  }));
  await assertRejects(() => commitAtomicSafePrepare(client, {
    ...input, authorization: { ...input.authorization, reportHash: "not-a-hash" },
  }));
  await assertRejects(() => commitAtomicSafePrepare(client, {
    ...input, safeFacts: { ...input.safeFacts, threshold: 3 } as unknown as AtomicSafePrepareInput["safeFacts"],
  }));
  await assertRejects(() => commitAtomicSafePrepare(client, {
    ...input, policy: { ...input.policy, feePercent: "8", feeAmount: "8", sellerNetAmount: "92" },
  }));
  await assertRejects(() => commitAtomicSafePrepare(client, {
    ...input, policy: { ...input.policy, tokenContract: "0x" + "9".repeat(40) },
  }));
  assertEquals(calls, 0);
});

Deno.test("atomic PREPARE adapter fails closed on RPC errors and malformed results", async () => {
  const errorClient: W3MRpcClient = {
    async rpc() { return { data: null, error: new Error("database unavailable") }; },
  };
  await assertRejects(() => commitAtomicSafePrepare(errorClient, input));
  const malformedClient: W3MRpcClient = {
    async rpc() { return { data: { committed: true, idempotent_replay: false }, error: null }; },
  };
  await assertRejects(() => commitAtomicSafePrepare(malformedClient, input));
});
