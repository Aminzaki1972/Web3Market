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
  assertThrows(() => store.releaseDeclinedHold("buyer-1", "req-1", "Release", 120));
  assertThrows(() => store.releaseDeclinedHold("admin-1", "req-1", " ", 120));
  const released = store.releaseDeclinedHold("admin-1", "req-1", "No other hold remains", 120);
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
