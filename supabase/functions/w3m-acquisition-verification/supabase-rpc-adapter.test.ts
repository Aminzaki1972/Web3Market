import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  claimSafeExecutionAttempt,
  finalizeSafeExecutionAttempt,
  issueSafeWalletExecutionPackage,
  markSafeExecutionReconciliationRequired,
  persistAcquisitionRegistryBatch,
  recordSafeExecutionBroadcast,
  type W3MRpcClient,
} from "./supabase-rpc-adapter.ts";
import type { RegistryBatch } from "./report-registry-batch.ts";

Deno.test("registry persistence sends the signed batch to the atomic RPC", async () => {
  const captured: { name: string; args: Record<string, unknown> }[] = [];
  const client: W3MRpcClient = {
    async rpc(name, args) {
      captured.push({ name, args });
      return {
        data: { report_id: "report-1", evidence_rows: 2, event_rows: 3, atomic: true },
        error: null,
      };
    },
  };
  const batch = {
    report: { id: "report-1" },
    evidence: [{ id: "e1" }, { id: "e2" }],
    events: [{ id: "v1" }, { id: "v2" }, { id: "v3" }],
  } as unknown as RegistryBatch;
  const result = await persistAcquisitionRegistryBatch(client, batch);
  assertEquals(result, { reportId: "report-1", evidenceRows: 2, eventRows: 3, atomic: true });
  assertEquals(captured[0]?.name, "w3m_insert_acquisition_registry_batch");
  assertEquals(captured[0]?.args.p_report, batch.report);
});

Deno.test("registry persistence rejects a non-matching RPC response", async () => {
  const client: W3MRpcClient = {
    async rpc() {
      return { data: { report_id: "other", evidence_rows: 2, event_rows: 3, atomic: true }, error: null };
    },
  };
  await assertRejects(() => persistAcquisitionRegistryBatch(client, {
    report: { id: "report-1" }, evidence: [{ id: "e1" }, { id: "e2" }],
    events: [{ id: "v1" }, { id: "v2" }, { id: "v3" }],
  } as never));
});

Deno.test("finalization RPC binds the result to the exact attempt and broadcast hash", async () => {
  const captured: { name: string; args: Record<string, unknown> }[] = [];
  const client: W3MRpcClient = {
    async rpc(name, args) {
      captured.push({ name, args });
      return {
        data: {
          finalized: true, idempotent_replay: false, attempt_id: "attempt-1",
          state: "CONFIRMED", broadcast_tx_hash: "0x" + "b".repeat(64),
        },
        error: null,
      };
    },
  };
  const input = {
    attemptId: "attempt-1",
    broadcastTxHash: "0x" + "b".repeat(64),
    actorId: "buyer-1",
    receiptEvidence: { chain_id: 56 },
  };
  const result = await finalizeSafeExecutionAttempt(client, input);
  assertEquals(result, {
    attemptId: "attempt-1", broadcastTxHash: input.broadcastTxHash,
    state: "CONFIRMED", idempotentReplay: false,
  });
  assertEquals(captured[0]?.name, "w3m_finalize_safe_execution_attempt");
  assertEquals(captured[0]?.args.p_attempt_id, "attempt-1");
});

Deno.test("finalization RPC rejects malformed hashes and mismatched attempt responses", async () => {
  let calls = 0;
  const client: W3MRpcClient = {
    async rpc() {
      calls++;
      return {
        data: {
          finalized: true, idempotent_replay: false, attempt_id: "other",
          state: "CONFIRMED", broadcast_tx_hash: "0x" + "b".repeat(64),
        },
        error: null,
      };
    },
  };
  await assertRejects(() => finalizeSafeExecutionAttempt(client, {
    attemptId: "attempt-1", broadcastTxHash: "bad", actorId: "buyer-1", receiptEvidence: {},
  }));
  assertEquals(calls, 0);
  await assertRejects(() => finalizeSafeExecutionAttempt(client, {
    attemptId: "attempt-1", broadcastTxHash: "0x" + "b".repeat(64),
    actorId: "buyer-1", receiptEvidence: {},
  }));
});


Deno.test("execution claim, broadcast recording, and reconciliation use their server-only RPCs", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client: W3MRpcClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "w3m_claim_safe_execution_attempt") {
        return { data: {
          attempt_id: "attempt-2", state: "CLAIMED", claimed: true, idempotent_replay: false,
        }, error: null };
      }
      if (name === "w3m_record_safe_execution_broadcast") {
        return { data: {
          recorded: true, idempotent_replay: false, state: "RECONCILIATION_REQUIRED",
        }, error: null };
      }
      return { data: {
        updated: true, idempotent_replay: false, state: "RECONCILIATION_REQUIRED",
      }, error: null };
    },
  };
  const hash = "0x" + "c".repeat(64);
  const claim = await claimSafeExecutionAttempt(client, {
    dealId: "deal-2", transactionId: "tx-2", reportId: "report-2",
    safeTxHash: hash, executorRef: "isolated-executor",
    idempotencyKey: "idempotency-key-for-test-0002",
  });
  assertEquals(claim, {
    attemptId: "attempt-2", state: "CLAIMED", claimed: true, idempotentReplay: false,
  });
  const broadcast = await recordSafeExecutionBroadcast(client, "attempt-2", hash);
  assertEquals(broadcast, {
    recorded: true, idempotentReplay: false, state: "RECONCILIATION_REQUIRED",
  });
  const reconciliation = await markSafeExecutionReconciliationRequired(
    client, "attempt-2", "RPC_TIMEOUT_UNCERTAIN",
  );
  assertEquals(reconciliation, {
    updated: true, idempotentReplay: false, state: "RECONCILIATION_REQUIRED",
  });
  assertEquals(calls.map((call) => call.name), [
    "w3m_claim_safe_execution_attempt",
    "w3m_record_safe_execution_broadcast",
    "w3m_mark_safe_execution_reconciliation_required",
  ]);
  assertEquals(calls[0].args.p_deal_id, "deal-2");
  assertEquals(calls[1].args.p_broadcast_tx_hash, hash);
});

Deno.test("execution claim rejects malformed Safe transaction hashes before RPC", async () => {
  let calls = 0;
  const client: W3MRpcClient = {
    async rpc() { calls++; return { data: null, error: null }; },
  };
  await assertRejects(() => claimSafeExecutionAttempt(client, {
    dealId: "deal-2", transactionId: "tx-2", reportId: "report-2",
    safeTxHash: "bad", executorRef: "isolated-executor",
    idempotencyKey: "idempotency-key-for-test-0002",
  }));
  assertEquals(calls, 0);
});


Deno.test("wallet package issuance persists the exact actor, package hash, and expiry", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const actorId = "23000000-0000-4000-8000-000000000003";
  const attemptId = "24000000-0000-4000-8000-000000000004";
  const packageHash = "c".repeat(64);
  const expiresAt = "2026-11-06T23:59:00.000Z";
  const pkg = { protocol: "W3M_PROTOCOL_V1", expiresAt, dealId: "deal-1" };
  const client: W3MRpcClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: {
        issued: true, idempotent_replay: false, attempt_id: attemptId,
        package_hash: String(args.p_package_hash), expires_at: expiresAt, package: pkg,
      }, error: null };
    },
  };
  const result = await issueSafeWalletExecutionPackage(client, {
    attemptId, actorId, packageHash, package: pkg, expiresAt,
  });
  assertEquals(result, {
    attemptId, packageHash, expiresAt, package: pkg, idempotentReplay: false,
  });
  assertEquals(calls[0]?.name, "w3m_issue_safe_execution_package");
  assertEquals(calls[0]?.args.p_actor_id, actorId);
  assertEquals(calls[0]?.args.p_package_hash, packageHash);
});

Deno.test("wallet package issuance rejects mismatched or malformed values before RPC", async () => {
  let calls = 0;
  const client: W3MRpcClient = {
    async rpc() {
      calls++;
      return { data: null, error: null };
    },
  };
  await assertRejects(() => issueSafeWalletExecutionPackage(client, {
    attemptId: "attempt-1", actorId: "not-a-uuid", packageHash: "x".repeat(64),
    package: { protocol: "W3M_PROTOCOL_V1" }, expiresAt: "not-a-date",
  }));
  assertEquals(calls, 0);
});
