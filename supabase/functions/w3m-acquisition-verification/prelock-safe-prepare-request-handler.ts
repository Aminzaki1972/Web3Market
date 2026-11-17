// Authenticated HTTP boundary for isolated W3M PREPARE.
// The browser may supply only deal_id. Actor, report authorization, policy,
// Safe facts, signer verifier and service-role RPC client are server-derived.
import { extractW3MBearerToken } from "./bearer-token.ts";
import type { EthereumDigestRecoveryVerifier } from "./signature-verifier.ts";
import type { PrelockSafePrepareDependencies } from "./prelock-safe-prepare-gate.ts";
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";
import { authorizeAndCommitPrelockSafePrepare } from "./prelock-safe-prepare-commit.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface W3MPrelockPrepareRequestDependencies {
  authenticate(token: string): Promise<string | null>;
  buildServerContext(input: { actorId: string; dealId: string }): Promise<{
    gate: PrelockSafePrepareDependencies;
    persistence: W3MRpcClient;
    recoverAndVerify: EthereumDigestRecoveryVerifier;
  }>;
  now(): string;
}
function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
export async function handleW3MPrelockPrepareRequest(
  request: Request,
  dependencies: W3MPrelockPrepareRequestDependencies,
): Promise<Response> {
  if (request.method !== "POST") return json(405, { ok: false, error: "POST_REQUIRED" });
  const token = extractW3MBearerToken(request.headers.get("authorization"));
  if (!token) return json(401, { ok: false, error: "AUTHENTICATION_REQUIRED" });
  let actorId: string | null;
  try { actorId = await dependencies.authenticate(token); }
  catch { return json(401, { ok: false, error: "AUTHENTICATION_FAILED" }); }
  if (typeof actorId !== "string" || !UUID.test(actorId)) {
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
  try {
    const context = await dependencies.buildServerContext({ actorId, dealId: value.deal_id });
    const result = await authorizeAndCommitPrelockSafePrepare(
      context.gate, context.persistence, value.deal_id, actorId,
      dependencies.now(), context.recoverAndVerify,
    );
    if (!result.allowed) {
      return json(409, { ok: false, error: "W3M_PREPARE_BLOCKED", issues: result.authorization.issues });
    }
    return json(200, { ok: true, result: result.committed });
  } catch {
    return json(409, { ok: false, error: "W3M_PREPARE_COMMIT_FAILED" });
  }
}
