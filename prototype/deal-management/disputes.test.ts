import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import {
  confirmDisputeExecution, issueDisputeDecision, markDisputeExecutionPending,
  markResponseExpired, openDispute, submitClaimantEvidence, submitRespondentResponse,
} from "./disputes.ts";
import { parseUsdtAmount } from "./core.ts";

const total = parseUsdtAmount("7000");
const allocation = { buyerRefund: parseUsdtAmount("1000"), sellerPayout: parseUsdtAmount("5475"), platformFee: parseUsdtAmount("525") };
const claimantEvidence = { id: "e1", submittedBy: "buyer" as const, description: "Transfer proof", submittedAt: 100 };
const respondentEvidence = { id: "e2", submittedBy: "seller" as const, description: "Delivery proof", submittedAt: 150 };

Deno.test("dispute requires claimant evidence before respondent response", () => {
  let d = openDispute("d1", "buyer", 100, 100);
  assertThrows(() => submitRespondentResponse(d, "seller", respondentEvidence, 150));
  d = submitClaimantEvidence(d, "buyer", claimantEvidence);
  d = submitRespondentResponse(d, "seller", respondentEvidence, 150);
  assertEquals(d.status, "response_received");
  assertEquals(d.evidence.length, 2);
});

Deno.test("respondent cannot reply after deadline; non-response is explicitly recorded", () => {
  let d = openDispute("d2", "buyer", 100, 100);
  d = submitClaimantEvidence(d, "buyer", claimantEvidence);
  assertThrows(() => submitRespondentResponse(d, "seller", { ...respondentEvidence, submittedAt: 201 }, 201));
  d = markResponseExpired(d, 200);
  assertEquals(d.status, "response_expired");
});

Deno.test("decision requires reasons and allocations reconciling to the deposited amount", () => {
  let d = openDispute("d3", "buyer", 100, 100);
  d = submitClaimantEvidence(d, "buyer", claimantEvidence);
  d = submitRespondentResponse(d, "seller", respondentEvidence, 150);
  assertThrows(() => issueDisputeDecision(d, "", allocation, total, 160));
  assertThrows(() => issueDisputeDecision(d, "Reason", { ...allocation, platformFee: 1n }, total, 160));
  d = issueDisputeDecision(d, "Evidence reviewed", allocation, total, 160);
  assertEquals(d.status, "decided");
  assertThrows(() => issueDisputeDecision(d, "Second decision", allocation, total, 170));
});

Deno.test("dispute execution is not complete until confirmed Safe receipt", () => {
  let d = openDispute("d4", "buyer", 100, 100);
  d = submitClaimantEvidence(d, "buyer", claimantEvidence);
  d = markResponseExpired(d, 200);
  d = issueDisputeDecision(d, "No response received", allocation, total, 210);
  d = markDisputeExecutionPending(d);
  assertThrows(() => confirmDisputeExecution(d, "0x" + "a".repeat(64), false, 220));
  d = confirmDisputeExecution(d, "0x" + "a".repeat(64), true, 220);
  assertEquals(d.status, "executed");
});
