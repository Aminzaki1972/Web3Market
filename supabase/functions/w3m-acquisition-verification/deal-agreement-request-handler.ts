// Authenticated HTTP boundary for buyer/seller EIP-712 agreement acceptance.
// Party identity and role come only from the verified session plus the current
// server-side deal snapshot; browser-supplied wallet/party/terms fields are ignored.
import { extractW3MBearerToken } from "./bearer-token.ts";

export interface W3MDealAgreementRequestDependencies {
  authenticate(token: string): Promise<string | null>;
  prepareWithAuditSnapshot(input: { dealId: string; actorId: string }): Promise<unknown>;
  acceptWithAuditSnapshot(input: { dealId: string; actorId: string; signature: string }): Promise<unknown>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE = /^0x[0-9a-f]{130}$/i;
function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
export async function handleW3MDealAgreementRequest(
  request: Request,
  dependencies: W3MDealAgreementRequestDependencies,
): Promise<Response> {
  if (request.method !== "POST") return json(405, { ok: false, error: "POST_REQUIRED" });
  const token = extractW3MBearerToken(request.headers.get("authorization"));
  if (!token) return json(401, { ok: false, error: "AUTHENTICATION_REQUIRED" });
  let actorId: string | null;
  try { actorId = await dependencies.authenticate(token); }
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
  if (typeof value.deal_id !== "string" || !UUID.test(value.deal_id)) {
    return json(400, { ok: false, error: "INVALID_DEAL_ID" });
  }
  if (value.mode === "prepare") {
    try {
      const result = await dependencies.prepareWithAuditSnapshot({ dealId: value.deal_id, actorId });
      return json(200, { ok: true, result });
    } catch {
      return json(409, { ok: false, error: "W3M_AGREEMENT_PREPARATION_BLOCKED" });
    }
  }
  if (value.mode === "accept") {
    if (typeof value.signature !== "string" || !SIGNATURE.test(value.signature)) {
      return json(400, { ok: false, error: "INVALID_EIP712_SIGNATURE" });
    }
    try {
      const result = await dependencies.acceptWithAuditSnapshot({
        dealId: value.deal_id, actorId, signature: value.signature,
      });
      return json(200, { ok: true, result });
    } catch {
      return json(409, { ok: false, error: "W3M_AGREEMENT_ACCEPTANCE_BLOCKED" });
    }
  }
  return json(400, { ok: false, error: "INVALID_MODE" });
}
