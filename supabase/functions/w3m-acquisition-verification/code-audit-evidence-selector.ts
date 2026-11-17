// W3M Protocol V1 — strict selector/normalizer for an already-loaded Code Audit row.
// The trusted caller must also supply a freshly computed complete Audit Manifest V1.
import type { AcquisitionEvidence } from "./decision-engine.ts";
import { AUDIT_MANIFEST_VERSION, type AuditManifest } from "./audit-manifest.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMIT = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

export interface CodeAuditSourceRow {
  id: unknown;
  project_id: unknown;
  status: unknown;
  audit_type: unknown;
  repo_owner: unknown;
  repo_name: unknown;
  commit_sha: unknown;
  completed_at: unknown;
  overall_score: unknown;
  risk_level: unknown;
  analysis_method?: unknown;
}

export interface CodeAuditEvidenceExpectation {
  dealId: string;
  projectId: string;
  repositoryOwner: string;
  repositoryName: string;
  commitSha: string;
  now: string;
  maxAgeMs: number;
  manifest: AuditManifest;
}

export type CodeAuditEvidenceSelection =
  | { result: "PASS"; evidence: AcquisitionEvidence }
  | { result: "REVIEW_REQUIRED"; reason: string };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function fail(reason: string): CodeAuditEvidenceSelection {
  return { result: "REVIEW_REQUIRED", reason };
}

/**
 * Accept only a completed audit row bound to the exact deal project, canonical
 * GitHub repository and immutable commit. The manifest must have been freshly
 * computed from the full persisted audit/files/findings snapshot by the trusted
 * server loader. This selector never calculates a summary-only substitute.
 */
export async function selectCodeAuditEvidence(
  row: CodeAuditSourceRow | null,
  expected: CodeAuditEvidenceExpectation,
): Promise<CodeAuditEvidenceSelection> {
  if (!row) return fail("The deal has no explicitly selected Code Audit record.");
  if (!UUID.test(expected.dealId)) return fail("The expected deal ID is invalid.");
  if (!UUID.test(expected.projectId) || !text(expected.repositoryOwner) || !text(expected.repositoryName)) {
    return fail("The expected project or repository identity is incomplete.");
  }
  if (!UUID.test(text(row.id))) return fail("The selected audit record ID is invalid.");
  if (text(row.project_id) !== expected.projectId) return fail("The selected audit is not bound to the exact deal project.");
  if (text(row.status) !== "completed") return fail("The selected Code Audit is not completed.");
  if (!["code", "smart_contract", "complete"].includes(text(row.audit_type))) {
    return fail("The selected Code Audit scope is unsupported.");
  }
  if (text(row.repo_owner).toLowerCase() !== expected.repositoryOwner.trim().toLowerCase() ||
      text(row.repo_name).toLowerCase() !== expected.repositoryName.trim().toLowerCase()) {
    return fail("The selected audit repository owner/name does not match the agreed repository.");
  }
  const commit = text(row.commit_sha);
  if (!COMMIT.test(commit) || !COMMIT.test(expected.commitSha) ||
      commit.toLowerCase() !== expected.commitSha.toLowerCase()) {
    return fail("The selected audit is not pinned to the exact agreed Git commit.");
  }
  const completedAt = text(row.completed_at);
  const completedMs = Date.parse(completedAt);
  const nowMs = Date.parse(expected.now);
  if (!Number.isFinite(completedMs) || !Number.isFinite(nowMs) ||
      !Number.isFinite(expected.maxAgeMs) || expected.maxAgeMs <= 0 ||
      completedMs > nowMs || nowMs - completedMs > expected.maxAgeMs) {
    return fail("The selected Code Audit completion timestamp is invalid, future-dated, or stale.");
  }
  const score = Number(row.overall_score);
  if (!Number.isFinite(score) || score < 0 || score > 100) return fail("The selected Code Audit score is invalid.");
  const analysisMethod = text(row.analysis_method);
  if (!analysisMethod) return fail("The selected Code Audit analysis method is missing.");
  const riskLevel = text(row.risk_level);
  if (!riskLevel) return fail("The selected Code Audit risk level is missing.");

  const manifest = expected.manifest;
  if (!manifest || manifest.version !== AUDIT_MANIFEST_VERSION ||
      manifest.auditId !== text(row.id) || !SHA256.test(manifest.digest) ||
      !Number.isSafeInteger(manifest.fileCount) || manifest.fileCount <= 0 ||
      !Number.isSafeInteger(manifest.findingCount) || manifest.findingCount < 0) {
    return fail("A complete, matching Audit Manifest V1 is required for Code Audit evidence.");
  }

  const snapshot = {
    auditId: text(row.id),
    projectId: expected.projectId,
    repositoryOwner: text(row.repo_owner),
    repositoryName: text(row.repo_name),
    commitSha: commit.toLowerCase(),
    auditType: text(row.audit_type),
    auditStatus: "completed",
    completedAt: new Date(completedMs).toISOString(),
    overallScore: score,
    riskLevel,
    analysisMethod,
    auditManifestVersion: manifest.version,
    auditManifestHash: manifest.digest,
    auditFileCount: manifest.fileCount,
    auditFindingCount: manifest.findingCount,
  };
  const evidence: AcquisitionEvidence = {
    id: "code-audit:" + snapshot.auditId,
    type: "CODE_AUDIT",
    result: "PASS",
    mandatory: true,
    dealId: expected.dealId,
    projectId: expected.projectId,
    contentHash: manifest.digest,
    observedAt: expected.now,
    validUntil: new Date(completedMs + expected.maxAgeMs).toISOString(),
    sourceRecordId: snapshot.auditId,
    sourceVersion: snapshot.commitSha,
    metadata: {
      auditStatus: snapshot.auditStatus,
      auditType: snapshot.auditType,
      commitSha: snapshot.commitSha,
      repositoryOwner: snapshot.repositoryOwner,
      repositoryName: snapshot.repositoryName,
      overallScore: snapshot.overallScore,
      riskLevel: snapshot.riskLevel,
      analysisMethod: snapshot.analysisMethod,
      completedAt: snapshot.completedAt,
      auditManifestVersion: manifest.version,
      auditManifestHash: manifest.digest,
      auditFileCount: manifest.fileCount,
      auditFindingCount: manifest.findingCount,
    },
  };
  return { result: "PASS", evidence };
}
