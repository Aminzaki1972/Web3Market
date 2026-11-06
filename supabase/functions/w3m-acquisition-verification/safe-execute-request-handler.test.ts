import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createW3MSafeExecuteRequestHandler } from "./safe-execute-request-handler.ts";
const actor = "11111111-1111-4111-8111-111111111111";
const deal = "22222222-2222-4222-8222-222222222222";
function req(body: unknown, method = "POST") {
  return new Request("https://isolated.invalid/execute", {
    method,
    headers: { "content-type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}
function coordinator(result?: unknown) {
  return {
    loadFresh: async () => { throw new Error("not reached in boundary test"); },
    claim: async () => { throw new Error("not reached"); },
    broadcast: async () => { throw new Error("not reached"); },
    recordBroadcast: async () => { throw new Error("not reached"); },
    markReconciliationRequired: async () => { throw new Error("not reached"); },
    __result: result,
  } as never;
}
Deno.test("EXECUTE rejects non-POST", async () => {
  let loads = 0;
  const handler = createW3MSafeExecuteRequestHandler({
    authenticate: async () => ({ userId: actor }),
    loadExecutionDependencies: async () => { loads++; return coordinator(); },
  });
  const response = await handler(req({}, "GET"));
  assertEquals(response.status, 405);
  assertEquals(loads, 0);
});
Deno.test("EXECUTE requires authenticated actor", async () => {
  let loads = 0;
  const handler = createW3MSafeExecuteRequestHandler({
    authenticate: async () => null,
    loadExecutionDependencies: async () => { loads++; return coordinator(); },
  });
  const response = await handler(req({ deal_id: deal }));
  assertEquals(response.status, 401);
  assertEquals(loads, 0);
});
Deno.test("EXECUTE rejects malformed deal id before authoritative reads", async () => {
  let loads = 0;
  const handler = createW3MSafeExecuteRequestHandler({
    authenticate: async () => ({ userId: actor }),
    loadExecutionDependencies: async () => { loads++; return coordinator(); },
  });
  const response = await handler(req({ deal_id: "not-a-uuid", safe_tx_hash: "0x" + "a".repeat(64) }));
  assertEquals(response.status, 400);
  assertEquals(loads, 0);
});
Deno.test("EXECUTE rejects every client-supplied field except deal_id before dependency loading", async () => {
  let loads = 0;
  const handler = createW3MSafeExecuteRequestHandler({
    authenticate: async () => ({ userId: actor }),
    loadExecutionDependencies: async () => { loads++; return coordinator(); },
  });
  const response = await handler(req({
    deal_id: deal, actor_id: "attacker", wallet: "0x" + "2".repeat(40),
    safe_tx_hash: "0x" + "a".repeat(64), authorized: true,
  }));
  assertEquals(response.status, 400);
  assertEquals(loads, 0);
});

Deno.test("EXECUTE accepts only deal_id and derives actor identity from authentication", async () => {
  let seen: unknown;
  const handler = createW3MSafeExecuteRequestHandler({
    authenticate: async () => ({ userId: actor }),
    loadExecutionDependencies: async (input) => { seen = input; return coordinator(); },
  });
  const response = await handler(req({ deal_id: deal }));
  // The fixture deliberately cannot complete a release; this status confirms
  // the request passed validation and reached the coordinator's fail-closed path.
  assertEquals(response.status, 409);
  assertEquals(seen, { actorId: actor, dealId: deal });
});
Deno.test("EXECUTE fails closed when server dependency composition fails", async () => {
  const handler = createW3MSafeExecuteRequestHandler({
    authenticate: async () => ({ userId: actor }),
    loadExecutionDependencies: async () => { throw new Error("provider unavailable"); },
  });
  const response = await handler(req({ deal_id: deal }));
  assertEquals(response.status, 409);
  assertEquals((await response.json()).error, "W3M_EXECUTE_FAIL_CLOSED");
});
