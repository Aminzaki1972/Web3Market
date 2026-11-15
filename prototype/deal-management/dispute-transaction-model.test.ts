import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import { InMemoryDisputeTransactionModel } from "./dispute-transaction-model.ts";
import type { TrustedDealRoster } from "./deal-authorization.ts";

const roster: TrustedDealRoster = {
  dealId: "deal-tx-1", buyerId: "buyer-1", sellerId: "seller-1",
  activeAdminIds: ["admin-1"],
};
const evidence = [{ id: "ev-1", description: "Evidence item", submittedAt: 90 }];
const makeStore = () => new InMemoryDisputeTransactionModel(roster);

Deno.test("submission atomically creates request, payout hold and first lifecycle event", () => {
  const store = makeStore();
  const request = store.submit("buyer-1", "req-1", "idem-1", "Reason", 100, evidence);
  assertEquals(request.status, "pending_admin_review");
  assertEquals(store.hasActiveHold(), true);
  assertEquals(store.canIssuePayoutInstruction(), false);
  assertEquals(store.getEvents("req-1").length, 1);
  assertEquals(store.getEvents("req-1")[0].type, "request_submitted");
});

Deno.test("same idempotency key and same payload returns the original request without duplicate event", () => {
  const store = makeStore();
  const first = store.submit("buyer-1", "req-1", "idem-1", "Reason", 100, evidence);
  const retry = store.submit("buyer-1", "req-retry", "idem-1", "Reason", 100, evidence);
  assertEquals(retry, first);
  assertEquals(store.getEvents("req-1").length, 1);
  assertEquals(store.getEvents("req-retry").length, 0);
});

Deno.test("idempotency key reuse with different payload is rejected", () => {
  const store = makeStore();
  store.submit("buyer-1", "req-1", "idem-1", "Reason", 100, evidence);
  assertThrows(() => store.submit("buyer-1", "req-2", "idem-1", "Different reason", 100, evidence));
  assertEquals(store.getEvents("req-1").length, 1);
  assertEquals(store.getRequest("req-2"), null);
});

Deno.test("a second buyer or seller submission cannot create a conflicting active hold", () => {
  const store = makeStore();
  store.submit("buyer-1", "req-1", "idem-1", "Reason", 100, evidence);
  assertThrows(() => store.submit("seller-1", "req-2", "idem-2", "Other reason", 101, evidence));
  assertEquals(store.getRequest("req-2"), null);
  assertEquals(store.getEvents("req-1").length, 1);
  assertEquals(store.canIssuePayoutInstruction(), false);
});

Deno.test("only the active administrator can review and both outcomes retain the payout hold", () => {
  const store = makeStore();
  store.submit("seller-1", "req-1", "idem-1", "Reason", 100, evidence);
  assertThrows(() => store.review("buyer-1", "req-1", "approved", "Review", 110));
  const declined = store.review("admin-1", "req-1", "declined", "Insufficient evidence", 110);
  assertEquals(declined.status, "declined_hold");
  assertEquals(store.hasActiveHold(), true);
  assertEquals(store.canIssuePayoutInstruction(), false);
  assertEquals(store.getEvents("req-1").map(event => event.sequence), [1, 2]);
});

Deno.test("declined hold release is separate, reasoned, admin-only and append-only", () => {
  const store = makeStore();
  store.submit("buyer-1", "req-1", "idem-1", "Reason", 100, evidence);
  store.review("admin-1", "req-1", "declined", "No qualifying breach", 110);
  assertThrows(() => store.releaseDeclinedHold("buyer-1", "req-1", "Release", 120, false));
  assertThrows(() => store.releaseDeclinedHold("admin-1", "req-1", " ", 120, false));
  assertThrows(() => store.releaseDeclinedHold("admin-1", "req-1", "Another hold is still active", 120, true));
  assertEquals(store.hasActiveHold(), true);
  const released = store.releaseDeclinedHold("admin-1", "req-1", "No other hold remains", 120, false);
  assertEquals(released.status, "administrative_hold_released");
  assertEquals(store.hasActiveHold(), false);
  assertEquals(store.canIssuePayoutInstruction(), true);
  assertEquals(store.getEvents("req-1").map(event => event.type), [
    "request_submitted", "request_declined", "declined_hold_released",
  ]);
});

Deno.test("approved request remains payout-held pending separately verified Safe lock", () => {
  const store = makeStore();
  store.submit("buyer-1", "req-1", "idem-1", "Reason", 100, evidence);
  const approved = store.review("admin-1", "req-1", "approved", "Open dispute", 110);
  assertEquals(approved.status, "approved_lock_pending");
  assertEquals(store.hasActiveHold(), true);
  assertEquals(store.canIssuePayoutInstruction(), false);
});

Deno.test("missing evidence, invalid actors and duplicate request IDs do not partially commit", () => {
  const store = makeStore();
  assertThrows(() => store.submit("buyer-1", "req-1", "idem-1", "Reason", 100, []));
  assertEquals(store.hasActiveHold(), false);
  assertEquals(store.getEvents("req-1").length, 0);
  store.submit("buyer-1", "req-1", "idem-1", "Reason", 100, evidence);
  assertThrows(() => store.submit("outsider", "req-2", "idem-2", "Reason", 101, evidence));
  assertThrows(() => store.submit("seller-1", "req-1", "idem-3", "Reason", 101, evidence));
  assertEquals(store.getEvents("req-1").length, 1);
  assertEquals(store.getEvents("req-2").length, 0);
});

Deno.test("events are returned as immutable snapshots with monotonic sequence numbers", () => {
  const store = makeStore();
  store.submit("buyer-1", "req-1", "idem-1", "Reason", 100, evidence);
  store.review("admin-1", "req-1", "approved", "Open", 110);
  const events = store.getEvents("req-1");
  assertEquals(events.map(event => event.sequence), [1, 2]);
  assertThrows(() => (events as unknown as { push(value: unknown): number }).push({}));
});

Deno.test("stored request and evidence are defensive immutable snapshots", () => {
  const store = makeStore();
  const mutableEvidence = [{ id: "ev-1", description: "Original evidence", submittedAt: 90 }];
  const request = store.submit("buyer-1", "req-1", "idem-1", "Reason", 100, mutableEvidence);
  mutableEvidence[0].description = "Tampered after submission";
  assertEquals(store.getRequest("req-1")?.evidence[0].description, "Original evidence");
  assertThrows(() => { (request as unknown as { reason: string }).reason = "Tampered"; });
  assertThrows(() => { (request.evidence[0] as unknown as { description: string }).description = "Tampered"; });
  assertEquals(store.getRequest("req-1")?.reason, "Reason");
  assertEquals(store.getEvents("req-1").length, 1);
});

Deno.test("idempotency fingerprint ignores evidence object property insertion order", () => {
  const store = makeStore();
  const firstEvidence = [{ id: "ev-1", description: "Evidence item", submittedAt: 90 }];
  const reorderedEvidence = [{ submittedAt: 90, description: "Evidence item", id: "ev-1" }];
  const first = store.submit("buyer-1", "req-1", "idem-1", "Reason", 100, firstEvidence);
  const retry = store.submit("buyer-1", "req-2", "idem-1", "Reason", 100, reorderedEvidence);
  assertEquals(retry, first);
  assertEquals(store.getEvents("req-1").length, 1);
  assertEquals(store.getRequest("req-2"), null);
});


Deno.test("dispute transitions append matching entries to the unified immutable Deal Room activity ledger", () => {
  const store = makeStore();
  store.submit("buyer-1", "req-1", "idem-1", "Reason", 100, evidence);
  store.review("admin-1", "req-1", "approved", "Evidence supports review", 110);
  const ledger = store.getActivityLedger();
  assertEquals(ledger.map(event => event.type), ["dispute_requested", "dispute_reviewed"]);
  assertEquals(ledger.map(event => event.sequence), [1, 2]);
  assertEquals(ledger.map(event => event.previousEventId), [null, "req-1:activity:1"]);
  assertEquals(ledger.map(event => event.actorRole), ["buyer", "admin"]);
  assertEquals(ledger.map(event => event.referenceId), ["req-1", "req-1"]);
  assertEquals(Object.isFrozen(ledger), true);
  assertEquals(Object.isFrozen(ledger[0]), true);
});

Deno.test("declined hold release appends a third admin event without rewriting earlier activity", () => {
  const store = makeStore();
  store.submit("seller-1", "req-1", "idem-1", "Reason", 100, evidence);
  store.review("admin-1", "req-1", "declined", "Insufficient evidence", 110);
  const beforeRelease = store.getActivityLedger();
  const released = store.releaseDeclinedHold("admin-1", "req-1", "No other hold remains", 120);
  const afterRelease = store.getActivityLedger();
  assertEquals(released.status, "administrative_hold_released");
  assertEquals(beforeRelease.length, 2);
  assertEquals(afterRelease.length, 3);
  assertEquals(afterRelease.map(event => event.type), [
    "dispute_requested", "dispute_reviewed", "admin_review_recorded",
  ]);
  assertEquals(afterRelease.map(event => event.sequence), [1, 2, 3]);
  assertEquals(afterRelease[2].previousEventId, afterRelease[1].id);
  assertEquals(beforeRelease.length, 2);
});
