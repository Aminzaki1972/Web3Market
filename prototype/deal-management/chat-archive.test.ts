import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import { appendDealChatMessage, type DealChatMessage, type DealChatParticipants } from "./chat-archive.ts";

const participants: DealChatParticipants = {
  buyerId: "buyer-1",
  sellerId: "seller-1",
  adminIds: ["admin-1"],
};
const first: DealChatMessage = {
  id: "m1", dealId: "deal-1", authorId: "buyer-1", role: "buyer",
  createdAt: 100, content: "Please confirm the repository transfer.",
  attachmentRefs: [],
};

Deno.test("buyer and seller can append to the same deal conversation", () => {
  const a = appendDealChatMessage([], participants, first);
  const b = appendDealChatMessage(a, participants, {
    id: "m2", dealId: "deal-1", authorId: "seller-1", role: "seller",
    createdAt: 101, content: "Transfer is complete; evidence attached.",
    attachmentRefs: ["evidence-1"],
  });
  assertEquals(b.map(m => m.role), ["buyer", "seller"]);
  assertEquals(a.length, 1);
  assertEquals(b[1].attachmentRefs, ["evidence-1"]);
});

Deno.test("admin may join as an optional participant only when listed for this deal", () => {
  const a = appendDealChatMessage([], participants, {
    id: "m-admin", dealId: "deal-1", authorId: "admin-1", role: "admin",
    createdAt: 100, content: "I am reviewing the submitted evidence.",
    attachmentRefs: [],
  });
  assertEquals(a[0].role, "admin");
  assertThrows(() => appendDealChatMessage([], participants, {
    id: "m-admin-2", dealId: "deal-1", authorId: "unknown-admin", role: "admin",
    createdAt: 100, content: "Unauthorized", attachmentRefs: [],
  }));
});

Deno.test("sender cannot spoof another participant role or identity", () => {
  assertThrows(() => appendDealChatMessage([], participants, {
    ...first, id: "spoof-1", authorId: "buyer-1", role: "seller",
  }));
  assertThrows(() => appendDealChatMessage([], participants, {
    ...first, id: "spoof-2", authorId: "unknown", role: "buyer",
  }));
});

Deno.test("archive rejects duplicate IDs, mixed deal IDs and backdated messages", () => {
  const a = appendDealChatMessage([], participants, first);
  assertThrows(() => appendDealChatMessage(a, participants, first));
  assertThrows(() => appendDealChatMessage(a, participants, {
    ...first, id: "m-other", dealId: "deal-2", createdAt: 101,
  }));
  assertThrows(() => appendDealChatMessage(a, participants, {
    ...first, id: "m-backdated", createdAt: 99,
  }));
});

Deno.test("archive rejects empty content without attachment and invalid attachment references", () => {
  assertThrows(() => appendDealChatMessage([], participants, {
    ...first, id: "empty", content: "   ",
  }));
  assertThrows(() => appendDealChatMessage([], participants, {
    ...first, id: "bad-ref", attachmentRefs: [" ", " "],
  }));
  assertThrows(() => appendDealChatMessage([], participants, {
    ...first, id: "too-long", content: "x".repeat(2001),
  }));
});

Deno.test("corrections are appended as new messages referencing an earlier message", () => {
  const a = appendDealChatMessage([], participants, first);
  const b = appendDealChatMessage(a, participants, {
    id: "m2", dealId: "deal-1", authorId: "buyer-1", role: "buyer",
    createdAt: 101, content: "Correction: I meant the organization transfer, not a repository invite.",
    attachmentRefs: [], correctionOf: "m1",
  });
  assertEquals(b.length, 2);
  assertEquals(b[0], first);
  assertEquals(b[1].correctionOf, "m1");
  assertThrows(() => appendDealChatMessage(a, participants, {
    id: "m3", dealId: "deal-1", authorId: "buyer-1", role: "buyer",
    createdAt: 101, content: "Correction", attachmentRefs: [], correctionOf: "missing",
  }));
});
