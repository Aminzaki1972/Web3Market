import { assertEquals } from "jsr:@std/assert@1.0.14";
import { handleW3MSafeFinalizationRequest } from "./safe-finalization-request-handler.ts";

const attemptId = "123e4567-e89b-42d3-a456-426614174000";
const actorId = "223e4567-e89b-42d3-a456-426614174000";
function request(body: unknown, token = "valid-session", method = "POST") {
  return new Request("https://isolated.invalid/finalize", {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}
Deno.test("finalization request derives actor from verified session and sends only attempt ID", async () => {
  let received: unknown;
  const response = await handleW3MSafeFinalizationRequest(request({ attempt_id: attemptId, actor_id: "attacker", tx_hash: "0xdead" }), {
    authenticate: async (token) => token === "valid-session" ? actorId : null,
    finalize: async (input) => { received = input; return { state: "CONFIRMED" }; },
  });
  assertEquals(response.status, 200);
  assertEquals(received, { attemptId, actorId });
  assertEquals(await response.json(), { ok: true, result: { state: "CONFIRMED" } });
});
Deno.test("unauthenticated request never reaches finalizer", async () => {
  let called = false;
  const response = await handleW3MSafeFinalizationRequest(request({ attempt_id: attemptId }, ""), {
    authenticate: async () => null,
    finalize: async () => { called = true; return {}; },
  });
  assertEquals(response.status, 401);
  assertEquals(called, false);
});
Deno.test("invalid attempt ID is rejected before finalizer", async () => {
  let called = false;
  const response = await handleW3MSafeFinalizationRequest(request({ attempt_id: "../deal" }), {
    authenticate: async () => actorId,
    finalize: async () => { called = true; return {}; },
  });
  assertEquals(response.status, 400);
  assertEquals(called, false);
});
Deno.test("finalizer errors fail closed without exposing internals", async () => {
  const response = await handleW3MSafeFinalizationRequest(request({ attempt_id: attemptId }), {
    authenticate: async () => actorId,
    finalize: async () => { throw new Error("secret database detail"); },
  });
  assertEquals(response.status, 409);
  assertEquals(await response.json(), { ok: false, error: "W3M_FINALIZATION_BLOCKED" });
});
Deno.test("non-POST request is rejected", async () => {
  let authenticated = false;
  const response = await handleW3MSafeFinalizationRequest(request({}, "valid-session", "GET"), {
    authenticate: async () => { authenticated = true; return actorId; },
    finalize: async () => ({}),
  });
  assertEquals(response.status, 405);
  assertEquals(authenticated, false);
});
