// W3M Protocol V1 — strict selector/normalizer for an already-loaded Code Audit row.
// This module performs no database or network calls. The caller must load the row
// with a service-role client and must bind it to the authoritative deal/project.
import type { AcquisitionEvidence } from "./decision-engine.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMIT = /^[0-9a-f]{40}$/i;
const HASH = /^[0-9a-f]{64}$/;

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
 * Accept only a completed audit row bound to the exact project, canonical
 * GitHub repository identity and immutable commit selected for this deal.
 * The loader must query by the exact audit ID linked to the approved project;
 * this function intentionally does not choose "latest" on its own.
 */
export async function selectCodeAuditEvidence(
  row: CodeAuditSourceRow | null,
  expected: CodeAuditEvidenceExpectation,
): Promise<CodeAuditEvidenceSelection> {
  if (!row) return fail("The deal has no explicitly selected Code Audit record.");
  if (!UUID.test(text(row.id))) return fail("The selected audit record ID is invalid.");
  if (!UUID.test(expected.projectId) || text(row.project_id) !== expected.projectId) {
    return fail("The selected audit is not bound to the exact deal project.");
  }
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
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    return fail("The selected Code Audit score is invalid.");
  }
  const analysisMethod = text(row.analysis_method);
  if (!analysisMethod) return fail("The selected Code Audit analysis method is missing.");

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
    riskLevel: text(row.risk_level),
    analysisMethod,
  };
  const canonical = JSON.stringify(Object.fromEntries(
    Object.entries(snapshot).sort(([a], [b]) => a.localeCompare(b)),
  ));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const contentHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  const evidence: AcquisitionEvidence = {
    id: "code-audit:" + snapshot.auditId,
    type: "CODE_AUDIT",
    result: "PASS",
    mandatory: true,
    dealId: expected.dealId,
    projectId: expected.projectId,
    contentHash,
    observedAt: expected.now,
    validUntil: new Date(nowMs + expected.maxAgeMs).toISOString(),
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
    },
  };
  return { result: "PASS", evidence };
}
