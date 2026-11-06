// W3M Protocol V1 — authenticated Safe EXECUTE request boundary.
// All authoritative reads, Safe signature recovery, atomic claim, broadcast,
// and reconciliation are supplied by server-only dependencies. Browser input
// is limited to the deal identifier; this handler never accepts a tx hash,
// wallet, signer list, policy, report, or authorization decision from the client.
import {
  executeW3MSafeRelease,
  type SafeExecutionCoordinatorDependencies,
} from "./safe-execution-coordinator.ts";

export interface W3MExecuteRequestDependencies {
  authenticate(request: Request): Promise<{ userId: string } | null>;
  loadExecutionDependencies(input: {
    actorId: string;
    dealId: string;
  }): Promise<SafeExecutionCoordinatorDependencies>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
export function createW3MSafeExecuteRequestHandler(deps: W3MExecuteRequestDependencies) {
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
    const bodyKeys = Object.keys(body);
    if (bodyKeys.length !== 1 || bodyKeys[0] !== "deal_id" ||
        typeof body.deal_id !== "string" || !UUID.test(body.deal_id)) {
      return json(400, { ok: false, error: "INVALID_EXECUTE_REQUEST" });
    }
    try {
      const coordinator = await deps.loadExecutionDependencies({
        actorId: actor.userId,
        dealId: body.deal_id,
      });
      const result = await executeW3MSafeRelease(coordinator);
      if (result.state === "BLOCKED") {
        return json(409, { ok: false, state: result.state, issues: result.issues });
      }
      if (result.state === "RECONCILIATION_REQUIRED") {
        return json(202, {
          ok: false,
          state: result.state,
          attempt_id: result.attemptId,
          reason: result.reason,
          reconciliation_recorded: result.reconciliationRecorded,
        });
      }
      return json(200, {
        ok: true,
        state: result.state,
        attempt_id: result.attemptId,
        transaction_hash: result.transactionHash,
      });
    } catch {
      // A failure while composing server-only dependencies is never permission
      // to attempt a broadcast. No client-supplied fallback is accepted.
      return json(409, { ok: false, error: "W3M_EXECUTE_FAIL_CLOSED" });
    }
  };
}
