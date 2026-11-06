// W3M Protocol V1 — deterministic manifest for a persisted Code Audit snapshot.
// Pure function: callers must load every page from trusted server-side sources.
// The manifest hashes the exact supplied row payloads; it does not fetch or authorize data.
import { canonicalJson, sha256Hex } from "./decision-engine.ts";

export const AUDIT_MANIFEST_VERSION = "w3m-audit-manifest-v1" as const;

type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };
export type AuditManifestRow = Record<string, JsonValue>;

export interface AuditManifestInput {
  audit: AuditManifestRow;
  files: AuditManifestRow[];
  findings: AuditManifestRow[];
}

export interface AuditManifest {
  version: typeof AUDIT_MANIFEST_VERSION;
  auditId: string;
  fileCount: number;
  findingCount: number;
  digest: string;
}

function requiredString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(label + " is required.");
  return value.trim();
}

function assertJsonValue(value: unknown, label: string, depth = 0): asserts value is JsonValue {
  if (depth > 32) throw new Error(label + " exceeds the maximum JSON nesting depth.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(label + " contains a non-finite number.");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, label, depth + 1);
    return;
  }
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (!key || key === "__proto__") throw new Error(label + " contains an unsafe object key.");
      assertJsonValue(item, label, depth + 1);
    }
    return;
  }
  throw new Error(label + " contains a non-JSON value.");
}

function stableRows(
  rows: AuditManifestRow[],
  keyOf: (row: AuditManifestRow) => string,
  label: string,
): AuditManifestRow[] {
  if (!Array.isArray(rows)) throw new Error(label + " must be an array.");
  const seen = new Set<string>();
  const normalized = rows.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(label + " row " + index + " must be an object.");
    }
    assertJsonValue(row, label + " row " + index);
    const key = keyOf(row);
    if (!key) throw new Error(label + " row has no stable natural key.");
    if (seen.has(key)) throw new Error(label + " contains duplicate natural keys.");
    seen.add(key);
    return { key, row };
  });
  // Code-point ordering is locale-independent across runtimes.
  normalized.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  return normalized.map((item) => item.row);
}

function nonNegativeInteger(value: JsonValue | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(label + " must be a non-negative integer.");
  }
  return value;
}

/**
 * Hashes complete exact row snapshots supplied by the trusted loader.
 * Audit identity is audit.id; file natural key is path; finding natural key is
 * file_path + line_start + severity + category + title (the persisted finding
 * identity used by the audit writer). Complete pagination is enforced through
 * the persisted file and severity totals in the completed audit row.
 */
export async function computeAuditManifest(input: AuditManifestInput): Promise<AuditManifest> {
  if (!input || typeof input !== "object" || !input.audit ||
      typeof input.audit !== "object" || Array.isArray(input.audit)) {
    throw new Error("A persisted audit row is required.");
  }
  const audit = input.audit;
  assertJsonValue(audit, "Audit row");
  const auditId = requiredString(audit.id, "Audit row id");
  if (audit.status !== "completed") throw new Error("Only completed audits can be manifested.");
  const commitSha = requiredString(audit.commit_sha, "Audit commit SHA");
  if (!/^[0-9a-f]{40}$/i.test(commitSha)) throw new Error("Audit commit SHA is invalid.");
  requiredString(audit.repo_owner, "Audit repository owner");
  requiredString(audit.repo_name, "Audit repository name");
  requiredString(audit.completed_at, "Audit completion timestamp");
  requiredString(audit.engine_version, "Audit engine version");

  const progress = audit.analysis_progress;
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) {
    throw new Error("Structured audit completion evidence is required.");
  }
  if (progress.evidence_version !== "w3m-audit-evidence-v1" || progress.tree_truncated !== false) {
    throw new Error("Audit evidence version or repository tree completeness is invalid.");
  }

  const files = stableRows(input.files, (row) =>
    requiredString(row.path, "Audit file path"), "Audit files");
  const findings = stableRows(input.findings, (row) => {
    const rawPath = row.file_path;
    const path = rawPath === null ? null : requiredString(rawPath, "Finding file path");
    const severity = requiredString(row.severity, "Finding severity").toLowerCase();
    const category = requiredString(row.category, "Finding category");
    const title = requiredString(row.title, "Finding title");
    const lineStart = row.line_start;
    if (lineStart !== null && lineStart !== undefined &&
        (!Number.isInteger(lineStart) || Number(lineStart) < 0)) {
      throw new Error("Finding line_start must be null or a non-negative integer.");
    }
    if (!["critical", "high", "medium", "low", "info"].includes(severity)) {
      throw new Error("Finding severity is unsupported.");
    }
    // Repository-level findings legitimately have null file_path/line_start.
    // JSON tuple encoding distinguishes those from file-scoped findings.
    return JSON.stringify([path, lineStart ?? null, severity, category, title]);
  }, "Audit findings");

  for (const row of [...files, ...findings]) {
    if (row.audit_id !== auditId) {
      throw new Error("Every file and finding row must belong to the selected audit.");
    }
  }

  const filesScanned = nonNegativeInteger(audit.files_scanned, "Audit files_scanned");
  const persistedFiles = nonNegativeInteger(progress.persisted_file_count, "Persisted file count");
  if (files.length !== filesScanned || files.length !== persistedFiles) {
    throw new Error("Persisted file rows do not match the audit's completed file counts.");
  }

  const findingCount = findings.length;
  const persistedFindingCount = ["critical_count", "high_count", "medium_count", "low_count", "info_count"]
    .reduce((sum, key) => sum + nonNegativeInteger(audit[key], "Audit " + key), 0);
  if (findingCount !== persistedFindingCount) {
    throw new Error("Persisted finding rows do not match the audit's severity totals.");
  }

  const payload = {
    version: AUDIT_MANIFEST_VERSION,
    audit,
    files,
    findings,
    counts: { files: files.length, findings: findings.length },
  };
  return {
    version: AUDIT_MANIFEST_VERSION,
    auditId,
    fileCount: files.length,
    findingCount,
    digest: await sha256Hex(canonicalJson(payload)),
  };
}
