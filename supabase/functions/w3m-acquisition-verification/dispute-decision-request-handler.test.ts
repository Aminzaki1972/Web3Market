import { assertEquals } from "jsr:@std/assert@1.0.14";
import { handleW3MDisputeDecisionRequest } from "./dispute-decision-request-handler.ts";

const actorId = "84000000-0000-4000-8000-000000000004";
const command = {
  dealId: "81000000-0000-4000-8000-000000000001",
  disputeId: "82000000-0000-4000-8000-000000000002",
  outcome: "buyer_wins",
  reason: "The seller did not transfer the agreed project ownership.",
  evidenceRefs: [{ source: "deal_message", recordId: "86000000-0000-4000-8000-000000000006" }],
};
function request(body: unknown, authorization = "Bearer valid-session", method = "POST") {
  return new Request("https://w3m.test/dispute-decision", {
    method, headers: { authorization, "content-type": "application/json" },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
}

Deno.test("decision HTTP boundary derives admin actor from verified session and passes only parsed command", async () => {
  let captured: unknown = null;
  const response = await handleW3MDisputeDecisionRequest(request(command), {
    authenticate: async () => actorId,
    isAdmin: async (id) => id === actorId,
    decide: async (input) => {
      captured = input;
      return { decisionId: "83000000-0000-4000-8000-000000000003", decisionHash: "ab".repeat(32), outcome: "buyer_wins", state: "DECIDED" };
    },
  });
  assertEquals(response.status, 200);
  assertEquals((captured as Record<string, unknown>).actorId, actorId);
  assertEquals((captured as Record<string, unknown>).command !== undefined, true);
});

Deno.test("decision HTTP boundary rejects missing authentication and non-admin actors", async () => {
  const unauthenticated = await handleW3MDisputeDecisionRequest(request(command, ""), {
    authenticate: async () => null, isAdmin: async () => true, decide: async () => { throw new Error("must not run"); },
  });
  assertEquals(unauthenticated.status, 401);
  const nonAdmin = await handleW3MDisputeDecisionRequest(request(command), {
    authenticate: async () => actorId, isAdmin: async () => false, decide: async () => { throw new Error("must not run"); },
  });
  assertEquals(nonAdmin.status, 403);
});

Deno.test("decision HTTP boundary rejects browser-supplied actor and refund authority fields", async () => {
  let called = false;
  const response = await handleW3MDisputeDecisionRequest(request({ ...command, actorId, refundAmount: "100" }), {
    authenticate: async () => actorId, isAdmin: async () => true,
    decide: async () => { called = true; throw new Error("must not run"); },
  });
  assertEquals(response.status, 400);
  assertEquals(called, false);
});

Deno.test("decision HTTP boundary requires POST and fails closed when decision persistence fails", async () => {
  const wrongMethod = await handleW3MDisputeDecisionRequest(request(command, "Bearer valid-session", "GET"), {
    authenticate: async () => actorId, isAdmin: async () => true, decide: async () => { throw new Error("must not run"); },
  });
  assertEquals(wrongMethod.status, 405);
  const failed = await handleW3MDisputeDecisionRequest(request(command), {
    authenticate: async () => actorId, isAdmin: async () => true, decide: async () => { throw new Error("internal detail"); },
  });
  assertEquals(failed.status, 409);
  assertEquals((await failed.json()).error, "W3M_DISPUTE_DECISION_BLOCKED");
});
