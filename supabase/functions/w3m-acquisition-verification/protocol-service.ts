// W3M Protocol V1 — server-side report issue + persistence composition.
// The caller must load authoritative deal/evidence/signer inputs and provide a
// protected signer. The latest report sequence is read server-side; the database
// trigger remains the final concurrency authority and rejects stale concurrent writers.

import {
  prepareAcquisitionProtocolBatch,
  type ProtocolOrchestratorInput,
} from "./protocol-orchestrator.ts";
import type { RegistrySigner } from "./report-registry-batch.ts";
import {
  persistAcquisitionRegistryBatch,
  type RegistryPersistenceResult,
  type W3MRpcClient,
} from "./supabase-rpc-adapter.ts";
import {
  loadCurrentW3MReportBundle,
  type W3MRegistryReadClient,
} from "./persisted-report-loader.ts";
import { resolveNextW3MReportSequence } from "./report-sequence.ts";

export interface IssueAndPersistReportResult {
  reportId: string;
  reportVersion: number;
  decisionStatus: "PASS" | "INCOMPLETE" | "BLOCKED" | "REVIEW_REQUIRED";
  persistence: RegistryPersistenceResult;
  settlementAuthorized: false;
  executionEnabled: false;
}

export async function issueAndPersistAcquisitionReport(
  input: ProtocolOrchestratorInput,
  signDigest: (digestHex: string) => Promise<RegistrySigner>,
  rpcClient: W3MRpcClient & W3MRegistryReadClient,
): Promise<IssueAndPersistReportResult> {
  // Never trust a browser/caller-selected report version or predecessor pointer.
  const latestBundle = await loadCurrentW3MReportBundle(rpcClient, input.acquisition.dealId);
  let latest: { id: string; deal_id: string; report_version: number } | null = null;
  if (latestBundle.reportRow) {
    const row = latestBundle.reportRow;
    if (typeof row.id !== "string" || typeof row.deal_id !== "string" ||
        typeof row.report_version !== "number") {
      throw new Error("Latest persisted W3M report row cannot establish a safe sequence.");
    }
    latest = { id: row.id, deal_id: row.deal_id, report_version: row.report_version };
  }
  const sequence = resolveNextW3MReportSequence(input.acquisition.dealId, latest);
  const authoritativeInput: ProtocolOrchestratorInput = {
    ...input,
    reportVersion: sequence.reportVersion,
    supersedesReportId: sequence.supersedesReportId,
  };

  const prepared = await prepareAcquisitionProtocolBatch(authoritativeInput, signDigest);
  const persistence = await persistAcquisitionRegistryBatch(rpcClient, prepared.registryBatch);

  if (persistence.reportId !== prepared.registryBatch.report.id) {
    throw new Error("Persisted W3M report identity does not match the prepared report.");
  }

  return {
    reportId: prepared.registryBatch.report.id,
    reportVersion: prepared.registryBatch.report.report_version,
    decisionStatus: prepared.registryBatch.report.status,
    persistence,
    settlementAuthorized: false,
    executionEnabled: false,
  };
}
