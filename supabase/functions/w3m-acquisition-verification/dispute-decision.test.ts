import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import {
  buildW3MCanonicalDisputeDecision,
  parseW3MDisputeDecisionCommand,
  type W3MDisputeDecisionCommand,
  type W3MCanonicalDisputeDecisionInput,
  type W3MCanonicalDisputeEvidenceReference,
} from "./dispute-decision.ts";

const dealId = "81000000-0000-4000-8000-000000000001";
const disputeId = "82000000-0000-4000-8000-000000000002";
const decisionId = "83000000-0000-4000-8000-000000000003";
const actorId = "84000000-0000-4000-8000-000000000004";
const termsVersionId = "85000000-0000-4000-8000-000000000005";
const messageId = "86000000-0000-4000-8000-000000000006";
const assetId = "87000000-0000-4000-8000-000000000007";
const command: W3MDisputeDecisionCommand = {
  dealId, disputeId, outcome: "buyer_wins",
  reason: "The seller did not transfer the agreed project ownership.",
  buyerRefundAmount: "92.5",
  evidenceRefs: [
    { source: "deal_asset", recordId: assetId },
    { source: "deal_message", recordId: messageId },
  ],
};
const canonicalInput: W3MCanonicalDisputeDecisionInput = {
  ...command,
  evidenceRefs: command.evidenceRefs.map((item, index): W3MCanonicalDisputeEvidenceReference => ({ ...item, contentHash: index === 0 ? "11".repeat(32) : "22".repeat(32) })),
  priorState: { dealStatus: "disputed", dealDisputeStatus: "under_review", disputeRecordStatus: "open" },
  decisionId, decidedBy: actorId,
  decidedAt: "2026-11-15T21:00:00.000Z",
  termsVersionId, termsVersion: "2", termsHash: "ab".repeat(32),
};

Deno.test("decision command accepts only bounded outcome, reason, and existing evidence reference shapes", () => {
  const parsed = parseW3MDisputeDecisionCommand(command);
  assertEquals(parsed.dealId, dealId);
  assertEquals(parsed.outcome, "buyer_wins");
  assertEquals(parsed.evidenceRefs.length, 2);
});

Deno.test("decision command rejects caller-supplied authority, timestamps, terms, refund and Safe fields", async () => {
  for (const extra of [
    { actorId }, { decidedBy: actorId }, { decidedAt: "2026-11-15T21:00:00.000Z" },
    { termsVersion: "2" }, { termsHash: "ab".repeat(32) },
    { refundAmount: "100" }, { refundRecipient: "0x1111111111111111111111111111111111111111" },
    { safeNonce: "9" }, { platformFee: "7.5" },
  ]) {
    await assertRejects(async () => parseW3MDisputeDecisionCommand({ ...command, ...extra }));
  }
});

Deno.test("decision command rejects unsupported outcomes, weak reasons, invalid IDs and duplicate evidence", async () => {
  await assertRejects(async () => parseW3MDisputeDecisionCommand({ ...command, outcome: "split" }));
  await assertRejects(async () => parseW3MDisputeDecisionCommand({ ...command, buyerRefundAmount: "0" }));
  await assertRejects(async () => parseW3MDisputeDecisionCommand({ ...command, buyerRefundAmount: "1.1234567890123456789" }));
  await assertRejects(async () => parseW3MDisputeDecisionCommand({ ...command, outcome: "seller_wins" }));
  await assertRejects(async () => parseW3MDisputeDecisionCommand({ ...command, reason: "too short" }));
  await assertRejects(async () => parseW3MDisputeDecisionCommand({ ...command, disputeId: "not-a-uuid" }));
  await assertRejects(async () => parseW3MDisputeDecisionCommand({
    ...command, evidenceRefs: [
      { source: "deal_message", recordId: messageId },
      { source: "deal_message", recordId: messageId },
    ],
  }));
  await assertRejects(async () => parseW3MDisputeDecisionCommand({
    ...command, evidenceRefs: [{ source: "deal_message", recordId: messageId, contentHash: "ab".repeat(32) }],
  }));
});

Deno.test("canonical decision hash is stable across evidence reference ordering", async () => {
  const first = await buildW3MCanonicalDisputeDecision(canonicalInput);
  const second = await buildW3MCanonicalDisputeDecision({
    ...canonicalInput, evidenceRefs: [...canonicalInput.evidenceRefs].reverse(),
  });
  assertEquals(first.decisionHash, second.decisionHash);
  assertEquals(first.payload.evidenceRefs[0].source, "deal_asset");
});

Deno.test("canonical decision hash changes when outcome, reason, evidence, or terms version changes", async () => {
  const base = await buildW3MCanonicalDisputeDecision(canonicalInput);
  const variants = await Promise.all([
    buildW3MCanonicalDisputeDecision({ ...canonicalInput, outcome: "seller_wins", buyerRefundAmount: undefined }),
    buildW3MCanonicalDisputeDecision({ ...canonicalInput, reason: canonicalInput.reason + " Additional finding." }),
    buildW3MCanonicalDisputeDecision({ ...canonicalInput, evidenceRefs: [{ source: "deal_message", recordId: assetId, contentHash: "33".repeat(32) }] }),
    buildW3MCanonicalDisputeDecision({ ...canonicalInput, termsVersion: "3" }),
  ]);
  for (const variant of variants) assertEquals(variant.decisionHash === base.decisionHash, false);
});

Deno.test("canonical decision rejects noncanonical timestamps, invalid terms hash, and invalid server identity", async () => {
  await assertRejects(() => buildW3MCanonicalDisputeDecision({ ...canonicalInput, decidedAt: "yesterday" }));
  await assertRejects(() => buildW3MCanonicalDisputeDecision({ ...canonicalInput, termsHash: "bad" }));
  await assertRejects(() => buildW3MCanonicalDisputeDecision({ ...canonicalInput, evidenceRefs: [{ source: "deal_message", recordId: messageId } as never] }));
  await assertRejects(() => buildW3MCanonicalDisputeDecision({ ...canonicalInput, decidedBy: "browser-admin" }));
  await assertRejects(() => buildW3MCanonicalDisputeDecision({ ...canonicalInput, priorState: { dealStatus: "completed", dealDisputeStatus: "open", disputeRecordStatus: "open" } as never }));
});
