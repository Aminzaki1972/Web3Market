import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import { submitAuthorizedDisputeRequest, reviewDisputeRequestAsAdmin } from "./dispute-workflow.ts";
import type { TrustedDealRoster } from "./deal-authorization.ts";

const roster: TrustedDealRoster = {
  dealId: "deal-1", buyerId: "buyer-1", sellerId: "seller-1",
  activeAdminIds: ["admin-1"],
};
const evidence = [{ id: "e1", description: "Initial supporting evidence", submittedAt: 90 }];

Deno.test("authenticated buyer or seller identity determines dispute claimant role", () => {
  const buyerRequest = submitAuthorizedDisputeRequest("buyer-1", roster, "req-b", "Reason", 100, evidence);
  const sellerRequest = submitAuthorizedDisputeRequest("seller-1", roster, "req-s", "Reason", 100, evidence);
  assertEquals(buyerRequest.claimant, "buyer");
  assertEquals(sellerRequest.claimant, "seller");
  assertEquals(buyerRequest.status, "pending_admin_review");
  assertEquals(buyerRequest.payoutHold, true);
});

Deno.test("admin and outsiders cannot submit a dispute request as a party", () => {
  assertThrows(() => submitAuthorizedDisputeRequest("admin-1", roster, "req", "Reason", 100, evidence));
  assertThrows(() => submitAuthorizedDisputeRequest("outsider", roster, "req", "Reason", 100, evidence));
});

Deno.test("only the authenticated active admin can review and reviewer ID is not caller supplied", () => {
  const request = submitAuthorizedDisputeRequest("buyer-1", roster, "req", "Reason", 100, evidence);
  assertThrows(() => reviewDisputeRequestAsAdmin("buyer-1", roster, request, "approved", "Reason", 110));
  assertThrows(() => reviewDisputeRequestAsAdmin("outsider", roster, request, "approved", "Reason", 110));
  const reviewed = reviewDisputeRequestAsAdmin("admin-1", roster, request, "approved", "Evidence verified", 110);
  assertEquals(reviewed.review?.reviewerId, "admin-1");
  assertEquals(reviewed.status, "approved_lock_pending");
});

Deno.test("admin cannot review a request for a different deal", () => {
  const request = submitAuthorizedDisputeRequest("buyer-1", roster, "req", "Reason", 100, evidence);
  assertThrows(() => reviewDisputeRequestAsAdmin(
    "admin-1", { ...roster, dealId: "deal-other" }, request, "declined", "Reason", 110,
  ));
});

Deno.test("ambiguous multiple-admin roster fails closed for review", () => {
  const request = submitAuthorizedDisputeRequest("buyer-1", roster, "req", "Reason", 100, evidence);
  assertThrows(() => reviewDisputeRequestAsAdmin(
    "admin-1", { ...roster, activeAdminIds: ["admin-1", "admin-2"] },
    request, "approved", "Reason", 110,
  ));
});


import { issueAuthorizedDisputeDecision } from "./dispute-workflow.ts";
import { openDispute, submitClaimantEvidence, submitRespondentResponse } from "./disputes.ts";
import { submitDisputeRequest, reviewDisputeRequest, confirmDisputeLock } from "./dispute-intake.ts";
import { parseUsdtAmount } from "./core.ts";

Deno.test("only the single active admin may issue a financial dispute decision after confirmed lock", () => {
  const request0 = submitDisputeRequest("decision-1", "deal-1", "buyer", "Reason", 100, evidence);
  const reviewed = reviewDisputeRequest(request0, "approved", "Open dispute", "admin-1", 110);
  const request = confirmDisputeLock(reviewed, {
    chainId: 56, safeAddress: "0x1111111111111111111111111111111111111111",
    expectedSafeAddress: "0x1111111111111111111111111111111111111111",
    txHash: "0x" + "a".repeat(64), receiptStatus: "success",
    confirmations: 15, requiredConfirmations: 12,
    canonicalBlockHash: "0x" + "b".repeat(64), lockEventObserved: true, lockStateVerified: true,
  });
  let dispute = openDispute("decision-1", "buyer", 100, 1000);
  dispute = submitClaimantEvidence(dispute, "buyer", {
    id: "decision-e1", submittedBy: "buyer", description: "Claimant evidence", submittedAt: 105,
  });
  dispute = submitRespondentResponse(dispute, "seller", {
    id: "decision-e2", submittedBy: "seller", description: "Respondent evidence", submittedAt: 120,
  }, 120);
  const total = parseUsdtAmount("1000");
  const allocation = {
    buyerGrossRefund: parseUsdtAmount("175"),
    sellerPayout: parseUsdtAmount("825"),
    platformFee: parseUsdtAmount("75"),
  };
  assertThrows(() => issueAuthorizedDisputeDecision("buyer-1", roster, request, dispute, "Decision", allocation, total, total, 130));
  assertThrows(() => issueAuthorizedDisputeDecision("outsider", roster, request, dispute, "Decision", allocation, total, total, 130));
  assertThrows(() => issueAuthorizedDisputeDecision("admin-1", {...roster, activeAdminIds:["admin-1","admin-2"]}, request, dispute, "Decision", allocation, total, total, 130));
  const decided = issueAuthorizedDisputeDecision("admin-1", roster, request, dispute, "Reasoned decision", allocation, total, total, 130);
  assertEquals(decided.status, "decided");
  assertEquals(decided.decision?.reason, "Reasoned decision");
});

Deno.test("authorized financial decision rejects mismatched request, deal, or unconfirmed lock", () => {
  const pending = submitDisputeRequest("decision-pending", "deal-1", "buyer", "Reason", 100, evidence);
  const dispute = openDispute("decision-pending", "buyer", 100, 1000);
  assertThrows(() => issueAuthorizedDisputeDecision("admin-1", roster, pending, dispute, "Decision", {
    buyerGrossRefund: 100n, sellerPayout: 825n, platformFee: 75n,
  }, 1000n, 1000n, 120));
  const approved = reviewDisputeRequest(pending, "approved", "Open", "admin-1", 110);
  assertThrows(() => issueAuthorizedDisputeDecision("admin-1", roster, approved, dispute, "Decision", {
    buyerGrossRefund: 100n, sellerPayout: 825n, platformFee: 75n,
  }, 1000n, 1000n, 120));
  const wrongDeal = {...approved, dealId:"deal-other"};
  assertThrows(() => issueAuthorizedDisputeDecision("admin-1", roster, wrongDeal, dispute, "Decision", {
    buyerGrossRefund: 100n, sellerPayout: 825n, platformFee: 75n,
  }, 1000n, 1000n, 120));
});
