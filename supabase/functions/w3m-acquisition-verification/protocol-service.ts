// W3M Protocol V1 — server-side report issue + persistence composition.
// The caller must load authoritative source data and provide a protected signer.
// This service persists only after the orchestrator has aggregated evidence and
// cryptographically verified the signed report against the trusted signer registry.

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
  rpcClient: W3MRpcClient,
): Promise<IssueAndPersistReportResult> {
  const prepared = await prepareAcquisitionProtocolBatch(input, signDigest);
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
