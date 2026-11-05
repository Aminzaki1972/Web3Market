// W3M Protocol V1 — read-only loader for the current persisted report bundle.
// Call only with a server-side service-role Supabase client. No rows are written.

export interface W3MRegistryReadResult {
  data: unknown;
  error: unknown;
}

export interface W3MRegistrySelectQuery extends PromiseLike<W3MRegistryReadResult> {
  eq(column: string, value: unknown): W3MRegistrySelectQuery;
  order(column: string, options: { ascending: boolean }): W3MRegistrySelectQuery;
  limit(count: number): W3MRegistrySelectQuery;
  maybeSingle(): PromiseLike<W3MRegistryReadResult>;
}

export interface W3MRegistryReadClient {
  from(table: string): {
    select(columns: string): W3MRegistrySelectQuery;
  };
}

export interface PersistedW3MReportBundle {
  reportRow: Record<string, unknown> | null;
  evidenceRows: unknown[];
  trustedSignerRegistryRows: unknown[];
  latestReportVersion: number | null;
}

function requiredText(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(label + " is required.");
}

function queryError(error: unknown, label: string): never {
  // Do not serialize database errors into a client response; callers should fail closed.
  throw new Error("W3M " + label + " registry read failed.");
}

export async function loadCurrentW3MReportBundle(
  client: W3MRegistryReadClient,
  dealId: string,
): Promise<PersistedW3MReportBundle> {
  requiredText(dealId, "Deal ID");

  const reportResult = await client
    .from("w3m_acquisition_reports")
    .select("*")
    .eq("deal_id", dealId)
    .order("report_version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (reportResult.error) queryError(reportResult.error, "report");
  if (reportResult.data === null) {
    return {
      reportRow: null,
      evidenceRows: [],
      trustedSignerRegistryRows: [],
      latestReportVersion: null,
    };
  }
  if (typeof reportResult.data !== "object" || Array.isArray(reportResult.data)) {
    throw new Error("W3M report registry returned a malformed row.");
  }

  const reportRow = reportResult.data as Record<string, unknown>;
  if (typeof reportRow.id !== "string" ||
      !Number.isInteger(reportRow.report_version)) {
    throw new Error("W3M report registry row is missing its identity or version.");
  }

  const evidenceResult = await client
    .from("w3m_acquisition_evidence")
    .select("*")
    .eq("report_id", reportRow.id);
  if (evidenceResult.error) queryError(evidenceResult.error, "evidence");
  if (!Array.isArray(evidenceResult.data)) {
    throw new Error("W3M evidence registry returned a malformed result.");
  }

  let trustedSignerRegistryRows: unknown[] = [];
  if (typeof reportRow.signer_key_id === "string" && reportRow.signer_key_id.trim()) {
    const signerResult = await client
      .from("w3m_trusted_signer_key_status")
      .select("*")
      .eq("key_id", reportRow.signer_key_id);
    if (signerResult.error) queryError(signerResult.error, "trusted signer");
    if (!Array.isArray(signerResult.data)) {
      throw new Error("W3M trusted signer registry returned a malformed result.");
    }
    trustedSignerRegistryRows = signerResult.data;
  }

  return {
    reportRow,
    evidenceRows: evidenceResult.data,
    trustedSignerRegistryRows,
    latestReportVersion: reportRow.report_version as number,
  };
}
