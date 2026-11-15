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
