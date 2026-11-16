import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { persistW3MDisputeDecision } from "./dispute-decision-service.ts";

const actorId = "84000000-0000-4000-8000-000000000004";
const command = {
  dealId: "81000000-0000-4000-8000-000000000001",
  disputeId: "82000000-0000-4000-8000-000000000002",
  outcome: "seller_wins",
  reason: "The seller delivered the agreed project assets and control.",
  evidenceRefs: [{ source: "deal_asset", recordId: "87000000-0000-4000-8000-000000000007" }],
};
const result = {
  decision_id: "83000000-0000-4000-8000-000000000003",
  decision_hash: "ab".repeat(32),
  outcome: "seller_wins",
  buyer_refund_amount: null,
  dispute_record_status: "resolved",
  deal_dispute_status: "resolved_seller",
  deal_status: "disputed",
  idempotent_replay: false,
};

Deno.test("decision service passes only parsed command and verified actor to the server RPC", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const persisted = await persistW3MDisputeDecision({
    rpc: async (name, args) => { calls.push({ name, args }); return { data: result, error: null }; },
  }, { command, actorId });
  assertEquals(calls[0].name, "w3m_admin_decide_deal_dispute");
  assertEquals(calls[0].args.p_actor_id, actorId);
  assertEquals(calls[0].args.p_buyer_refund_amount, null);
  assertEquals(persisted.dealDisputeStatus, "resolved_seller");
  assertEquals(persisted.dealStatus, "disputed");
  assertEquals(persisted.buyerRefundAmount, null);
});

Deno.test("decision service forwards the verified admin's buyer refund amount to the immutable RPC", async () => {
  let args: Record<string, unknown> | null = null;
  const buyerCommand = { ...command, outcome: "buyer_wins", buyerRefundAmount: "92.5" };
  const buyerResult = { ...result, outcome: "buyer_wins", buyer_refund_amount: "92.5", deal_dispute_status: "resolved_buyer" };
  const saved = await persistW3MDisputeDecision({
    rpc: async (_name, input) => { args = input; return { data: buyerResult, error: null }; },
  }, { command: buyerCommand, actorId });
  assertEquals(args?.p_buyer_refund_amount, "92.5");
  assertEquals(saved.buyerRefundAmount, "92.5");
});

Deno.test("decision service rejects invalid actor and browser-supplied authority fields before RPC", async () => {
  let called = false;
  const client = { rpc: async () => { called = true; return { data: result, error: null }; } };
  await assertRejects(() => persistW3MDisputeDecision(client, { command, actorId: "not-admin" }));
  await assertRejects(() => persistW3MDisputeDecision(client, { command: { ...command, actorId }, actorId }));
  assertEquals(called, false);
});

Deno.test("decision service fails closed on RPC error or mismatched state response", async () => {
  await assertRejects(() => persistW3MDisputeDecision({
    rpc: async () => ({ data: null, error: { message: "internal database details" } }),
  }, { command, actorId }));
  await assertRejects(() => persistW3MDisputeDecision({
    rpc: async () => ({ data: { ...result, deal_dispute_status: "resolved_buyer" }, error: null }),
  }, { command, actorId }));
});
