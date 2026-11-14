import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import { appendDealActivityEvent, type DealActivityParticipants } from "./activity-ledger.ts";

const participants: DealActivityParticipants = {
  dealId: "deal-42",
  buyerId: "buyer-1",
  sellerId: "seller-1",
  adminIds: ["admin-1"],
  systemActorId: "w3m-system",
};

const buyerOffer = {
  id: "event-1",
  dealId: "deal-42",
  type: "offer_submitted" as const,
  actorId: "buyer-1",
  actorRole: "buyer" as const,
  occurredAt: 100,
  summary: "Buyer submitted an initial offer.",
  referenceId: "offer-1",
};

Deno.test("appends chronological events with stable sequence and previous-event linkage", () => {
  const one = appendDealActivityEvent([], participants, buyerOffer);
  const two = appendDealActivityEvent(one, participants, {
    id: "event-2", dealId: "deal-42", type: "counter_offer_submitted",
    actorId: "seller-1", actorRole: "seller", occurredAt: 101,
    summary: "Seller submitted a counter-offer.", referenceId: "offer-2",
  });
  assertEquals(two.map(e => e.sequence), [1, 2]);
  assertEquals(two.map(e => e.previousEventId), [null, "event-1"]);
  assertEquals(one.length, 1);
});

Deno.test("rejects actor identity and role spoofing", () => {
  assertThrows(() => appendDealActivityEvent([], participants, {
    ...buyerOffer, id: "spoof-1", actorId: "buyer-1", actorRole: "seller",
  }));
  assertThrows(() => appendDealActivityEvent([], participants, {
    ...buyerOffer, id: "spoof-2", actorId: "intruder",
  }));
});

Deno.test("requires admin identity for administrative review and dispute decisions", () => {
  for (const type of ["dispute_reviewed", "dispute_decision_recorded", "admin_review_recorded"] as const) {
    assertThrows(() => appendDealActivityEvent([], participants, {
      ...buyerOffer, id: "admin-required-" + type, type,
    }));
  }
  const approved = appendDealActivityEvent([], participants, {
    ...buyerOffer, id: "admin-event", type: "dispute_decision_recorded",
    actorId: "admin-1", actorRole: "admin",
  });
  assertEquals(approved[0].actorRole, "admin");
});

Deno.test("requires system actor for chain and terminal completion claims", () => {
  for (const type of ["deposit_detected", "safe_lock_confirmed", "payout_execution_confirmed", "deal_completed"] as const) {
    assertThrows(() => appendDealActivityEvent([], participants, {
      ...buyerOffer, id: "system-required-" + type, type,
    }));
  }
  const event = appendDealActivityEvent([], participants, {
    ...buyerOffer, id: "system-event", type: "deposit_detected",
    actorId: "w3m-system", actorRole: "system",
  });
  assertEquals(event[0].actorRole, "system");
});

Deno.test("rejects duplicate IDs, mixed deal IDs and out-of-order timestamps", () => {
  const one = appendDealActivityEvent([], participants, buyerOffer);
  assertThrows(() => appendDealActivityEvent(one, participants, buyerOffer));
  assertThrows(() => appendDealActivityEvent(one, participants, {
    ...buyerOffer, id: "other-deal", dealId: "deal-99", occurredAt: 101,
  }));
  assertThrows(() => appendDealActivityEvent(one, participants, {
    ...buyerOffer, id: "backdated", occurredAt: 99,
  }));
});

Deno.test("rejects invalid summaries, references and participant rosters", () => {
  assertThrows(() => appendDealActivityEvent([], participants, {
    ...buyerOffer, id: "empty-summary", summary: "  ",
  }));
  assertThrows(() => appendDealActivityEvent([], participants, {
    ...buyerOffer, id: "empty-ref", referenceId: " ",
  }));
  assertThrows(() => appendDealActivityEvent([], {
    ...participants, buyerId: "buyer-1", sellerId: "buyer-1",
  }, buyerOffer));
  assertThrows(() => appendDealActivityEvent([], {
    ...participants, adminIds: ["admin-1", "admin-1"],
  }, buyerOffer));
});

Deno.test("ledger, event objects and entries are frozen against in-place mutation", () => {
  const ledger = appendDealActivityEvent([], participants, buyerOffer);
  assertEquals(Object.isFrozen(ledger), true);
  assertEquals(Object.isFrozen(ledger[0]), true);
  assertEquals(Reflect.set(ledger[0], "summary", "tampered"), false);
  assertThrows(() => (ledger as unknown as Array<unknown>).push({}));
  assertEquals(ledger[0].summary, buyerOffer.summary);
});

Deno.test("a message event is a reference, not a substitute for formal approval", () => {
  const ledger = appendDealActivityEvent([], participants, {
    ...buyerOffer, id: "message-event", type: "message_posted",
    referenceId: "chat-message-9",
  });
  assertEquals(ledger[0].type, "message_posted");
  assertEquals(ledger[0].referenceId, "chat-message-9");
});

Deno.test("asset acceptance and asset transfer events require the correct party", () => {
  assertThrows(() => appendDealActivityEvent([], participants, {
    ...buyerOffer, id: "wrong-acceptor", type: "buyer_asset_accepted",
    actorId: "seller-1", actorRole: "seller",
  }));
  assertThrows(() => appendDealActivityEvent([], participants, {
    ...buyerOffer, id: "wrong-transferor", type: "asset_transfer_submitted",
    actorId: "buyer-1", actorRole: "buyer",
  }));
  const accepted = appendDealActivityEvent([], participants, {
    ...buyerOffer, id: "buyer-accept", type: "buyer_asset_accepted",
  });
  assertEquals(accepted[0].actorRole, "buyer");
});

Deno.test("payout requests require an authorized admin decision actor", () => {
  assertThrows(() => appendDealActivityEvent([], participants, {
    ...buyerOffer, id: "buyer-payout", type: "payout_requested",
  }));
  const request = appendDealActivityEvent([], participants, {
    ...buyerOffer, id: "admin-payout", type: "payout_requested",
    actorId: "admin-1", actorRole: "admin",
  });
  assertEquals(request[0].actorRole, "admin");
});
