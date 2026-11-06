import { assertEquals } from "jsr:@std/assert@1.0.14";
import { handleW3MDealAgreementRequest } from "./deal-agreement-request-handler.ts";
const dealId = "71000000-0000-4000-8000-000000000001";
const buyerId = "73000000-0000-4000-8000-000000000003";
const signature = "0x" + "a".repeat(130);
function request(body: unknown, token = "session", method = "POST") {
  return new Request("https://isolated.invalid/agreement", {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}
Deno.test("prepare derives actor from authenticated session and ignores browser role and wallet", async () => {
  let received: unknown;
  const response = await handleW3MDealAgreementRequest(request({
    mode: "prepare", deal_id: dealId, party_role: "seller",
    party_id: "attacker", wallet_address: "0x0000000000000000000000000000000000000001",
  }), {
    authenticate: async () => buyerId,
    prepare: async (input) => { received = input; return { typedData: "server-generated" }; },
    accept: async () => { throw new Error("not expected"); },
  });
  assertEquals(response.status, 200);
  assertEquals(received, { dealId, actorId: buyerId });
});
Deno.test("accept sends only deal, authenticated actor, and signature to service", async () => {
  let received: unknown;
  const response = await handleW3MDealAgreementRequest(request({
    mode: "accept", deal_id: dealId, signature,
    party_role: "seller", party_id: "attacker", wallet_address: "0x0000000000000000000000000000000000000001",
    terms_hash: "0".repeat(64), terms_version: "999",
  }), {
    authenticate: async () => buyerId,
    prepare: async () => ({}),
    accept: async (input) => { received = input; return { accepted: true }; },
  });
  assertEquals(response.status, 200);
  assertEquals(received, { dealId, actorId: buyerId, signature });
});
Deno.test("unauthenticated requests never reach agreement service", async () => {
  let called = false;
  const response = await handleW3MDealAgreementRequest(request({ mode: "prepare", deal_id: dealId }, ""), {
    authenticate: async () => null,
    prepare: async () => { called = true; return {}; },
    accept: async () => { called = true; return {}; },
  });
  assertEquals(response.status, 401);
  assertEquals(called, false);
});
Deno.test("malformed deal IDs and signatures are rejected before service", async () => {
  let called = false;
  const deps = {
    authenticate: async () => buyerId,
    prepare: async () => { called = true; return {}; },
    accept: async () => { called = true; return {}; },
  };
  const badDeal = await handleW3MDealAgreementRequest(request({ mode: "prepare", deal_id: "../x" }), deps);
  const badSignature = await handleW3MDealAgreementRequest(request({ mode: "accept", deal_id: dealId, signature: "0x1234" }), deps);
  assertEquals(badDeal.status, 400);
  assertEquals(badSignature.status, 400);
  assertEquals(called, false);
});
Deno.test("service failures return generic blocked responses without leaking internals", async () => {
  const response = await handleW3MDealAgreementRequest(request({ mode: "accept", deal_id: dealId, signature }), {
    authenticate: async () => buyerId,
    prepare: async () => ({}),
    accept: async () => { throw new Error("secret database details"); },
  });
  assertEquals(response.status, 409);
  assertEquals(await response.json(), { ok: false, error: "W3M_AGREEMENT_ACCEPTANCE_BLOCKED" });
});
Deno.test("unknown modes and non-POST methods are rejected", async () => {
  const deps = { authenticate: async () => buyerId, prepare: async () => ({}), accept: async () => ({}) };
  const badMode = await handleW3MDealAgreementRequest(request({ mode: "admin", deal_id: dealId }), deps);
  const badMethod = await handleW3MDealAgreementRequest(request({}, "session", "GET"), deps);
  assertEquals(badMode.status, 400);
  assertEquals(badMethod.status, 405);
});

Deno.test("agreement boundary rejects multi-part bearer credentials before authentication", async () => {
  let authenticated = false;
  const response = await handleW3MDealAgreementRequest(request({ mode: "prepare", deal_id: dealId }, "valid extra"), {
    authenticate: async () => { authenticated = true; return buyerId; },
    prepare: async () => ({}),
    accept: async () => ({}),
  });
  assertEquals(response.status, 401);
  assertEquals(authenticated, false);
});
