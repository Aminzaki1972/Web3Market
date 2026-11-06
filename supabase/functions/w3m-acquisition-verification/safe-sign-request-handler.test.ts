import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createW3MSafeSignRequestHandler } from "./safe-sign-request-handler.ts";
const actor = "11111111-1111-4111-8111-111111111111";
const deal = "22222222-2222-4222-8222-222222222222";
const hash = "0x" + "a".repeat(64);
const signature = "0x" + "b".repeat(130);
function req(body: unknown, method = "POST") {
  return new Request("https://isolated.invalid/sign", {
    method,
    headers: { "content-type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}
function deps(overrides: Record<string, unknown> = {}) {
  const calls = { load: 0, verify: 0, persist: 0 };
  const base = {
    authenticate: async () => ({ userId: actor }),
    loadFreshContext: async ({ dealId: id, safeTransactionHash }: { dealId: string; safeTransactionHash: string }) => {
      calls.load++;
      return {
        authorization: { authorized: true, phase: "SIGN" as const, dealId: id, safeTransactionHash, issues: [] },
        verifiedWallet: "0x" + "1".repeat(40),
        signerRole: "buyer" as const,
        transactionStatus: "awaiting_signatures" as const,
      };
    },
    verifyTypedDataSignature: async () => { calls.verify++; return true; },
    persistSignatureAtomically: async () => {
      calls.persist++;
      return { recorded: true, idempotentReplay: false, confirmationsCount: 1, requiredSignatures: 2, status: "awaiting_signatures" as const };
    },
  };
  return { calls, handler: createW3MSafeSignRequestHandler({ ...base, ...overrides } as never) };
}
Deno.test("SIGN rejects non-POST requests", async () => {
  const d = deps();
  const res = await d.handler(req({}, "GET"));
  assertEquals(res.status, 405);
  assertEquals(d.calls.persist, 1);
});
Deno.test("SIGN rejects malformed input before fresh reads", async () => {
  const d = deps();
  const res = await d.handler(req({ deal_id: deal, safe_tx_hash: "bad", signature }));
  assertEquals(res.status, 400);
  assertEquals(d.calls.load, 0);
});
Deno.test("SIGN derives actor from authentication and never accepts browser actor fields", async () => {
  let seen = "";
  const d = deps({
    authenticate: async () => ({ userId: actor }),
    loadFreshContext: async ({ actorId }: { actorId: string }) => {
      seen = actorId;
      return {
        authorization: { authorized: true, phase: "SIGN", dealId: deal, safeTransactionHash: hash, issues: [] },
        verifiedWallet: "0x" + "1".repeat(40), signerRole: "buyer", transactionStatus: "awaiting_signatures",
      };
    },
  });
  const res = await d.handler(req({ deal_id: deal, safe_tx_hash: hash, signature, actor_id: "attacker", wallet: "0x" + "2".repeat(40) }));
  assertEquals(res.status, 200);
  assertEquals(seen, actor);
});
Deno.test("SIGN blocks missing W3M PASS before signature verification or persistence", async () => {
  const d = deps({
    loadFreshContext: async () => ({
      authorization: { authorized: false, phase: "SIGN", dealId: deal, safeTransactionHash: hash, issues: ["REPORT_STALE"] },
      verifiedWallet: "0x" + "1".repeat(40), signerRole: "buyer", transactionStatus: "awaiting_signatures",
    }),
  });
  const res = await d.handler(req({ deal_id: deal, safe_tx_hash: hash, signature }));
  assertEquals(res.status, 409);
  assertEquals(d.calls.verify, 0);
  assertEquals(d.calls.persist, 0);
});
Deno.test("SIGN binds exact deal and Safe hash", async () => {
  const d = deps({
    loadFreshContext: async () => ({
      authorization: { authorized: true, phase: "SIGN", dealId: deal, safeTransactionHash: "0x" + "c".repeat(64), issues: [] },
      verifiedWallet: "0x" + "1".repeat(40), signerRole: "buyer", transactionStatus: "awaiting_signatures",
    }),
  });
  const res = await d.handler(req({ deal_id: deal, safe_tx_hash: hash, signature }));
  assertEquals(res.status, 409);
  assertEquals(d.calls.persist, 0);
});
Deno.test("SIGN rejects failed cryptographic recovery without persistence", async () => {
  const d = deps({ verifyTypedDataSignature: async () => false });
  const res = await d.handler(req({ deal_id: deal, safe_tx_hash: hash, signature }));
  assertEquals(res.status, 403);
  assertEquals(d.calls.persist, 0);
});
Deno.test("SIGN persists only after fresh authorization and signature verification", async () => {
  const d = deps();
  const res = await d.handler(req({ deal_id: deal, safe_tx_hash: hash, signature }));
  assertEquals(res.status, 200);
  assertEquals(d.calls.load, 1);
  assertEquals(d.calls.verify, 1);
  assertEquals(d.calls.persist, 1);
  const body = await res.json();
  assertEquals(body.confirmations_count, 1);
});
Deno.test("SIGN fails closed on persistence adapter failure", async () => {
  const d = deps({ persistSignatureAtomically: async () => { throw new Error("database unavailable"); } });
  const res = await d.handler(req({ deal_id: deal, safe_tx_hash: hash, signature }));
  assertEquals(res.status, 409);
  assertEquals(d.calls.persist, 1);
});
