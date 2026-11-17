// W3M Protocol V1 — derive the only valid next immutable report sequence.
// The database trigger remains the concurrency authority; this helper derives
// the expected version from a fresh service-role read and fails closed on bad rows.

export interface LatestW3MReportSequence {
  id: string;
  deal_id: string;
  report_version: number;
}

export interface NextW3MReportSequence {
  reportVersion: number;
  supersedesReportId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveNextW3MReportSequence(
  dealId: string,
  latest: LatestW3MReportSequence | null,
): NextW3MReportSequence {
  if (typeof dealId !== "string" || !dealId.trim() || dealId.length > 160) {
    throw new Error("A valid deal ID is required to derive the report sequence.");
  }
  if (latest === null) return { reportVersion: 1, supersedesReportId: null };
  if (latest.deal_id !== dealId || !UUID.test(latest.id) ||
      !Number.isSafeInteger(latest.report_version) || latest.report_version < 1 ||
      latest.report_version >= 2147483647) {
    throw new Error("Latest persisted W3M report sequence is malformed or belongs to another deal.");
  }
  return {
    reportVersion: latest.report_version + 1,
    supersedesReportId: latest.id,
  };
}
