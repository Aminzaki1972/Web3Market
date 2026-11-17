// W3M Protocol V1 — combined persisted-report + Deal Room settlement gate.
// A server adapter supplies current authoritative deal state and service-role
// registry rows. Any report-verification issue is an unconditional veto.

import {
  evaluateSettlementGate,
  type SettlementGateDecision,
  type SettlementStage,
} from "./settlement-gate.ts";
import {
  verifyPersistedW3MReport,
  type PersistedReportGuardInput,
} from "./persisted-report-guard.ts";
import type { EthereumDigestRecoveryVerifier } from "./signature-verifier.ts";

export interface DealRoomW3MGateInput extends PersistedReportGuardInput {
  stage: SettlementStage;
  paymentConfirmed: boolean;
  deliveryAccepted: boolean;
  disputeOpen: boolean;
  safeConfigurationMatches: boolean;
  releaseAlreadyFinalized: boolean;
}

export interface DealRoomW3MGateResult {
  authorized: boolean;
  decision: SettlementGateDecision;
  reportVerificationIssues: string[];
}

export async function evaluatePersistedW3MSettlementGate(
  input: DealRoomW3MGateInput,
  recoverAndVerify?: EthereumDigestRecoveryVerifier,
): Promise<DealRoomW3MGateResult> {
  const reportVerification = await verifyPersistedW3MReport(input, recoverAndVerify);
  const decision = evaluateSettlementGate({
    stage: input.stage,
    dealId: input.expectedDealId,
    projectId: input.expectedProjectId,
    now: input.now,
    report: reportVerification.report,
    latestReportVersion: reportVerification.latestReportVersion,
    isSuperseded: reportVerification.isSuperseded,
    signatureValid: reportVerification.signatureValid,
    signerState: reportVerification.signerState,
    recomputedEvidenceHash: reportVerification.recomputedEvidenceHash,
    currentDealTermsHash: input.currentDealTermsHash,
    reportDealTermsHash: reportVerification.reportDealTermsHash,
    paymentConfirmed: input.paymentConfirmed,
    deliveryAccepted: input.deliveryAccepted,
    disputeOpen: input.disputeOpen,
    safeConfigurationMatches: input.safeConfigurationMatches,
    releaseAlreadyFinalized: input.releaseAlreadyFinalized,
  });

  if (!reportVerification.authorized) {
    decision.authorized = false;
    decision.issues.push({
      code: "PERSISTED_REPORT_INVALID",
      message: "The stored report, evidence manifest, terms binding, or trusted signature failed verification.",
    });
  }

  return {
    authorized: decision.authorized && reportVerification.authorized,
    decision,
    reportVerificationIssues: reportVerification.issues,
  };
}
