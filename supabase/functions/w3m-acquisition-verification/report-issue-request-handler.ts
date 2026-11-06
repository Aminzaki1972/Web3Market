// W3M Protocol V1 — authenticated report-issuance HTTP boundary.
// All evidence loading, signer selection, trusted-key verification and persistence
// remain behind server-injected dependencies. The browser may submit only deal_id.
export interface W3MReportIssueRequestDependencies {
  authenticate(token: string): Promise<string | null>;
  authorize(input: { actorId: string; dealId: string }): Promise<boolean>;
  issue(input: { actorId: string; dealId: string }): Promise<{
    reportId: string;
    reportVersion: number;
    decisionStatus: "PASS" | "INCOMPLETE" | "BLOCKED" | "REVIEW_REQUIRED";
  }>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
export async function handleW3MReportIssueRequest(
  request: Request,
  dependencies: W3MReportIssueRequestDependencies,
): Promise<Response> {
  if (request.method !== "POST") return json(405, { ok: false, error: "POST_REQUIRED" });
  const match = /^Bearer\\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!match?.[1]?.trim()) return json(401, { ok: false, error: "AUTHENTICATION_REQUIRED" });
  let actorId: string | null;
  try { actorId = await dependencies.authenticate(match[1].trim()); }
  catch { return json(401, { ok: false, error: "AUTHENTICATION_FAILED" }); }
  if (typeof actorId !== "string" || !actorId.trim()) {
    return json(401, { ok: false, error: "AUTHENTICATION_FAILED" });
  }
  let body: unknown;
  try { body = await request.json(); }
  catch { return json(400, { ok: false, error: "INVALID_JSON" }); }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return json(400, { ok: false, error: "INVALID_REQUEST" });
  }
  const value = body as Record<string, unknown>;
  if (Object.keys(value).length !== 1 || typeof value.deal_id !== "string" || !UUID.test(value.deal_id)) {
    return json(400, { ok: false, error: "INVALID_DEAL_ID_OR_UNTRUSTED_FIELDS" });
  }
  try {
    const allowed = await dependencies.authorize({ actorId, dealId: value.deal_id });
    if (!allowed) return json(403, { ok: false, error: "REPORT_ISSUANCE_FORBIDDEN" });
    const result = await dependencies.issue({ actorId, dealId: value.deal_id });
    if (!result.reportId || !Number.isSafeInteger(result.reportVersion) || result.reportVersion < 1) {
      return json(503, { ok: false, error: "REPORT_ISSUANCE_INCOMPLETE" });
    }
    return json(200, {
      ok: true,
      report_id: result.reportId,
      report_version: result.reportVersion,
      decision_status: result.decisionStatus,
      settlement_authorized: false,
      execution_enabled: false,
    });
  } catch {
    return json(409, { ok: false, error: "W3M_REPORT_ISSUANCE_BLOCKED" });
  }
}
