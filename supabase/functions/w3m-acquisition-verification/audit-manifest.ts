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

export function buildW3MAuditManifest(
  audit: PersistedAudit,
  files: PersistedAuditFile[],
  findings: PersistedAuditFinding[],
): Record<string, unknown> {
  if (!audit || audit.status !== "completed") throw new Error("Only completed audits can be fingerprinted.");
  if (!/^[0-9a-f]{40}$/i.test(String(audit.commit_sha || ""))) {
    throw new Error("Audit is missing its immutable 40-character commit SHA.");
  }
  if (!audit.repo_owner || !audit.repo_name || !audit.engine_version || !audit.audit_type) {
    throw new Error("Audit identity and engine metadata are incomplete.");
  }
  if (!Array.isArray(files) || !Array.isArray(findings)) throw new Error("Complete file and finding arrays are required.");
  const scanned = files.filter((file) => file.scanned === true);
  if (scanned.length !== audit.files_scanned) {
    throw new Error("Persisted scanned-file count does not match the audit summary.");
  }
  const normalizedFiles = scanned.map((file) => {
    if (!file.path || !/^[0-9a-f]{40,64}$/i.test(String(file.sha || ""))) {
      throw new Error("A scanned file is missing its immutable Git blob SHA.");
    }
    return {
      path: file.path.replace(/\\/g, "/"),
      sha: file.sha.toLowerCase(),
      language: file.language,
      size_bytes: file.size_bytes,
      line_count: file.line_count,
      selected_tier: file.selected_tier,
    };
  }).sort((a, b) => a.path.localeCompare(b.path));

  const normalizedFindings = findings.map((finding) => ({
    severity: finding.severity,
    category: finding.category,
    title: finding.title,
    status: finding.status,
    file_path: finding.file_path ? finding.file_path.replace(/\\/g, "/") : null,
    line_start: finding.line_start,
    line_end: finding.line_end,
    evidence: finding.evidence,
    description: finding.description,
    recommendation: finding.recommendation,
    confidence: finding.confidence,
  })).sort((a, b) =>
    String(a.file_path || "").localeCompare(String(b.file_path || "")) ||
    Number(a.line_start || 0) - Number(b.line_start || 0) ||
    a.severity.localeCompare(b.severity) ||
    a.title.localeCompare(b.title)
  );

  return {
    manifest_schema: "w3m.persisted-audit-manifest.v1",
    audit: {
      id: audit.id,
      repository: `${audit.repo_owner}/${audit.repo_name}`.toLowerCase(),
      commit_sha: audit.commit_sha.toLowerCase(),
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
