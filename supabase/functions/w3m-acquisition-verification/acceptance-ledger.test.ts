import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import {
  buildW3MAcceptanceRecord,
  evaluateW3MAcceptanceLedger,
  hasBothW3MPartyAcceptances,
  type W3MAcceptanceCandidateInput,
} from "./acceptance-ledger.ts";

const NOW = 1_800_000_000;
const base: W3MAcceptanceCandidateInput = {
  dealId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  auditId: "33333333-3333-4333-8333-333333333333",
  fingerprintId: "44444444-4444-4444-8444-444444444444",
  fingerprintDigest: "a".repeat(64),
  bindingHash: "0x" + "b".repeat(64),
  termsHash: "0x" + "c".repeat(64),
  termsVersion: "1",
  partyRole: "buyer",
  authenticatedUserId: "55555555-5555-4555-8555-555555555555",
  buyerUserId: "55555555-5555-4555-8555-555555555555",
  sellerUserId: "66666666-6666-4666-8666-666666666666",
  verifiedWalletAddress: "0x" + "11".repeat(20),
  recoveredSignerAddress: "0x" + "11".repeat(20),
  nonce: "0x" + "d".repeat(64),
  deadline: NOW + 120,
  acceptedAt: "2027-01-15T12:00:00.000Z",
};

Deno.test("builds a canonical immutable buyer acceptance record", () => {
  const record = buildW3MAcceptanceRecord(base, NOW);
  assertEquals(record.party_role, "buyer");
  assertEquals(record.user_id, base.buyerUserId);
  assertEquals(record.fingerprint_digest, "0x" + "a".repeat(64));
  assertEquals(Object.isFrozen(record), true);
});

Deno.test("rejects a user who is not the trusted deal participant for the claimed role", async () => {
  await assertRejects(async () => {
    buildW3MAcceptanceRecord({ ...base, authenticatedUserId: base.sellerUserId }, NOW);
  });
  await assertRejects(async () => {
    buildW3MAcceptanceRecord({ ...base, partyRole: "seller" }, NOW);
  });
});

Deno.test("rejects mismatched signer, malformed evidence, and expired challenge", async () => {
  await assertRejects(async () => {
    buildW3MAcceptanceRecord({ ...base, recoveredSignerAddress: "0x" + "22".repeat(20) }, NOW);
  });
  await assertRejects(async () => {
    buildW3MAcceptanceRecord({ ...base, bindingHash: "bad" }, NOW);
  });
  await assertRejects(async () => {
    buildW3MAcceptanceRecord({ ...base, deadline: NOW }, NOW);
  });
});

Deno.test("ledger preflight rejects a reused nonce and a second acceptance for the same role", () => {
  const buyer = buildW3MAcceptanceRecord(base, NOW);
  assertEquals(evaluateW3MAcceptanceLedger(buyer, []), {
    allowed: true,
    reason: "new_party_acceptance",
  });
  assertEquals(evaluateW3MAcceptanceLedger(buyer, [{
    deal_id: "99999999-9999-4999-8999-999999999999",
    party_role: "seller",
    nonce: buyer.nonce,
  }]), { allowed: false, reason: "nonce_already_used" });
  assertEquals(evaluateW3MAcceptanceLedger({
    ...buyer,
    nonce: "0x" + "e".repeat(64),
  }, [buyer]), { allowed: false, reason: "party_role_already_accepted" });
});

Deno.test("requires both distinct parties to accept the same terms and audit binding", () => {
  const buyer = buildW3MAcceptanceRecord(base, NOW);
  const seller = buildW3MAcceptanceRecord({
    ...base,
    partyRole: "seller",
    authenticatedUserId: base.sellerUserId,
    verifiedWalletAddress: "0x" + "22".repeat(20),
    recoveredSignerAddress: "0x" + "22".repeat(20),
    nonce: "0x" + "e".repeat(64),
  }, NOW);
  assertEquals(hasBothW3MPartyAcceptances([buyer], {
    dealId: base.dealId,
    termsHash: base.termsHash,
    bindingHash: base.bindingHash,
  }), false);
  assertEquals(hasBothW3MPartyAcceptances([buyer, seller], {
    dealId: base.dealId,
    termsHash: base.termsHash,
    bindingHash: base.bindingHash,
  }), true);
  assertEquals(hasBothW3MPartyAcceptances([buyer, {
    ...seller,
    terms_hash: "0x" + "f".repeat(64),
  }], {
    dealId: base.dealId,
    termsHash: base.termsHash,
    bindingHash: base.bindingHash,
  }), false);
});
