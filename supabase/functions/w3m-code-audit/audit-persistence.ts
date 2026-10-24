export type AuditWriteResult = { error?: { message?: string } | null };

/** Fail closed when a critical audit checkpoint/result could not be persisted. */
export function assertAuditWriteSucceeded(
  result: AuditWriteResult,
  context: string,
): void {
  if (result.error) {
    throw new Error(context + ": " + String(result.error.message || "database write failed"));
  }
}
