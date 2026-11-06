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

function stableRows(rows: AuditManifestRow[], idKey: string, label: string): AuditManifestRow[] {
  if (!Array.isArray(rows)) throw new Error(label + " must be an array.");
  const seen = new Set<string>();
  const normalized = rows.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(label + " row " + index + " must be an object.");
    }
    assertJsonValue(row, label + " row " + index);
    const id = requiredString(row[idKey], label + " row " + idKey);
    if (seen.has(id)) throw new Error(label + " contains duplicate " + idKey + " values.");
    seen.add(id);
    return { id, row };
  });
  normalized.sort((a, b) => a.id.localeCompare(b.id));
  return normalized.map((item) => item.row);
}

/**
 * Hashes the full exact row snapshots supplied by the trusted loader.
 * Required identifiers: audit.id, files.id, findings.id. Do not pass partial
 * projections and do not omit pages. Recompute from fresh persisted rows at
 * agreement signing and immediately before settlement.
 */
export async function computeAuditManifest(input: AuditManifestInput): Promise<AuditManifest> {
  if (!input || typeof input !== "object" || !input.audit || typeof input.audit !== "object" || Array.isArray(input.audit)) {
    throw new Error("A persisted audit row is required.");
  }
  assertJsonValue(input.audit, "Audit row");
  const auditId = requiredString(input.audit.id, "Audit row id");
  const files = stableRows(input.files, "id", "Audit files");
  const findings = stableRows(input.findings, "id", "Audit findings");
  const payload = {
    version: AUDIT_MANIFEST_VERSION,
    audit: input.audit,
    files,
    findings,
    counts: { files: files.length, findings: findings.length },
  };
  return {
    version: AUDIT_MANIFEST_VERSION,
    auditId,
    fileCount: files.length,
    findingCount: findings.length,
    digest: await sha256Hex(canonicalJson(payload)),
  };
}
