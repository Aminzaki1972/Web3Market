import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  finalizeSafeExecutionAttempt,
  persistAcquisitionRegistryBatch,
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
