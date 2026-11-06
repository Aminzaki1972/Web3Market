import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { persistSafeReleaseSignatureAtomically } from "./safe-signature-persistence-adapter.ts";
const actor = "11111111-1111-4111-8111-111111111111";
const deal = "22222222-2222-4222-8222-222222222222";
const report = "77777777-7777-4777-8777-777777777777";
const hash = "0x" + "a".repeat(64);
const sig = "0x" + "b".repeat(130);
const wallet = "0x" + "1".repeat(40);
function authorization(overrides: Record<string, unknown> = {}) {
 return {
  authorized: true, phase: "SIGN" as const, dealId: deal, safeTransactionHash: hash,
  issues: [], reportId: report, reportVersion: 1, ...overrides,
 };
}
function client(response: unknown = {
 recorded: true, idempotent_replay: false, confirmations_count: 1,
 required_signatures: 2, status: "awaiting_signatures",
}) {
 const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
 return {
  calls,
  rpc: async (name: string, args: Record<string, unknown>) => {
   calls.push({ name, args });
   return { data: response, error: null };
  },
 };
}
function input(overrides: Record<string, unknown> = {}) {
 return { actorId: actor, dealId: deal, safeTransactionHash: hash, signature: sig,
  verifiedWallet: wallet, signerRole: "buyer" as const, authorization: authorization(), ...overrides };
}
Deno.test("atomic SIGN adapter invokes only the dedicated RPC with server-derived bindings", async () => {
 const db = client();
 const result = await persistSafeReleaseSignatureAtomically(db, input());
 assertEquals(result.confirmationsCount, 1);
 assertEquals(db.calls.length, 1);
 assertEquals(db.calls[0].name, "w3m_record_safe_release_signature");
 assertEquals(db.calls[0].args.p_actor_id, actor);
 assertEquals(db.calls[0].args.p_w3m_authorization && (db.calls[0].args.p_w3m_authorization as Record<string,unknown>).report_id, report);
});
Deno.test("atomic SIGN adapter refuses missing or mismatched W3M PASS before RPC", async () => {
 const db = client();
 await assertRejects(() => persistSafeReleaseSignatureAtomically(db, input({
  authorization: authorization({ authorized: false, issues: ["REPORT_STALE"] }),
 })));
 await assertRejects(() => persistSafeReleaseSignatureAtomically(db, input({
  authorization: authorization({ safeTransactionHash: "0x" + "c".repeat(64) }),
 })));
 assertEquals(db.calls.length, 0);
});
Deno.test("atomic SIGN adapter rejects malformed RPC response", async () => {
 const db = client({ recorded: true, idempotent_replay: false, confirmations_count: 9,
  required_signatures: 2, status: "signed" });
 await assertRejects(() => persistSafeReleaseSignatureAtomically(db, input()));
});
