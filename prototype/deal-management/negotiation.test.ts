import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import {
  applyPriceAction, approveAgreement, createAgreement, isAgreementFullyApproved,
  reviseAgreement, startNegotiation,
} from "./negotiation.ts";

const H1 = "0x" + "1".repeat(64);
const H2 = "0x" + "2".repeat(64);

Deno.test("seller preliminary acceptance does not lock buyer's initial price", () => {
  const initial = startNegotiation(10_000_000_000n, 7_000_000_000n, "buyer-1");
  const preliminary = applyPriceAction(initial, "seller", {
    type: "preliminary_seller_accept", offerId: "buyer-1",
  });
  assertEquals(preliminary.preliminarySellerAcceptance, true);
  assertEquals(preliminary.finalPriceAccepted, false);
  assertEquals(preliminary.offers[0].status, "open");

  const counter = applyPriceAction(preliminary, "seller", {
    type: "counter", offerId: "seller-1", amountUsdt: 7_500_000_000n,
  });
  assertEquals(counter.offers[0].status, "superseded");
  assertEquals(counter.offers[1].amountUsdt, 7_500_000_000n);
  assertEquals(counter.finalPriceAccepted, false);
});

Deno.test("only the other party may accept an open offer; acceptance closes price negotiation", () => {
  const state = startNegotiation(10_000n, 7_000n, "b1");
  assertThrows(() => applyPriceAction(state, "buyer", { type: "accept", offerId: "b1" }));
  const accepted = applyPriceAction(state, "seller", { type: "accept", offerId: "b1" });
  assertEquals(accepted.finalPriceAccepted, true);
  assertThrows(() => applyPriceAction(accepted, "buyer", { type: "counter", offerId: "b2", amountUsdt: 8_000n }));
});

Deno.test("agreement requires approvals from buyer, seller and platform on exact snapshot", () => {
  let agreement = createAgreement(1, H1);
  agreement = approveAgreement(agreement, "buyer", 1, H1);
  agreement = approveAgreement(agreement, "seller", 1, H1);
  assertEquals(isAgreementFullyApproved(agreement), false);
  agreement = approveAgreement(agreement, "platform", 1, H1);
  assertEquals(isAgreementFullyApproved(agreement), true);
  assertThrows(() => approveAgreement(agreement, "buyer", 1, H1));
  assertThrows(() => approveAgreement(agreement, "seller", 1, H2));
});

Deno.test("revising agreement increments version and clears all earlier approvals", () => {
  let agreement = createAgreement(1, H1);
  agreement = approveAgreement(agreement, "buyer", 1, H1);
  agreement = approveAgreement(agreement, "seller", 1, H1);
  agreement = reviseAgreement(agreement, 2, H2);
  assertEquals(agreement.approvals, {});
  assertEquals(isAgreementFullyApproved(agreement), false);
  assertThrows(() => approveAgreement(agreement, "buyer", 1, H1));
  agreement = approveAgreement(agreement, "buyer", 2, H2);
  agreement = approveAgreement(agreement, "seller", 2, H2);
  agreement = approveAgreement(agreement, "platform", 2, H2);
  assertEquals(isAgreementFullyApproved(agreement), true);
});
