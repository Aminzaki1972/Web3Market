// W3M Protocol V1 — fail-closed EXECUTE orchestration.
// This coordinator never signs or broadcasts by itself. A trusted Edge adapter
// supplies fresh database/Safe facts and the protected broadcast callback.
// Replays and uncertain outcomes are never allowed to trigger a second send.

import {
  evaluateSafeExecutionGuard,
  type SafeExecutionGuardInput,
} from "./safe-execution-guard.ts";
import type { SafeDigestSignatureVerifier } from "./safe-signature-set-validator.ts";
import type { SafeExecutionClaimResult } from "./supabase-rpc-adapter.ts";

export interface SafeExecutionFreshSnapshot {
  dealId: string;
  transactionId: string;
  reportId: string;
  reportVersion: number;
  executorRef: string;
  idempotencyKey: string;
  /** Immutable, signature-verified EIP-712 consent for the exact current terms.
   * The loader must populate this only from loadSafeExecutionDatabaseSnapshot,
   * which independently recovers both party signatures against current wallets.
   */
  agreementBinding: {
    termsVersionId: string;
    termsVersion: string;
    termsHash: string;
    buyerAcceptanceId: string;
    sellerAcceptanceId: string;
    buyerDigest: string;
    sellerDigest: string;
  };
  guardInput: SafeExecutionGuardInput;
}

export interface SafeExecutionCoordinatorDependencies {
  loadFresh(): Promise<SafeExecutionFreshSnapshot>;
  claim(input: {
    dealId: string;
    transactionId: string;
    reportId: string;
    safeTxHash: string;
    executorRef: string;
    idempotencyKey: string;
  }): Promise<SafeExecutionClaimResult>;
  broadcast(input: {
    attemptId: string;
    snapshot: SafeExecutionFreshSnapshot;
  }): Promise<{ transactionHash: string }>;
  recordBroadcast(attemptId: string, transactionHash: string): Promise<{
    recorded: boolean;
    idempotentReplay: boolean;
    state: "BROADCAST" | "RECONCILIATION_REQUIRED";
  }>;
  markReconciliationRequired(attemptId: string, code: string): Promise<{
    updated: boolean;
    idempotentReplay: boolean;
    state: "RECONCILIATION_REQUIRED";
  }>;
  verifySignature?: SafeDigestSignatureVerifier;
}

export type SafeExecutionCoordinatorResult =
  | { state: "BLOCKED"; issues: string[] }
  | { state: "RECONCILIATION_REQUIRED"; attemptId: string; reason: string; reconciliationRecorded: boolean }
  | { state: "BROADCAST_RECORDED"; attemptId: string; transactionHash: string };

const HASH = /^0x[0-9a-fA-F]{64}$/i;

function safeHash(snapshot: SafeExecutionFreshSnapshot): string {
  return snapshot?.guardInput?.recomputedSafeTransactionHash ?? "";
}

function snapshotIssues(snapshot: SafeExecutionFreshSnapshot): string[] {
  const issues: string[] = [];
  if (!snapshot || typeof snapshot !== "object") return ["FRESH_EXECUTION_SNAPSHOT_MISSING"];
  if (!snapshot.dealId?.trim() || snapshot.guardInput?.settlement?.dealId !== snapshot.dealId) {
    issues.push("FRESH_DEAL_BINDING_INVALID");
  }
  if (!snapshot.transactionId?.trim()) issues.push("SAFE_TRANSACTION_ID_MISSING");
  if (!snapshot.reportId?.trim() ||
      snapshot.guardInput?.settlement?.report?.id !== snapshot.reportId) {
    issues.push("W3M_REPORT_BINDING_INVALID");
  }
  if (!Number.isSafeInteger(snapshot.reportVersion) || snapshot.reportVersion < 1 ||
      snapshot.guardInput?.settlement?.report?.reportVersion !== snapshot.reportVersion) {
    issues.push("W3M_REPORT_VERSION_INVALID");
  }
  if (!snapshot.executorRef?.trim()) issues.push("EXECUTOR_REFERENCE_MISSING");
  if (!snapshot.idempotencyKey?.trim()) issues.push("IDEMPOTENCY_KEY_MISSING");
  const agreement = snapshot.agreementBinding;
  if (!agreement || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(agreement.termsVersionId ?? "") ||
      !/^[1-9][0-9]*$/.test(agreement.termsVersion ?? "") ||
      !/^[0-9a-f]{64}$/i.test(agreement.termsHash ?? "") ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(agreement.buyerAcceptanceId ?? "") ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(agreement.sellerAcceptanceId ?? "") ||
      !/^0x[0-9a-f]{64}$/i.test(agreement.buyerDigest ?? "") ||
      !/^0x[0-9a-f]{64}$/i.test(agreement.sellerDigest ?? "") ||
      agreement.buyerAcceptanceId === agreement.sellerAcceptanceId ||
      agreement.buyerDigest.toLowerCase() === agreement.sellerDigest.toLowerCase()) {
    issues.push("IMMUTABLE_AGREEMENT_BINDING_INVALID");
  }
  if (snapshot.guardInput?.transaction?.deal_id !== snapshot.dealId) {
    issues.push("SAFE_ROW_DEAL_BINDING_INVALID");
  }
  if (!HASH.test(snapshot.guardInput?.storedSafeTransactionHash ?? "") ||
      !HASH.test(safeHash(snapshot) ?? "")) {
    issues.push("SAFE_TRANSACTION_HASH_INVALID");
  }
  return issues;
}

async function authorize(snapshot: SafeExecutionFreshSnapshot, verify?: SafeDigestSignatureVerifier) {
  const shapeIssues = snapshotIssues(snapshot);
  if (shapeIssues.length) return { authorized: false, issues: shapeIssues };
  try {
    if (!snapshot.guardInput || typeof snapshot.guardInput !== "object") {
      return { authorized: false, issues: ["FRESH_EXECUTION_GUARD_INPUT_MISSING"] };
    }
    const decision = await evaluateSafeExecutionGuard(snapshot.guardInput, verify);
    return { authorized: decision.authorized === true, issues: decision.issues };
  } catch {
    return { authorized: false, issues: ["W3M_AUTHORIZATION_EVALUATION_FAILED"] };
  }
}

async function requireReconciliation(
  dependencies: SafeExecutionCoordinatorDependencies,
  attemptId: string,
  reason: string,
): Promise<SafeExecutionCoordinatorResult> {
  let reconciliationRecorded = false;
  try {
    const result = await dependencies.markReconciliationRequired(attemptId, reason);
    reconciliationRecorded = result?.updated === true &&
      result.state === "RECONCILIATION_REQUIRED" &&
      typeof result.idempotentReplay === "boolean";
  } catch {
    // The active CLAIMED attempt remains blocking even if this transition fails.
  }
  return { state: "RECONCILIATION_REQUIRED", attemptId, reason, reconciliationRecorded };
}

export async function executeW3MSafeRelease(
  dependencies: SafeExecutionCoordinatorDependencies,
): Promise<SafeExecutionCoordinatorResult> {
  let first: SafeExecutionFreshSnapshot;
  try {
    first = await dependencies.loadFresh();
  } catch {
    return { state: "BLOCKED", issues: ["INITIAL_FRESH_STATE_UNAVAILABLE"] };
  }

  const initial = await authorize(first, dependencies.verifySignature);
  if (!initial.authorized) return { state: "BLOCKED", issues: initial.issues };

  let claim: SafeExecutionClaimResult;
  try {
    claim = await dependencies.claim({
      dealId: first.dealId,
      transactionId: first.transactionId,
      reportId: first.reportId,
      safeTxHash: safeHash(first),
      executorRef: first.executorRef,
      idempotencyKey: first.idempotencyKey,
    });
  } catch {
    return { state: "BLOCKED", issues: ["EXECUTION_CLAIM_FAILED"] };
  }

  if (!claim || typeof claim.attemptId !== "string" || !claim.attemptId.trim() ||
      typeof claim.claimed !== "boolean" ||
      typeof claim.idempotentReplay !== "boolean" ||
      !["CLAIMED", "BROADCAST", "RECONCILIATION_REQUIRED"].includes(claim.state)) {
    return { state: "BLOCKED", issues: ["EXECUTION_CLAIM_RESPONSE_INVALID"] };
  }

  // Only a brand-new, positively confirmed claim may proceed to the second read.
  if (claim.idempotentReplay !== false || claim.state !== "CLAIMED" || claim.claimed !== true) {
    return await requireReconciliation(
      dependencies,
      claim.attemptId,
      "EXISTING_ATTEMPT_MUST_BE_RECONCILED",
    );
  }

  let fresh: SafeExecutionFreshSnapshot;
  try {
    fresh = await dependencies.loadFresh();
  } catch {
    return await requireReconciliation(
      dependencies,
      claim.attemptId,
      "PRE_BROADCAST_FRESH_STATE_UNAVAILABLE",
    );
  }

  const reauthorization = await authorize(fresh, dependencies.verifySignature);
  const sameBinding = fresh.dealId === first.dealId &&
    fresh.transactionId === first.transactionId &&
    fresh.reportId === first.reportId &&
    fresh.reportVersion === first.reportVersion &&
    safeHash(fresh).toLowerCase() === safeHash(first).toLowerCase() &&
    fresh.idempotencyKey === first.idempotencyKey &&
    fresh.agreementBinding.termsVersionId === first.agreementBinding.termsVersionId &&
    fresh.agreementBinding.termsVersion === first.agreementBinding.termsVersion &&
    fresh.agreementBinding.termsHash.toLowerCase() === first.agreementBinding.termsHash.toLowerCase() &&
    fresh.agreementBinding.buyerAcceptanceId === first.agreementBinding.buyerAcceptanceId &&
    fresh.agreementBinding.sellerAcceptanceId === first.agreementBinding.sellerAcceptanceId &&
    fresh.agreementBinding.buyerDigest.toLowerCase() === first.agreementBinding.buyerDigest.toLowerCase() &&
    fresh.agreementBinding.sellerDigest.toLowerCase() === first.agreementBinding.sellerDigest.toLowerCase();

  if (!reauthorization.authorized || !sameBinding) {
    return await requireReconciliation(
      dependencies,
      claim.attemptId,
      !sameBinding ? "PRE_BROADCAST_BINDING_CHANGED" : "PRE_BROADCAST_W3M_GATE_BLOCKED",
    );
  }

  let broadcast: { transactionHash: string };
  try {
    broadcast = await dependencies.broadcast({ attemptId: claim.attemptId, snapshot: fresh });
  } catch {
    return await requireReconciliation(
      dependencies,
      claim.attemptId,
      "BROADCAST_OUTCOME_UNCERTAIN",
    );
  }

  const transactionHash = broadcast?.transactionHash;
  if (typeof transactionHash !== "string" || !HASH.test(transactionHash)) {
    return await requireReconciliation(
      dependencies,
      claim.attemptId,
      "BROADCAST_HASH_MISSING_OR_INVALID",
    );
  }

  try {
    const recorded = await dependencies.recordBroadcast(claim.attemptId, transactionHash);
    if (!recorded || recorded.recorded !== true ||
        typeof recorded.idempotentReplay !== "boolean" ||
        recorded.state !== "BROADCAST") {
      return await requireReconciliation(
        dependencies,
        claim.attemptId,
        "BROADCAST_HASH_PERSISTENCE_UNCONFIRMED",
      );
    }
  } catch {
    return await requireReconciliation(
      dependencies,
      claim.attemptId,
      "BROADCAST_HASH_PERSISTENCE_FAILED",
    );
  }

  return {
    state: "BROADCAST_RECORDED",
    attemptId: claim.attemptId,
    transactionHash,
  };
}
