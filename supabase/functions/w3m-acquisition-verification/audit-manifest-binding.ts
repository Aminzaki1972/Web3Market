// W3M Protocol V1 — revalidate a signed Code Audit binding against live persisted rows.
import { loadAuditManifest } from "./audit-manifest-loader.ts";
import { createSupabaseAuditManifestSource } from "./audit-manifest-supabase-adapter.ts";
import type { W3MRegistryReadClient } from "./persisted-report-loader.ts";
import type { DealCodeAuditBinding } from "./deal-code-audit-binding.ts";
import type { AuditManifest } from "./audit-manifest.ts";

export async function verifyCurrentAuditManifest(
  client: W3MRegistryReadClient,
  binding: DealCodeAuditBinding,
): Promise<AuditManifest> {
  const manifest = await loadAuditManifest({
    auditId: binding.auditId,
    source: createSupabaseAuditManifestSource(client),
    pageSize: 500,
  });
  if (manifest.version !== "w3m-audit-manifest-v1" ||
      manifest.auditId !== binding.auditId ||
      manifest.digest !== binding.auditEvidenceHash) {
    throw new Error("Current persisted Code Audit rows no longer match the signed Audit Manifest.");
  }
  return manifest;
}
