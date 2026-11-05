// W3M Protocol V1 — server-only Supabase RPC boundary.
// This adapter accepts already-verified protocol outputs. It does not create
// evidence, sign reports, verify BNB receipts, or expose browser authorization.

import type { RegistryBatch } from "./report-registry-batch.ts";

export interface W3MRpcClient {
  rpc(name: string, args: Record<string, unknown>): Promise<{
    data: unknown;
    error: unknown;
  }>;
}

export interface RegistryPersistenceResult {
  reportId: string;
  evidenceRows: number;
  eventRows: number;
  atomic: true;
}

export interface SafeFinalizationRpcInput {
  attemptId: string;
  broadcastTxHash: string;
  actorId: string;
  /** Must be constructed only after independent BNB receipt and log verification. */
  receiptEvidence: Record<string, unknown>;
}

export interface SafeFinalizationRpcResult {
  attemptId: string;
  broadcastTxHash: string;
  state: "CONFIRMED";
  idempotentReplay: boolean;
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label + " RPC returned a malformed response.");
  }
  return value as Record<string, unknown>;
}

function requireText(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(label + " is required.");
  }
}

export async function persistAcquisitionRegistryBatch(
  client: W3MRpcClient,
  batch: RegistryBatch,
): Promise<RegistryPersistenceResult> {
  const { data, error } = await client.rpc("w3m_insert_acquisition_registry_batch", {
    p_report: batch.report,
    p_evidence: batch.evidence,
    p_events: batch.events,
  });
  if (error) throw new Error("W3M registry batch persistence failed.");
  const result = asObject(data, "Registry persistence");
  const expectedEvents = batch.events.length;
  if (result.atomic !== true ||
      result.report_id !== batch.report.id ||
      result.evidence_rows !== batch.evidence.length ||
      result.event_rows !== expectedEvents) {
    throw new Error("W3M registry RPC response does not match the submitted batch.");
  }
  return {
    reportId: batch.report.id,
    evidenceRows: batch.evidence.length,
    eventRows: expectedEvents,
    atomic: true,
  };
}

export async function finalizeSafeExecutionAttempt(
  client: W3MRpcClient,
  input: SafeFinalizationRpcInput,
): Promise<SafeFinalizationRpcResult> {
  requireText(input.attemptId, "Execution attempt ID");
  requireText(input.broadcastTxHash, "Broadcast transaction hash");
  requireText(input.actorId, "Finalization actor ID");
  if (!/^0x[0-9a-f]{64}$/i.test(input.broadcastTxHash)) {
    throw new Error("Broadcast transaction hash must be a 32-byte hex hash.");
  }
  const { data, error } = await client.rpc("w3m_finalize_safe_execution_attempt", {
    p_attempt_id: input.attemptId,
    p_broadcast_tx_hash: input.broadcastTxHash,
    p_actor_id: input.actorId,
    p_receipt_evidence: input.receiptEvidence,
  });
  if (error) throw new Error("W3M Safe finalization RPC failed.");
  const result = asObject(data, "Safe finalization");
  if (result.finalized !== true ||
      result.attempt_id !== input.attemptId ||
      result.state !== "CONFIRMED" ||
      typeof result.idempotent_replay !== "boolean" ||
      typeof result.broadcast_tx_hash !== "string" ||
      result.broadcast_tx_hash.toLowerCase() !== input.broadcastTxHash.toLowerCase()) {
    throw new Error("W3M Safe finalization response does not match the requested attempt.");
  }
  return {
    attemptId: input.attemptId,
    broadcastTxHash: input.broadcastTxHash,
    state: "CONFIRMED",
    idempotentReplay: result.idempotent_replay,
  };
}


export interface SafeExecutionClaimInput {
  dealId: string;
  transactionId: string;
  reportId: string;
  safeTxHash: string;
  executorRef: string;
  idempotencyKey: string;
}

export interface SafeExecutionClaimResult {
  attemptId: string;
  state: "CLAIMED" | "BROADCAST" | "RECONCILIATION_REQUIRED";
  claimed: boolean;
  idempotentReplay: boolean;
}

export async function claimSafeExecutionAttempt(
  client: W3MRpcClient,
  input: SafeExecutionClaimInput,
): Promise<SafeExecutionClaimResult> {
  requireText(input.dealId, "Deal ID");
  requireText(input.transactionId, "Safe transaction ID");
  requireText(input.reportId, "W3M report ID");
  requireText(input.executorRef, "Executor reference");
  requireText(input.idempotencyKey, "Idempotency key");
  if (!/^0x[0-9a-f]{64}$/i.test(input.safeTxHash)) {
    throw new Error("Safe transaction hash must be a 32-byte hex hash.");
  }
  const { data, error } = await client.rpc("w3m_claim_safe_execution_attempt", {
    p_deal_id: input.dealId,
    p_transaction_id: input.transactionId,
    p_report_id: input.reportId,
    p_safe_tx_hash: input.safeTxHash,
    p_executor_ref: input.executorRef,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) throw new Error("W3M Safe execution claim failed.");
  const result = asObject(data, "Safe execution claim");
  const state = result.state;
  if (typeof result.attempt_id !== "string" ||
      typeof result.claimed !== "boolean" ||
      typeof result.idempotent_replay !== "boolean" ||
      (state !== "CLAIMED" && state !== "BROADCAST" && state !== "RECONCILIATION_REQUIRED")) {
    throw new Error("W3M Safe execution claim returned an invalid result.");
  }
  return {
    attemptId: result.attempt_id,
    state,
    claimed: result.claimed,
    idempotentReplay: result.idempotent_replay,
  };
}

export async function recordSafeExecutionBroadcast(
  client: W3MRpcClient,
  attemptId: string,
  broadcastTxHash: string,
): Promise<{ recorded: true; idempotentReplay: boolean; state: "BROADCAST" | "RECONCILIATION_REQUIRED" }> {
  requireText(attemptId, "Execution attempt ID");
  if (!/^0x[0-9a-f]{64}$/i.test(broadcastTxHash)) {
    throw new Error("Broadcast transaction hash must be a 32-byte hex hash.");
  }
  const { data, error } = await client.rpc("w3m_record_safe_execution_broadcast", {
    p_attempt_id: attemptId,
    p_broadcast_tx_hash: broadcastTxHash,
  });
  if (error) throw new Error("W3M broadcast hash recording failed.");
  const result = asObject(data, "Broadcast recording");
  if (result.recorded !== true ||
      typeof result.idempotent_replay !== "boolean" ||
      (result.state !== "BROADCAST" && result.state !== "RECONCILIATION_REQUIRED")) {
    throw new Error("W3M broadcast recording returned an invalid result.");
  }
  return {
    recorded: true,
    idempotentReplay: result.idempotent_replay,
    state: result.state,
  };
}

export async function markSafeExecutionReconciliationRequired(
  client: W3MRpcClient,
  attemptId: string,
  errorCode: string,
): Promise<{ updated: true; idempotentReplay: boolean; state: "RECONCILIATION_REQUIRED" }> {
  requireText(attemptId, "Execution attempt ID");
  requireText(errorCode, "Reconciliation error code");
  if (errorCode.length > 100) throw new Error("Reconciliation error code is too long.");
  const { data, error } = await client.rpc("w3m_mark_safe_execution_reconciliation_required", {
    p_attempt_id: attemptId,
    p_error_code: errorCode,
  });
  if (error) throw new Error("W3M reconciliation transition failed.");
  const result = asObject(data, "Reconciliation transition");
  if (result.updated !== true ||
      typeof result.idempotent_replay !== "boolean" ||
      result.state !== "RECONCILIATION_REQUIRED") {
    throw new Error("W3M reconciliation transition returned an invalid result.");
  }
  return {
    updated: true,
    idempotentReplay: result.idempotent_replay,
    state: "RECONCILIATION_REQUIRED",
  };
}
