// W3M Protocol V1 — single server-side Deal Room gate entry point.
// Caller must pass deal/policy values freshly loaded from the database and
// current Safe chain facts. This service performs only read-only registry loads.

import {
  computeDealTermsHash,
  type DealTermsSnapshot,
} from "./deal-terms-hash.ts";
import {
  evaluatePersistedW3MSettlementGate,
  type DealRoomW3MGateResult,
} from "./dealroom-w3m-gate.ts";
import {
  loadCurrentW3MReportBundle,
  type W3MRegistryReadClient,
} from "./persisted-report-loader.ts";
import type { SettlementStage } from "./settlement-gate.ts";
import type { EthereumDigestRecoveryVerifier } from "./signature-verifier.ts";

export interface DealRoomW3MServiceInput {
  client: W3MRegistryReadClient;
  terms: DealTermsSnapshot;
  stage: SettlementStage;
  now: string;
  paymentConfirmed: boolean;
  deliveryAccepted: boolean;
  disputeOpen: boolean;
  safeConfigurationMatches: boolean;
  releaseAlreadyFinalized: boolean;
}

export interface VerifiedW3MReportAuthorization {
  decision: "PASS";
  dealId: string;
  reportId: string;
  reportVersion: number;
  reportHash: string;
  dealTermsHash: string;
  expiresAt: string;
}

export interface DealRoomW3MServiceResult extends DealRoomW3MGateResult {
  dealTermsHash: string;
  verifiedReportAuthorization?: VerifiedW3MReportAuthorization;
}

export async function checkDealRoomWithW3M(
  input: DealRoomW3MServiceInput,
  recoverAndVerify?: EthereumDigestRecoveryVerifier,
): Promise<DealRoomW3MServiceResult> {
  const [terms, bundle] = await Promise.all([
    computeDealTermsHash(input.terms),
    loadCurrentW3MReportBundle(input.client, input.terms.dealId),
  ]);

  const gate = await evaluatePersistedW3MSettlementGate({
    stage: input.stage,
    expectedDealId: input.terms.dealId,
    expectedProjectId: input.terms.projectId,
    expectedBuyerId: input.terms.buyerId,
    expectedSellerId: input.terms.sellerId,
    currentDealTermsHash: terms.dealTermsHash,
    latestReportVersion: bundle.latestReportVersion,
    now: input.now,
    reportRow: bundle.reportRow,
    evidenceRows: bundle.evidenceRows,
    trustedSignerRegistryRows: bundle.trustedSignerRegistryRows,
    paymentConfirmed: input.paymentConfirmed,
    deliveryAccepted: input.deliveryAccepted,
    disputeOpen: input.disputeOpen,
    safeConfigurationMatches: input.safeConfigurationMatches,
    releaseAlreadyFinalized: input.releaseAlreadyFinalized,
  }, recoverAndVerify);

  let verifiedReportAuthorization: VerifiedW3MReportAuthorization | undefined;
  if (gate.authorized) {
    const row = bundle.reportRow;
    if (!row || typeof row.id !== "string" || !row.id.trim() ||
        !Number.isSafeInteger(row.report_version) || (row.report_version as number) < 1 ||
        typeof row.report_hash !== "string" || !/^[0-9a-f]{64}$/i.test(row.report_hash) ||
        typeof row.expires_at !== "string" || !Number.isFinite(Date.parse(row.expires_at)) ||
        Date.parse(row.expires_at) <= Date.parse(input.now)) {
      throw new Error("Verified W3M report binding is incomplete.");
    }
    verifiedReportAuthorization = {
      decision: "PASS",
      dealId: input.terms.dealId,
      reportId: row.id,
      reportVersion: row.report_version as number,
      reportHash: row.report_hash.toLowerCase(),
      dealTermsHash: terms.dealTermsHash,
      expiresAt: row.expires_at,
    };
  }
  return { ...gate, dealTermsHash: terms.dealTermsHash, ...(verifiedReportAuthorization ? { verifiedReportAuthorization } : {}) };
}
