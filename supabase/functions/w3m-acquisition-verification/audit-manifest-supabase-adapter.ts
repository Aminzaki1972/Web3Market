// W3M Protocol V1 — service-role Supabase source for complete Code Audit manifests.
// Every query is bound to one audit ID and paginated without trusting client input.
import type { AuditManifestRow } from "./audit-manifest.ts";
import type { AuditManifestSource, AuditManifestPageResult } from "./audit-manifest-loader.ts";
import type { W3MRegistryReadClient } from "./persisted-report-loader.ts";

function pageResult(value: unknown, error: unknown, label: string): AuditManifestPageResult {
  if (error) return { data: null, error: { message: label + " query failed." } };
  if (!Array.isArray(value)) return { data: null, error: { message: label + " query returned a non-array result." } };
  return { data: value as AuditManifestRow[], error: null };
}

export function createSupabaseAuditManifestSource(
  client: W3MRegistryReadClient,
): AuditManifestSource {
  return {
    async loadAudit(auditId) {
      const result = await client.from("code_audits").select("*")
        .eq("id", auditId).maybeSingle();
      if (result.error) return { data: null, error: { message: "Audit row query failed." } };
      if (result.data === null || typeof result.data !== "object" || Array.isArray(result.data)) {
        return { data: null, error: result.data === null ? null : { message: "Audit row is malformed." } };
      }
      return { data: result.data as AuditManifestRow, error: null };
    },
    async loadFilesPage(auditId, from, to) {
      const result = await client.from("code_audit_files").select("*")
        .eq("audit_id", auditId).order("path", { ascending: true }).range(from, to);
      return pageResult(result.data, result.error, "Audit files");
    },
    async loadFindingsPage(auditId, from, to) {
      // Order by the exact manifest natural-key tuple before offset pagination.
      // This makes page boundaries stable even when created_at timestamps tie.
      // computeAuditManifest rejects duplicate tuples, so valid rows have a total order.
      const result = await client.from("code_audit_findings").select("*")
        .eq("audit_id", auditId)
        .order("file_path", { ascending: true })
        .order("line_start", { ascending: true })
        .order("severity", { ascending: true })
        .order("category", { ascending: true })
        .order("title", { ascending: true })
        .order("id", { ascending: true }) // unique final tie-breaker for deterministic offset pages
        .range(from, to);
      return pageResult(result.data, result.error, "Audit findings");
    },
  };
}
