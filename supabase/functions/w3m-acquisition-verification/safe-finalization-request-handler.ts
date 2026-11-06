// HTTP boundary for the isolated W3M Safe finalization handler.
// Identity is derived only from a verified bearer session; the caller supplies
// an attempt ID, never the actor ID, broadcast hash, or receipt evidence.
export interface W3MSafeFinalizationRequestDependencies {
  authenticate(token: string): Promise<string | null>;
  finalize(input: { attemptId: string; actorId: string }): Promise<unknown>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
export async function handleW3MSafeFinalizationRequest(
  request: Request,
  dependencies: W3MSafeFinalizationRequestDependencies,
): Promise<Response> {
  if (request.method !== "POST") return json(405, { ok: false, error: "POST_REQUIRED" });
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\\s+(.+)$/i.exec(authorization);
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
  const attemptId = (body as Record<string, unknown>).attempt_id;
  if (typeof attemptId !== "string" || !UUID.test(attemptId)) {
    return json(400, { ok: false, error: "INVALID_ATTEMPT_ID" });
  }
  try {
    const result = await dependencies.finalize({ attemptId, actorId });
    return json(200, { ok: true, result });
  } catch {
    // Do not leak RPC, database, or provider internals to the caller.
    return json(409, { ok: false, error: "W3M_FINALIZATION_BLOCKED" });
  }
}
