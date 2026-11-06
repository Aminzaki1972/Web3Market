// W3M Protocol V1 — issue, persist, reload, and verify the exact stored report.
// Server-only composition. The caller must provide a service-role client that
// supports both the write RPC and read-only registry queries. This module never
// authorizes settlement or calls Safe; it only proves report persistence integrity.

import {
  issueAndPersistAcquisitionReport,
  type IssueAndPersistReportResult,
} from "./protocol-service.ts";
import type { ProtocolOrchestratorInput } from "./protocol-orchestrator.ts";
import type { RegistrySigner } from "./report-registry-batch.ts";
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";
import {
  loadCurrentW3MReportBundle,
  type W3MRegistryReadClient,
} from "./persisted-report-loader.ts";
import { verifyPersistedW3MReport } from "./persisted-report-guard.ts";

export interface VerifiedReportIssuanceResult {
  issuance: IssueAndPersistReportResult;
  persistedReportVerified: boolean;
  persistedReportIssues: string[];
  settlementAuthorized: false;
  executionEnabled: false;
}

export async function issuePersistAndVerifyW3MReport(
  input: ProtocolOrchestratorInput,
  signDigest: (digestHex: string) => Promise<RegistrySigner>,
  serviceClient: W3MRpcClient & W3MRegistryReadClient,
): Promise<VerifiedReportIssuanceResult> {
  const issuance = await issueAndPersistAcquisitionReport(input, signDigest, serviceClient);

  // Non-PASS reports are valid diagnostic records, but are never settlement
  // candidates. Do not label them as verified settlement reports.
  if (issuance.decisionStatus !== "PASS") {
    return {
      issuance,
      persistedReportVerified: false,
      persistedReportIssues: ["REPORT_NOT_PASS_SETTLEMENT_CANDIDATE"],
      settlementAuthorized: false,
      executionEnabled: false,
    };
  }

  const bundle = await loadCurrentW3MReportBundle(serviceClient, input.acquisition.dealId);
  if (!bundle.reportRow || bundle.reportRow.id !== issuance.reportId ||
      bundle.latestReportVersion !== issuance.reportVersion) {
    throw new Error("Persisted W3M report is missing, superseded, or does not match the issued report.");
  }

  const verification = await verifyPersistedW3MReport({
    expectedDealId: input.acquisition.dealId,
    expectedProjectId: input.acquisition.projectId,
    expectedBuyerId: input.acquisition.buyerIdentity,
    expectedSellerId: input.acquisition.sellerIdentity,
    currentDealTermsHash: input.dealTermsHash,
    latestReportVersion: bundle.latestReportVersion,
    now: input.acquisition.now,
    reportRow: bundle.reportRow,
    evidenceRows: bundle.evidenceRows,
    trustedSignerRegistryRows: bundle.trustedSignerRegistryRows,
  });

  if (!verification.authorized) {
    throw new Error("Persisted W3M report verification failed: " + verification.issues.join(", "));
  }

  return {
    issuance,
    persistedReportVerified: true,
    persistedReportIssues: [],
    settlementAuthorized: false,
    executionEnabled: false,
  };
}
