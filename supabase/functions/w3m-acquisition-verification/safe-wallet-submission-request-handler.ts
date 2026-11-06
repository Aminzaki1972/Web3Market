// W3M Protocol V1 — authenticated receipt-hash handoff from connected wallet.
// The submitted outer transaction hash is untrusted until the separate BNB
// receipt verifier checks it. This handler never finalizes a deal.
import {
  recordSafeWalletSubmission,
  type W3MRpcClient,
} from "./supabase-rpc-adapter.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export interface W3MSafeWalletSubmissionRequestDependencies {
  authenticate(request: Request): Promise<{ userId: string } | null>;
  rpc: W3MRpcClient;
}

export function createW3MSafeWalletSubmissionRequestHandler(
  deps: W3MSafeWalletSubmissionRequestDependencies,
) {
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== "POST") return json(405, { ok: false, error: "POST_REQUIRED" });
    let actor: { userId: string } | null;
    try { actor = await deps.authenticate(request); } catch {
      return json(401, { ok: false, error: "AUTHENTICATION_FAILED" });
    }
    if (!actor || !UUID.test(actor.userId)) {
      return json(401, { ok: false, error: "AUTHENTICATION_REQUIRED" });
    }
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
      body = parsed as Record<string, unknown>;
    } catch { return json(400, { ok: false, error: "INVALID_JSON" }); }
    const bodyKeys = Object.keys(body).sort();
    if (bodyKeys.length !== 3 ||
        bodyKeys[0] !== "attempt_id" || bodyKeys[1] !== "package_hash" ||
        bodyKeys[2] !== "transaction_hash" ||
        typeof body.attempt_id !== "string" || !UUID.test(body.attempt_id) ||
        typeof body.package_hash !== "string" || !/^[0-9a-f]{64}$/i.test(body.package_hash) ||
        typeof body.transaction_hash !== "string" || !HASH.test(body.transaction_hash)) {
      return json(400, { ok: false, error: "INVALID_WALLET_SUBMISSION" });
    }
    try {
      const result = await recordSafeWalletSubmission(deps.rpc, {
        attemptId: body.attempt_id,
        actorId: actor.userId,
        packageHash: body.package_hash,
        broadcastTxHash: body.transaction_hash,
      });
      return json(result.state === "BROADCAST" ? 200 : 202, {
        ok: true,
        state: result.state === "BROADCAST" ? "BROADCAST_UNVERIFIED" : "RECONCILIATION_REQUIRED",
        attempt_id: result.attemptId,
        transaction_hash: result.broadcastTxHash,
        idempotent_replay: result.idempotentReplay,
        receipt_verified: false,
        finalized: false,
      });
    } catch {
      return json(409, { ok: false, error: "W3M_WALLET_SUBMISSION_REJECTED" });
    }
  };
}
