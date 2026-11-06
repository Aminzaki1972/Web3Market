import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { loadSafeFinalizationExpectation } from "./safe-finalization-snapshot-adapter.ts";

const row = {
  attempt_id: "attempt-1",
  deal_id: "deal-1",
  transaction_id: "tx-1",
  report_id: "report-1",
  safe_tx_hash: "0x" + "a".repeat(64),
  broadcast_tx_hash: "0x" + "b".repeat(64),
  chain_id: 56,
  safe_address: "0x" + "1".repeat(40),
  token_contract: "0x" + "2".repeat(40),
  seller_wallet: "0x" + "3".repeat(40),
  seller_net_amount: "92.50000000",
  platform_wallet: "0x" + "4".repeat(40),
  platform_fee: "7.50000000",
  buyer_id: "buyer-1",
  seller_id: "seller-1",
  deal_status: "funded",
  policy_status: "locked",
  transaction_status: "submitted",
  attempt_state: "BROADCAST",
};
function client(data: unknown = row, error: unknown = null) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data, error };
    },
  };
}

Deno.test("loads exact server snapshot and preserves financial decimals as strings", async () => {
  const db = client();
  const result = await loadSafeFinalizationExpectation(db, {
    attemptId: "attempt-1",
    actorId: "buyer-1",
    minConfirmations: 12,
  });
  assertEquals(result.sellerAmount, "92.50000000");
  assertEquals(result.platformFee, "7.50000000");
  assertEquals(result.broadcastTxHash, row.broadcast_tx_hash);
  assertEquals(result.minConfirmations, 12);
  assertEquals(db.calls, [{
    name: "w3m_read_safe_finalization_snapshot",
    args: { p_attempt_id: "attempt-1" },
  }]);
});

Deno.test("seller participant is also permitted as finalization actor", async () => {
  const result = await loadSafeFinalizationExpectation(client(), {
    attemptId: "attempt-1",
    actorId: "seller-1",
    minConfirmations: 6,
  });
  assertEquals(result.actorId, "seller-1");
});

Deno.test("rejects actor who is not a participant", async () => {
  await assertRejects(
    () => loadSafeFinalizationExpectation(client(), {
      attemptId: "attempt-1",
      actorId: "intruder",
      minConfirmations: 6,
    }),
    Error,
    "not a deal participant",
  );
});

Deno.test("rejects numeric financial fields rather than rounding through JS numbers", async () => {
  await assertRejects(
    () => loadSafeFinalizationExpectation(client({ ...row, seller_net_amount: 92.5 }), {
      attemptId: "attempt-1",
      actorId: "buyer-1",
      minConfirmations: 6,
    }),
    Error,
    "decimal is invalid",
  );
});

Deno.test("rejects chain, state, attempt, and wallet binding mismatches", async () => {
  for (const changed of [
    { ...row, chain_id: 1 },
    { ...row, attempt_state: "CLAIMED" },
    { ...row, attempt_id: "another-attempt" },
    { ...row, platform_wallet: row.seller_wallet },
  ]) {
    await assertRejects(
      () => loadSafeFinalizationExpectation(client(changed), {
        attemptId: "attempt-1",
        actorId: "buyer-1",
        minConfirmations: 6,
      }),
      Error,
    );
  }
});

Deno.test("RPC errors and malformed snapshots fail closed", async () => {
  await assertRejects(
    () => loadSafeFinalizationExpectation(client(null, new Error("db offline")), {
      attemptId: "attempt-1",
      actorId: "buyer-1",
      minConfirmations: 6,
    }),
    Error,
    "snapshot read failed",
  );
  await assertRejects(
    () => loadSafeFinalizationExpectation(client([]), {
      attemptId: "attempt-1",
      actorId: "buyer-1",
      minConfirmations: 6,
    }),
    Error,
    "malformed",
  );
});
