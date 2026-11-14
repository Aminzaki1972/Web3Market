/**
 * Pure dispute lifecycle rules for sandbox simulation only.
 * No notices are sent, deadlines are scheduled, decisions are adjudicated,
 * Safe transactions are built, or chain receipts are queried by this module.
 */
import { validateDisputeAllocation } from "./core.ts";

export type DisputeParty = "buyer" | "seller";
export type DisputeStatus =
  | "claimant_evidence" | "awaiting_respondent" | "response_received"
  | "response_expired" | "decided" | "execution_pending" | "executed";

export type DisputeEvidence = {
  id: string;
  submittedBy: DisputeParty;
  description: string;
  submittedAt: number;
};

export type DisputeAllocation = {
  buyerRefund: bigint;
  sellerPayout: bigint;
  platformFee: bigint;
};

export type DisputeCase = {
  id: string;
  claimant: DisputeParty;
  respondent: DisputeParty;
  openedAt: number;
  responseDeadline: number;
  status: DisputeStatus;
  evidence: DisputeEvidence[];
  decision: null | { reason: string; allocation: DisputeAllocation; decidedAt: number };
  execution: null | { txHash: string; confirmedAt: number };
};

export function openDispute(
  id: string, claimant: DisputeParty, now: number, responseWindowMs: number,
): DisputeCase {
  if (!id.trim() || !Number.isFinite(now) || !Number.isFinite(responseWindowMs) || responseWindowMs <= 0) {
    throw new Error("Dispute ID, opening time and positive response window are required");
  }
  return {
    id, claimant, respondent: claimant === "buyer" ? "seller" : "buyer",
    openedAt: now, responseDeadline: now + responseWindowMs,
    status: "claimant_evidence", evidence: [], decision: null, execution: null,
  };
}

export function submitClaimantEvidence(
  dispute: DisputeCase, actor: DisputeParty, evidence: DisputeEvidence,
): DisputeCase {
  if (dispute.status !== "claimant_evidence" || actor !== dispute.claimant ||
      evidence.submittedBy !== actor || !evidence.id.trim() || !evidence.description.trim()) {
    throw new Error("Only the claimant may submit the initial evidence package");
  }
  return { ...dispute, evidence: [...dispute.evidence, evidence], status: "awaiting_respondent" };
}

export function submitRespondentResponse(
  dispute: DisputeCase, actor: DisputeParty, evidence: DisputeEvidence, now: number,
): DisputeCase {
  if (dispute.status !== "awaiting_respondent" || actor !== dispute.respondent ||
      evidence.submittedBy !== actor || !evidence.id.trim() || !evidence.description.trim()) {
    throw new Error("Respondent response is not currently permitted");
  }
  if (!Number.isFinite(now) || now > dispute.responseDeadline || evidence.submittedAt > dispute.responseDeadline) {
    throw new Error("Response deadline has passed");
  }
  return { ...dispute, evidence: [...dispute.evidence, evidence], status: "response_received" };
}

export function markResponseExpired(dispute: DisputeCase, now: number): DisputeCase {
  if (dispute.status !== "awaiting_respondent" || now < dispute.responseDeadline) {
    throw new Error("Response period has not expired or dispute is not awaiting a response");
  }
  return { ...dispute, status: "response_expired" };
}

/** Platform decision is recorded once, with reasons and a fully reconciled allocation. */
export function issueDisputeDecision(
  dispute: DisputeCase, reason: string, allocation: DisputeAllocation, totalDeposited: bigint, now: number,
): DisputeCase {
  if (!["response_received", "response_expired"].includes(dispute.status) ||
      !reason.trim() || !Number.isFinite(now) ||
      !validateDisputeAllocation(totalDeposited, allocation)) {
    throw new Error("Decision requires a completed response phase, reasons and balanced allocation");
  }
  return {
    ...dispute, status: "decided",
    decision: { reason, allocation, decidedAt: now },
  };
}

export function markDisputeExecutionPending(dispute: DisputeCase): DisputeCase {
  if (dispute.status !== "decided" || !dispute.decision) {
    throw new Error("A recorded decision is required before Safe execution");
  }
  return { ...dispute, status: "execution_pending" };
}

/** Completion requires independently verified Safe execution evidence from a trusted adapter. */
export function confirmDisputeExecution(
  dispute: DisputeCase, txHash: string, receiptConfirmed: boolean, now: number,
): DisputeCase {
  if (dispute.status !== "execution_pending" || !/^0x[0-9a-fA-F]{64}$/.test(txHash) ||
      !receiptConfirmed || !Number.isFinite(now)) {
    throw new Error("Confirmed Safe execution receipt is required");
  }
  return { ...dispute, status: "executed", execution: { txHash: txHash.toLowerCase(), confirmedAt: now } };
}
