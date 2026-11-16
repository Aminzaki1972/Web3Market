// W3M Protocol V1 — service-role adapter for the server-authorized immutable decision RPC.
import {
  parseW3MDisputeDecisionCommand,
  type W3MDisputeDecisionCommand,
  type W3MDisputeOutcome,
} from "./dispute-decision.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/i;

export interface W3MDisputeDecisionRpcClient {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

export interface PersistW3MDisputeDecisionInput {
  command: unknown;
  actorId: string;
}

export interface PersistedW3MDisputeDecision {
  decisionId: string;
  decisionHash: string;
  outcome: W3MDisputeOutcome;
  disputeRecordStatus: "resolved";
  dealDisputeStatus: "resolved_buyer" | "resolved_seller";
  dealStatus: "disputed";
  idempotentReplay: boolean;
  buyerRefundAmount: string | null;
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("W3M dispute decision RPC returned a malformed result.");
  }
  return value as Record<string, unknown>;
}

export async function persistW3MDisputeDecision(
  client: W3MDisputeDecisionRpcClient,
  input: PersistW3MDisputeDecisionInput,
): Promise<PersistedW3MDisputeDecision> {
  if (typeof input.actorId !== "string" || !UUID.test(input.actorId)) {
    throw new Error("Verified decision-maker identity is required.");
  }
  const command: W3MDisputeDecisionCommand = parseW3MDisputeDecisionCommand(input.command);
  const { data, error } = await client.rpc("w3m_admin_decide_deal_dispute", {
    p_deal_id: command.dealId,
    p_dispute_id: command.disputeId,
    p_outcome: command.outcome,
    p_reason: command.reason,
    p_evidence_refs: command.evidenceRefs,
    p_buyer_refund_amount: command.buyerRefundAmount ?? null,
    p_actor_id: input.actorId.toLowerCase(),
  });
  if (error) throw new Error("W3M dispute decision could not be persisted.");
  const row = object(data);
  const decisionId = row.decision_id;
  const decisionHash = row.decision_hash;
  const dealDisputeStatus = command.outcome === "buyer_wins" ? "resolved_buyer" : "resolved_seller";
  if (typeof decisionId !== "string" || !UUID.test(decisionId) ||
      typeof decisionHash !== "string" || !HASH.test(decisionHash) ||
      row.outcome !== command.outcome ||
      row.dispute_record_status !== "resolved" ||
      row.deal_dispute_status !== dealDisputeStatus ||
      row.deal_status !== "disputed" ||
      typeof row.idempotent_replay !== "boolean") {
    throw new Error("W3M dispute decision RPC returned a mismatched state or decision binding.");
  }
  return {
    decisionId: decisionId.toLowerCase(),
    decisionHash: decisionHash.toLowerCase(),
    outcome: command.outcome,
    disputeRecordStatus: "resolved",
    dealDisputeStatus,
    dealStatus: "disputed",
    idempotentReplay: row.idempotent_replay,
    buyerRefundAmount: command.buyerRefundAmount ?? null,
  };
}
