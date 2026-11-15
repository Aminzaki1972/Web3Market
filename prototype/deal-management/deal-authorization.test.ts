import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import { authorizeDealAction, resolveDealActor, type TrustedDealRoster } from "./deal-authorization.ts";

const roster: TrustedDealRoster = {
  dealId: "deal-1", buyerId: "buyer-1", sellerId: "seller-1",
  activeAdminIds: ["admin-1"],
};

Deno.test("actor role is derived from authenticated identity and trusted roster", () => {
  assertEquals(resolveDealActor("buyer-1", roster), "buyer");
  assertEquals(resolveDealActor("seller-1", roster), "seller");
  assertEquals(resolveDealActor("admin-1", roster), "admin");
  assertEquals(resolveDealActor("outsider", roster), null);
});

Deno.test("buyer and seller can read and submit dispute workflow actions", () => {
  assertEquals(authorizeDealAction("buyer-1", roster, "submit_dispute_request"), "buyer");
  assertEquals(authorizeDealAction("seller-1", roster, "submit_dispute_evidence"), "seller");
  assertEquals(authorizeDealAction("buyer-1", roster, "respond_to_dispute"), "buyer");
});

Deno.test("buyer and seller cannot access admin workspace or decisions", () => {
  for (const action of [
    "read_admin_workspace", "review_dispute_request",
    "record_dispute_decision", "release_declined_hold",
  ] as const) {
    assertThrows(() => authorizeDealAction("buyer-1", roster, action));
    assertThrows(() => authorizeDealAction("seller-1", roster, action));
  }
});

Deno.test("administrator can review but cannot act as a deal participant", () => {
  assertEquals(authorizeDealAction("admin-1", roster, "review_dispute_request"), "admin");
  assertEquals(authorizeDealAction("admin-1", roster, "record_dispute_decision"), "admin");
  assertThrows(() => authorizeDealAction("admin-1", roster, "submit_dispute_request"));
  assertThrows(() => authorizeDealAction("admin-1", roster, "send_message"));
});

Deno.test("multiple active admins fail closed", () => {
  const invalid = { ...roster, activeAdminIds: ["admin-1", "admin-2"] };
  assertThrows(() => resolveDealActor("admin-1", invalid));
  assertThrows(() => authorizeDealAction("buyer-1", invalid, "read_deal"));
});

Deno.test("admin cannot be buyer or seller and duplicate admin IDs are rejected", () => {
  assertThrows(() => resolveDealActor("buyer-1", { ...roster, activeAdminIds: ["buyer-1"] }));
  assertThrows(() => resolveDealActor("admin-1", { ...roster, activeAdminIds: ["admin-1", "admin-1"] }));
});

Deno.test("unknown users and blank identities are denied", () => {
  assertThrows(() => authorizeDealAction("outsider", roster, "read_deal"));
  assertThrows(() => resolveDealActor(" ", roster));
});
