export type AuditFindingKeyFields = {
  file_path?: unknown;
  line_start?: unknown;
  title?: unknown;
  category?: unknown;
  severity?: unknown;
};

export function auditFindingKey(f: AuditFindingKeyFields): string {
  return [
    String(f.file_path || "").trim().replace(/\\/g, "/"),
    Number(f.line_start || 0),
    String(f.title || "").trim().toLowerCase(),
    String(f.category || "").trim().toLowerCase(),
    String(f.severity || "").trim().toLowerCase(),
  ].join("|");
}

/** Return only findings not already persisted, de-duplicating within this write too. */
export function filterMissingAuditFindings<T extends AuditFindingKeyFields>(
  candidates: T[],
  existing: Iterable<AuditFindingKeyFields>,
): T[] {
  const known = new Set(Array.from(existing, auditFindingKey));
  const missing: T[] = [];
  for (const finding of candidates) {
    const key = auditFindingKey(finding);
    if (known.has(key)) continue;
    known.add(key);
    missing.push(finding);
  }
  return missing;
}
