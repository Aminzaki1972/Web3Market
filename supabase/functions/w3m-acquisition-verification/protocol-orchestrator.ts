// W3M Protocol V1 — pure end-to-end acquisition report orchestrator.
// Composes trusted provider evidence, deterministic decision, canonical report,
// and signed registry batch. It does not access Supabase, persist rows, authorize
// settlement, call Safe, or execute any blockchain transaction.

import {
  aggregateAcquisitionEvidence,
  type UnifiedEvidenceInput,
  type UnifiedEvidenceResult,
} from "./unified-evidence-aggregator.ts";
import {
  buildSignedRegistryBatch,
  type RegistryBatch,
  type RegistrySigner,
} from "./report-registry-batch.ts";

export const W3M_PROTOCOL_ORCHESTRATOR_VERSION = "w3m-protocol-orchestrator-1.0.0";

export interface ProtocolOrchestratorInput {
  acquisition: UnifiedEvidenceInput;
  reportId: string;
  evidenceRowIds: string[];
  eventRowIds: string[];
  reportVersion: number;
  supersedesReportId?: string | null;
  dealTermsHash: string;
  auditId: string;
  issuedAt: string;
  expiresAt: string;
  actorType: "SYSTEM" | "VERIFIER";
  actorRef?: string | null;
  /** Raw rows from the service-role-only w3m_trusted_signer_key_status view. */
  trustedSignerRegistryRows: unknown;
}

export interface ProtocolOrchestratorResult {
  orchestratorVersion: string;
  aggregation: UnifiedEvidenceResult;
  registryBatch: RegistryBatch;
  persistenceRequired: true;
  settlementAuthorized: false;
  executionEnabled: false;
}

export async function prepareAcquisitionProtocolBatch(
  input: ProtocolOrchestratorInput,
  signDigest: (digestHex: string) => Promise<RegistrySigner>,
): Promise<ProtocolOrchestratorResult> {
  const aggregation = await aggregateAcquisitionEvidence(input.acquisition);

  if (aggregation.decision.dealId !== input.acquisition.dealId ||
      aggregation.decision.projectId !== input.acquisition.projectId) {
    throw new Error("Aggregated decision is not bound to the requested deal and project.");
  }

  const auditEvidence = aggregation.evidence.filter((item) => item.type === "CODE_AUDIT");
  if (auditEvidence.length !== 1 ||
      auditEvidence[0].sourceRecordId !== input.auditId ||
      auditEvidence[0].sourceVersion?.toLowerCase() !== input.acquisition.expectedCommitSha.toLowerCase()) {
    throw new Error("Exactly one Code Audit evidence record must match the report audit ID and exact commit SHA.");
  }

  const registryBatch = await buildSignedRegistryBatch({
    reportId: input.reportId,
    evidenceRowIds: input.evidenceRowIds,
    eventRowIds: input.eventRowIds,
    decision: aggregation.decision,
    evidence: aggregation.evidence,
    reportVersion: input.reportVersion,
    supersedesReportId: input.supersedesReportId ?? null,
    buyerId: input.acquisition.buyerIdentity,
    sellerId: input.acquisition.sellerIdentity,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    dealTermsHash: input.dealTermsHash,
    auditId: input.auditId,
    expectedCommitSha: input.acquisition.expectedCommitSha,
    actorType: input.actorType,
    actorRef: input.actorRef ?? null,
  }, signDigest);

  const signerRegistry = mapTrustedSignerRegistryRows(input.trustedSignerRegistryRows);
  if (!signerRegistry.ok) {
    throw new Error("Trusted signer registry is invalid: " + signerRegistry.reason);
  }

  const signatureCheck = await verifyTrustedEthereumReportSignature({
    digestHex: registryBatch.digestToSign,
    signature: registryBatch.report.report_signature,
    signerKeyId: registryBatch.report.signer_key_id,
    checkedAt: aggregation.decision.checkedAt,
  }, signerRegistry.keys);
  if (!signatureCheck.valid) {
    throw new Error("Trusted report signature verification failed: " + signatureCheck.code);
  }

  return {
    orchestratorVersion: W3M_PROTOCOL_ORCHESTRATOR_VERSION,
    aggregation,
    registryBatch,
    persistenceRequired: true,
    settlementAuthorized: false,
    executionEnabled: false,
  };
}
