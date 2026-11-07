/**
 * Build a deterministic manifest from the persisted W3M audit schema.
 * Call only after loading all rows server-side with trusted authorization.
 * Missing file blob SHAs fail closed: metadata alone is not proof of source contents.
 */
export type PersistedAudit = {
  id: string; status: string; repo_owner: string | null; repo_name: string | null;
  commit_sha: string | null; engine_version: string; audit_type: string;
  files_scanned: number; lines_scanned: number; overall_score: number | null;
  security_score: number | null; architecture_score: number | null;
  code_quality_score: number | null; dependency_score: number | null;
  testing_score: number | null; documentation_score: number | null;
  web3_score: number | null; scalability_score: number | null;
  ai_fit_score: number | null; risk_level: string | null; summary: string | null;
};
export type PersistedAuditFile = {
  path: string; sha: string | null; language: string | null;
  size_bytes: number | null; line_count: number | null;
  selected_tier: number | null; scanned: boolean;
};
export type PersistedAuditFinding = {
  severity: string; category: string; title: string; status: string;
  file_path: string | null; line_start: number | null; line_end: number | null;
  evidence: string | null; description: string | null;
  recommendation: string | null; confidence: number | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPOSITORY = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\/[a-z0-9_.-]+$/i;

function requireNonNegativeInteger(value: unknown, label: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(label + " must be a non-negative safe integer.");
  }
}
function requireNullableNonNegativeInteger(value: unknown, label: string): void {
  if (value !== null) requireNonNegativeInteger(value, label);
}
function requireNullableScore(value: unknown, label: string): void {
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100)) {
    throw new Error(label + " must be null or a number between 0 and 100.");
  }
}
function requireNullableText(value: unknown, label: string): void {
  if (value !== null && typeof value !== "string") {
    throw new Error(label + " must be null or a string.");
  }
}
function requireText(value: unknown, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(label + " must be a non-empty string.");
  }
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeRepoPath(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new Error("A manifest file path is empty or malformed.");
  }
  const path = value.replace(/\\/g, "/");
  if (
    path.startsWith("/") || /^[a-zA-Z]:/.test(path) ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error("Manifest paths must be normalized relative repository paths.");
  }
  return path;
}

export function buildW3MAuditManifest(
  audit: PersistedAudit,
  files: PersistedAuditFile[],
  findings: PersistedAuditFinding[],
): Record<string, unknown> {
  if (!audit || audit.status !== "completed") throw new Error("Only completed audits can be fingerprinted.");
  const commitSha = String(audit.commit_sha || "");
  if (!/^[0-9a-f]{40}$/i.test(commitSha)) {
    throw new Error("Audit is missing its immutable 40-character commit SHA.");
  }
  if (typeof audit.id !== "string" || !UUID.test(audit.id)) {
    throw new Error("Audit ID must be a UUID.");
  }
  const repository = String(audit.repo_owner || "") + "/" + String(audit.repo_name || "");
  if (!REPOSITORY.test(repository)) throw new Error("Audit repository identity is malformed.");
  requireText(audit.engine_version, "Audit engine version");
  requireText(audit.audit_type, "Audit type");
  requireNonNegativeInteger(audit.files_scanned, "Audit scanned-file count");
  if (audit.files_scanned === 0) throw new Error("An audit with no scanned files cannot be fingerprinted.");
  requireNonNegativeInteger(audit.lines_scanned, "Audit scanned-line count");
  for (const [label, value] of Object.entries({
    overall_score: audit.overall_score,
    security_score: audit.security_score,
    architecture_score: audit.architecture_score,
    code_quality_score: audit.code_quality_score,
    dependency_score: audit.dependency_score,
    testing_score: audit.testing_score,
    documentation_score: audit.documentation_score,
    web3_score: audit.web3_score,
    scalability_score: audit.scalability_score,
    ai_fit_score: audit.ai_fit_score,
  })) requireNullableScore(value, "Audit " + label);
  requireNullableText(audit.risk_level, "Audit risk level");
  requireNullableText(audit.summary, "Audit summary");
  if (!Array.isArray(files) || !Array.isArray(findings)) {
    throw new Error("Complete file and finding arrays are required.");
  }

  const scanned = files.filter((file) => file.scanned === true);
  if (scanned.length !== audit.files_scanned) {
    throw new Error("Persisted scanned-file count does not match the audit summary.");
  }

  const seenPaths = new Set<string>();
  const normalizedFiles = scanned.map((file) => {
    const path = normalizeRepoPath(file.path);
    if (seenPaths.has(path)) throw new Error("Duplicate scanned file paths are not allowed.");
    seenPaths.add(path);
    const fileSha = String(file.sha || "");
    if (!/^[0-9a-f]{40,64}$/i.test(fileSha)) {
      throw new Error("A scanned file is missing its immutable Git blob SHA.");
    }
    requireNullableText(file.language, "Scanned file language");
    requireNullableNonNegativeInteger(file.size_bytes, "Scanned file size");
    requireNullableNonNegativeInteger(file.line_count, "Scanned file line count");
    requireNullableNonNegativeInteger(file.selected_tier, "Scanned file selected tier");
    return {
      path,
      sha: fileSha.toLowerCase(),
      language: file.language,
      size_bytes: file.size_bytes,
      line_count: file.line_count,
      selected_tier: file.selected_tier,
    };
  }).sort((a, b) => compareText(a.path, b.path));

  const normalizedFindings = findings.map((finding) => {
    requireText(finding.severity, "Finding severity");
    requireText(finding.category, "Finding category");
    requireText(finding.title, "Finding title");
    requireText(finding.status, "Finding status");
    requireNullableText(finding.evidence, "Finding evidence");
    requireNullableText(finding.description, "Finding description");
    requireNullableText(finding.recommendation, "Finding recommendation");
    if (finding.file_path !== null && typeof finding.file_path !== "string") {
      throw new Error("Finding file path must be null or a string.");
    }
    const filePath = finding.file_path === null ? null : normalizeRepoPath(finding.file_path);
    if (filePath !== null && !seenPaths.has(filePath)) {
      throw new Error("A finding references a file outside the scanned evidence set.");
    }
    if (
      finding.line_start !== null &&
      (!Number.isSafeInteger(finding.line_start) || finding.line_start < 1)
    ) throw new Error("Finding start line must be a positive safe integer.");
    if (
      finding.line_end !== null &&
      (!Number.isSafeInteger(finding.line_end) || finding.line_end < 1)
    ) throw new Error("Finding end line must be a positive safe integer.");
    if (
      finding.line_start !== null && finding.line_end !== null &&
      finding.line_end < finding.line_start
    ) throw new Error("Finding line range is reversed.");
    if (
      finding.confidence !== null &&
      (!Number.isFinite(finding.confidence) || finding.confidence < 0 || finding.confidence > 100)
    ) throw new Error("Finding confidence must be between 0 and 100.");
    return {
      severity: finding.severity,
      category: finding.category,
      title: finding.title,
      status: finding.status,
      file_path: filePath,
      line_start: finding.line_start,
      line_end: finding.line_end,
      evidence: finding.evidence,
      description: finding.description,
      recommendation: finding.recommendation,
      confidence: finding.confidence,
    };
  }).sort((a, b) => compareText(JSON.stringify(a), JSON.stringify(b)));

  return {
    manifest_schema: "w3m.persisted-audit-manifest.v1",
    audit: {
      id: audit.id,
      repository: `${audit.repo_owner}/${audit.repo_name}`.toLowerCase(),
      commit_sha: commitSha.toLowerCase(),
      engine_version: audit.engine_version,
      audit_type: audit.audit_type,
      files_scanned: audit.files_scanned,
      lines_scanned: audit.lines_scanned,
      overall_score: audit.overall_score,
      security_score: audit.security_score,
      architecture_score: audit.architecture_score,
      code_quality_score: audit.code_quality_score,
      dependency_score: audit.dependency_score,
      testing_score: audit.testing_score,
      documentation_score: audit.documentation_score,
      web3_score: audit.web3_score,
      scalability_score: audit.scalability_score,
      ai_fit_score: audit.ai_fit_score,
      risk_level: audit.risk_level,
      summary: audit.summary,
    },
    files: normalizedFiles,
    findings: normalizedFindings,
  };
}
