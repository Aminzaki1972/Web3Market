// W3M Protocol V1 — trusted-source pagination boundary for Audit Manifest V1.
// The adapter must query full rows (select("*")) and bind every page to auditId.
import { computeAuditManifest, type AuditManifest, type AuditManifestRow } from "./audit-manifest.ts";

export interface AuditManifestPageResult {
  data: AuditManifestRow[] | null;
  error?: { message?: string } | null;
}

export interface AuditManifestSource {
  loadAudit(auditId: string): Promise<{ data: AuditManifestRow | null; error?: { message?: string } | null }>;
  loadFilesPage(auditId: string, from: number, to: number): Promise<AuditManifestPageResult>;
  loadFindingsPage(auditId: string, from: number, to: number): Promise<AuditManifestPageResult>;
}

async function collectAllPages(
  fetchPage: (from: number, to: number) => Promise<AuditManifestPageResult>,
  pageSize: number,
  label: string,
): Promise<AuditManifestRow[]> {
  const rows: AuditManifestRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const result = await fetchPage(from, from + pageSize - 1);
    if (result.error) throw new Error(label + " page read failed: " + String(result.error.message || "database error"));
    const page = result.data || [];
    if (!Array.isArray(page) || page.length > pageSize) throw new Error(label + " page response is invalid.");
    rows.push(...page);
    if (rows.length > 100000) throw new Error(label + " exceeded the 100,000-row safety limit.");
    if (page.length < pageSize) return rows;
  }
}

/**
 * Load one completed audit plus every file/finding page from trusted server-side
 * adapters. Each adapter must use the audit ID predicate and select complete
 * persisted rows; this loader verifies read completion and the manifest helper
 * cross-checks persisted totals and audit ownership before hashing.
 */
export async function loadAuditManifest(input: {
  auditId: string;
  source: AuditManifestSource;
  pageSize?: number;
}): Promise<AuditManifest> {
  if (!input || typeof input.auditId !== "string" || !input.auditId.trim()) {
    throw new Error("A valid audit ID is required.");
  }
  const pageSize = input.pageSize ?? 500;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new Error("Audit manifest page size must be between 1 and 1000.");
  }
  const auditResult = await input.source.loadAudit(input.auditId);
  if (auditResult.error) throw new Error("Audit row read failed: " + String(auditResult.error.message || "database error"));
  if (!auditResult.data || auditResult.data.id !== input.auditId) {
    throw new Error("The requested audit row was not found exactly.");
  }
  const [files, findings] = await Promise.all([
    collectAllPages((from, to) => input.source.loadFilesPage(input.auditId, from, to), pageSize, "Audit files"),
    collectAllPages((from, to) => input.source.loadFindingsPage(input.auditId, from, to), pageSize, "Audit findings"),
  ]);
  return await computeAuditManifest({ audit: auditResult.data, files, findings });
}
