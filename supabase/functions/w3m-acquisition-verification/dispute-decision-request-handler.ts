// W3M Protocol V1 — authenticated admin-only HTTP boundary for dispute decisions.
import { extractW3MBearerToken } from "./bearer-token.ts";
import { parseW3MDisputeDecisionCommand, type W3MDisputeDecisionCommand } from "./dispute-decision.ts";

export interface W3MDisputeDecisionRequestDependencies {
  authenticate(token: string): Promise<string | null>;
  isAdmin(actorId: string): Promise<boolean>;
  decide(input: { command: W3MDisputeDecisionCommand; actorId: string }): Promise<{
    decisionId: string;
    decisionHash: string;
    outcome: "buyer_wins" | "seller_wins";
    state: string;
  }>;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function handleW3MDisputeDecisionRequest(
  request: Request,
  dependencies: W3MDisputeDecisionRequestDependencies,
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

  let authorized = false;
  try { authorized = await dependencies.isAdmin(actorId); }
  catch { return json(403, { ok: false, error: "ADMIN_AUTHORIZATION_FAILED" }); }
  if (authorized !== true) return json(403, { ok: false, error: "ADMIN_REQUIRED" });

  let body: unknown;
  try { body = await request.json(); }
  catch { return json(400, { ok: false, error: "INVALID_JSON" }); }

  let command: W3MDisputeDecisionCommand;
  try { command = parseW3MDisputeDecisionCommand(body); }
  catch { return json(400, { ok: false, error: "INVALID_DECISION_COMMAND" }); }

  try {
    const result = await dependencies.decide({ command, actorId });
    return json(200, { ok: true, result });
  } catch {
    // Do not disclose database, evidence, or decision-authority internals.
    return json(409, { ok: false, error: "W3M_DISPUTE_DECISION_BLOCKED" });
  }
}
