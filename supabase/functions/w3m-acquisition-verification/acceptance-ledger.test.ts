import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import {
  buildW3MAcceptanceRecord,
  evaluateW3MAcceptanceLedger,
  hasBothW3MPartyAcceptances,
  hasCompleteW3MAcceptancePair,
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
  signature: "0x" + "ab".repeat(65),
  nonce: "0x" + "d".repeat(64),
  deadline: NOW + 120,
  acceptedAt: "2027-01-15T08:00:00.000Z",
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
    buildW3MAcceptanceRecord({ ...base, signature: "0x1234" }, NOW);
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
    terms_hash: buyer.terms_hash,
    terms_version: buyer.terms_version,
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



Deno.test("allows a new acceptance after a new immutable terms version while preserving old history", () => {
  const versionOne = buildW3MAcceptanceRecord(base, NOW);
  const versionTwo = buildW3MAcceptanceRecord({
    ...base,
    termsVersion: "2",
    termsHash: "0x" + "f".repeat(64),
    nonce: "0x" + "e".repeat(64),
  }, NOW);
  assertEquals(evaluateW3MAcceptanceLedger(versionTwo, [versionOne]), {
    allowed: true,
    reason: "new_party_acceptance",
  });
  assertEquals(evaluateW3MAcceptanceLedger({
    ...versionTwo,
    nonce: "0x" + "9".repeat(64),
  }, [versionTwo]), {
    allowed: false,
    reason: "party_role_already_accepted",
  });
  assertEquals(evaluateW3MAcceptanceLedger({
    ...versionTwo,
    terms_hash: "0x" + "8".repeat(64),
    nonce: "0x" + "7".repeat(64),
  }, [versionTwo]), {
    allowed: false,
    reason: "terms_version_conflict",
  });
});

Deno.test("strict current acceptance pair ignores prior version history but rejects extra rows for the current version", () => {
  const oldBuyer = buildW3MAcceptanceRecord(base, NOW);
  const buyer = buildW3MAcceptanceRecord({
    ...base,
    termsVersion: "2",
    termsHash: "0x" + "f".repeat(64),
    nonce: "0x" + "e".repeat(64),
  }, NOW);
  const seller = buildW3MAcceptanceRecord({
    ...base,
    termsVersion: "2",
    termsHash: "0x" + "f".repeat(64),
    partyRole: "seller",
    authenticatedUserId: base.sellerUserId,
    verifiedWalletAddress: "0x" + "22".repeat(20),
    recoveredSignerAddress: "0x" + "22".repeat(20),
    nonce: "0x" + "9".repeat(64),
  }, NOW);
  const expected = {
    dealId: base.dealId,
    projectId: base.projectId,
    auditId: base.auditId,
    fingerprintId: base.fingerprintId,
    fingerprintDigest: base.fingerprintDigest,
    bindingHash: base.bindingHash,
    termsHash: "0x" + "f".repeat(64),
    termsVersion: "2",
  };
  assertEquals(hasCompleteW3MAcceptancePair([oldBuyer, buyer, seller], expected), true);
  assertEquals(hasCompleteW3MAcceptancePair([oldBuyer, buyer, seller, {
    ...seller,
    nonce: "0x" + "a".repeat(64),
  }], expected), false);
});

Deno.test("strict finalization requires exactly one buyer and seller on identical evidence and terms", () => {
  const buyer = buildW3MAcceptanceRecord(base, NOW);
  const seller = buildW3MAcceptanceRecord({
    ...base,
    partyRole: "seller",
    authenticatedUserId: base.sellerUserId,
    verifiedWalletAddress: "0x" + "22".repeat(20),
    recoveredSignerAddress: "0x" + "22".repeat(20),
    nonce: "0x" + "e".repeat(64),
  }, NOW);
  const expected = {
    dealId: base.dealId,
    projectId: base.projectId,
    auditId: base.auditId,
    fingerprintId: base.fingerprintId,
    fingerprintDigest: base.fingerprintDigest,
    bindingHash: base.bindingHash,
    termsHash: base.termsHash,
    termsVersion: base.termsVersion,
  };
  assertEquals(hasCompleteW3MAcceptancePair([buyer, seller], expected), true);
  assertEquals(hasCompleteW3MAcceptancePair([buyer], expected), false);
  assertEquals(hasCompleteW3MAcceptancePair([buyer, seller, seller], expected), false);
  assertEquals(hasCompleteW3MAcceptancePair([buyer, {
    ...seller,
    audit_id: "77777777-7777-4777-8777-777777777777",
  }], expected), false);
  assertEquals(hasCompleteW3MAcceptancePair([buyer, {
    ...seller,
    fingerprint_digest: "0x" + "f".repeat(64),
  }], expected), false);
  assertEquals(hasCompleteW3MAcceptancePair([buyer, {
    ...seller,
    terms_version: "2",
  }], expected), false);
  assertEquals(hasCompleteW3MAcceptancePair([buyer, {
    ...seller,
    user_id: buyer.user_id,
  }], expected), false);
  assertEquals(hasCompleteW3MAcceptancePair([buyer, {
    ...seller,
    nonce: buyer.nonce,
  }], expected), false);
});


Deno.test("rejects invalid acceptance clock, excessive signature lifetime, and acceptance after deadline", async () => {
  for (const now of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assertRejects(async () => buildW3MAcceptanceRecord(base, now));
  }
  await assertRejects(async () => buildW3MAcceptanceRecord({
    ...base,
    deadline: NOW + 901,
  }, NOW));
  await assertRejects(async () => buildW3MAcceptanceRecord({
    ...base,
    acceptedAt: new Date((NOW + 121) * 1000).toISOString(),
  }, NOW));
  await assertRejects(async () => buildW3MAcceptanceRecord({
    ...base,
    termsVersion: (1n << 256n).toString(),
  }, NOW));
});


Deno.test("rejects non-string or malformed fingerprint digests without runtime type errors", async () => {
  await assertRejects(async () => buildW3MAcceptanceRecord({
    ...base,
    fingerprintDigest: null as unknown as string,
  }, NOW));
  await assertRejects(async () => buildW3MAcceptanceRecord({
    ...base,
    fingerprintDigest: "not-a-digest",
  }, NOW));
});

Deno.test("rejects malformed persisted ledger rows during advisory preflight", async () => {
  const buyer = buildW3MAcceptanceRecord(base, NOW);
  await assertRejects(async () => evaluateW3MAcceptanceLedger(buyer, [{
    deal_id: "not-a-uuid",
    party_role: "buyer",
    nonce: buyer.nonce,
    terms_hash: buyer.terms_hash,
    terms_version: buyer.terms_version,
  } as never]));
  await assertRejects(async () => evaluateW3MAcceptanceLedger(buyer, [{
    deal_id: base.dealId,
    party_role: "buyer",
    nonce: "malformed",
    terms_hash: buyer.terms_hash,
    terms_version: buyer.terms_version,
  } as never]));
  await assertRejects(async () => evaluateW3MAcceptanceLedger(buyer, [{
    deal_id: base.dealId,
    party_role: "buyer",
    nonce: buyer.nonce,
    terms_hash: buyer.terms_hash,
    terms_version: "0",
  } as never]));
});


Deno.test("strict finalization rejects malformed persisted acceptance evidence", () => {
  const buyer = buildW3MAcceptanceRecord(base, NOW);
  const seller = buildW3MAcceptanceRecord({
    ...base,
    partyRole: "seller",
    authenticatedUserId: base.sellerUserId,
    verifiedWalletAddress: "0x" + "22".repeat(20),
    recoveredSignerAddress: "0x" + "22".repeat(20),
    nonce: "0x" + "e".repeat(64),
  }, NOW);
  const expected = {
    dealId: base.dealId,
    projectId: base.projectId,
    auditId: base.auditId,
    fingerprintId: base.fingerprintId,
    fingerprintDigest: base.fingerprintDigest,
    bindingHash: base.bindingHash,
    termsHash: base.termsHash,
    termsVersion: base.termsVersion,
  };
  const corruptions = [
    { ...seller, signature: "0x1234" },
    { ...seller, wallet_address: "not-a-wallet" },
    { ...seller, signature_deadline: Number.NaN },
    { ...seller, accepted_at: "not-a-date" },
    { ...seller, accepted_at: 0 },
    { ...seller, signature_deadline: Math.floor(Date.parse(seller.accepted_at) / 1000) + 901 },
    { ...seller, fingerprint_digest: "bad" },
    { ...seller, user_id: "not-a-uuid" },
    { ...seller, terms_version: ((1n << 256n).toString()) },
  ];
  for (const corrupted of corruptions) {
    let rejected = false;
    try {
      hasCompleteW3MAcceptancePair([buyer, corrupted as never], expected);
    } catch {
      rejected = true;
    }
    assertEquals(rejected, true);
  }
});
