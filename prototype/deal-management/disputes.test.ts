import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import {
  issueDisputeDecision, markDisputeExecutionPending,
  markResponseExpired, openDispute, submitClaimantEvidence, submitRespondentResponse,
} from "./disputes.ts";
import { parseUsdtAmount } from "./core.ts";

const total = parseUsdtAmount("7000");
const fee = parseUsdtAmount("525");
const grossAmount = parseUsdtAmount("7000");
const allocation = {
  buyerGrossRefund: parseUsdtAmount("2000"),
  sellerPayout: parseUsdtAmount("5000"),
  platformFee: fee,
};
const claimantEvidence = { id: "e1", submittedBy: "buyer" as const, description: "Transfer proof", submittedAt: 110 };
const respondentEvidence = { id: "e2", submittedBy: "seller" as const, description: "Delivery proof", submittedAt: 150 };

Deno.test("dispute requires claimant evidence before respondent response", () => {
  let d = openDispute("d1", "buyer", 100, 100);
  assertThrows(() => submitRespondentResponse(d, "seller", respondentEvidence, 150));
  d = submitClaimantEvidence(d, "buyer", claimantEvidence);
  d = submitRespondentResponse(d, "seller", respondentEvidence, 150);
  assertEquals(d.status, "response_received");
  assertEquals(d.evidence.length, 2);
});

Deno.test("dispute rejects duplicate evidence IDs and future evidence timestamps", () => {
  let d = openDispute("d1b", "buyer", 100, 100);
  d = submitClaimantEvidence(d, "buyer", claimantEvidence);
  assertThrows(() => submitRespondentResponse(d, "seller", { ...respondentEvidence, id: "e1" }, 150));
  assertThrows(() => submitRespondentResponse(d, "seller", { ...respondentEvidence, submittedAt: 160 }, 150));
});

Deno.test("respondent cannot reply after deadline; non-response is explicitly recorded", () => {
  let d = openDispute("d2", "buyer", 100, 100);
  d = submitClaimantEvidence(d, "buyer", claimantEvidence);
  assertThrows(() => submitRespondentResponse(d, "seller", { ...respondentEvidence, submittedAt: 201 }, 201));
  d = markResponseExpired(d, 200);
  assertEquals(d.status, "response_expired");
});

Deno.test("decision requires reasons, valid timing, exact fee and balanced allocation", () => {
  let d = openDispute("d3", "buyer", 100, 100);
  d = submitClaimantEvidence(d, "buyer", claimantEvidence);
  d = submitRespondentResponse(d, "seller", respondentEvidence, 150);
  assertThrows(() => issueDisputeDecision(d, "", allocation, total, grossAmount, 160));
  assertThrows(() => issueDisputeDecision(d, "Wrong fee", { ...allocation, platformFee: 1n }, total, grossAmount, 160));
  assertThrows(() => issueDisputeDecision(d, "Fee shortfall", {
    buyerGrossRefund: parseUsdtAmount("500"), sellerPayout: parseUsdtAmount("6500"), platformFee: fee,
  }, total, grossAmount, 160));
  assertThrows(() => issueDisputeDecision(d, "Deposit/gross mismatch", allocation, total, parseUsdtAmount("8000"), 160));
  assertThrows(() => issueDisputeDecision(d, "Too early", allocation, total, grossAmount, 140));
  d = issueDisputeDecision(d, "Evidence reviewed", allocation, total, grossAmount, 160);
  assertEquals(d.status, "decided");
  assertEquals(d.decision?.allocation.buyerGrossRefund, parseUsdtAmount("2000"));
  assertThrows(() => issueDisputeDecision(d, "Second decision", allocation, total, grossAmount, 170));
});

Deno.test("pure dispute lifecycle cannot self-certify Safe execution", () => {
  let d = openDispute("d4", "buyer", 100, 100);
  d = submitClaimantEvidence(d, "buyer", claimantEvidence);
  d = markResponseExpired(d, 200);
  d = issueDisputeDecision(d, "No response received", {
    buyerGrossRefund: total, sellerPayout: 0n, platformFee: fee,
  }, total, grossAmount, 210);
  d = markDisputeExecutionPending(d);
  assertEquals(d.status, "execution_pending");
});
