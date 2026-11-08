import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1.0.14";
import {
  canonicalizeW3MAcquisitionTermsV1,
  hashW3MAcquisitionTermsV1,
  validateW3MAcquisitionTermsV1,
} from "./acquisition-terms.ts";

const fixture = () => ({
  schema: "w3m-acquisition-terms-v1",
  terms_version: 1,
  deal: {
    deal_id: "11111111-1111-4111-8111-111111111111",
    project_id: "22222222-2222-4222-8222-222222222222",
    buyer_id: "33333333-3333-4333-8333-333333333333",
    seller_id: "44444444-4444-4444-8444-444444444444",
  },
  project: { title: "Synthetic project", category: "SaaS" },
  audit: {
    audit_id: "55555555-5555-4555-8555-555555555555",
    repository: "example/project",
    commit_sha: "a".repeat(40),
    fingerprint_digest: "b".repeat(64),
  },
  consideration: { amount: "1000.00", currency: "USDT" },
  platform_fee: { percent: "7.50", amount: "75.00" },
  seller_net: { amount: "925.00", currency: "USDT" },
  payment: {
    method: "safe_multisig",
    chain_id: 56,
    asset: "USDT",
    token_contract: null,
    safe_address: null,
    status_at_signing: "configured_or_pending",
  },
  transfer_scope: {
    included_assets: [{ type: "repository", description: "Source code" }],
    excluded_assets: [],
    access_and_credentials: { transfer_method: "Owner handover; no secrets in this record" },
    third_party_dependencies: [],
    intellectual_property: { seller_declaration: "Seller-provided declaration" },
    data_and_privacy: { scope: "No personal data transfer included" },
  },
  delivery: { deadline: "2027-01-01T00:00:00Z", checklist: ["Transfer repository"] },
  inspection: { enabled: true, window: "5 days", acceptance_criteria: ["Repository access delivered"] },
  dispute: { procedure_version: "draft-1", text: "Synthetic procedure for tests only" },
  escrow: { funding_condition: "Buyer funds verified Safe", release_condition: "Both parties complete conditions", dispute_hold: true },
  governing_terms: { governing_law: "Synthetic governing-law policy for validator tests", venue_or_process: "Synthetic dispute venue for validator tests", language: "English" },
  risk_acknowledgements: ["Audit is limited to the scanned commit."],
  disclosures: [],
  created_at: "2026-11-07T00:00:00Z",
  expires_at: "2026-11-08T00:00:00Z",
});

function setInspection(target: ReturnType<typeof fixture>, value: Record<string, unknown>): void {
  (target as unknown as { inspection: Record<string, unknown> }).inspection = value;
}

Deno.test("accepts a complete synthetic V1 agreement", () => {
  validateW3MAcquisitionTermsV1(fixture());
});

Deno.test("canonical JSON is stable across object key insertion order", () => {
  const a = fixture();
  const b = fixture();
  b.project = { category: "SaaS", title: "Synthetic project" };
  assertEquals(canonicalizeW3MAcquisitionTermsV1(a), canonicalizeW3MAcquisitionTermsV1(b));
});

Deno.test("hash is a deterministic 32-byte SHA-256 hex digest", async () => {
  const first = await hashW3MAcquisitionTermsV1(fixture());
  const second = await hashW3MAcquisitionTermsV1(fixture());
  assertEquals(first, second);
  assertEquals(first.length, 64);
});

Deno.test("rejects missing audit evidence and incomplete commercial terms", () => {
  const missingAudit = fixture();
  missingAudit.audit.commit_sha = "short";
  assertThrows(() => validateW3MAcquisitionTermsV1(missingAudit));
  const missingDelivery = fixture();
  missingDelivery.delivery.checklist = [];
  assertThrows(() => validateW3MAcquisitionTermsV1(missingDelivery));
});

Deno.test("rejects floating-point monetary values and invalid network", () => {
  const floatAmount = fixture();
  (floatAmount.consideration as { amount: unknown }).amount = 1000.5;
  assertThrows(() => validateW3MAcquisitionTermsV1(floatAmount));
  const wrongChain = fixture();
  wrongChain.payment.chain_id = 1;
  assertThrows(() => validateW3MAcquisitionTermsV1(wrongChain));
});

Deno.test("rejects identical buyer and seller and invalid expiry", () => {
  const sameParty = fixture();
  sameParty.deal.seller_id = sameParty.deal.buyer_id;
  assertThrows(() => validateW3MAcquisitionTermsV1(sameParty));
  const invalidExpiry = fixture();
  invalidExpiry.expires_at = invalidExpiry.created_at;
  assertThrows(() => validateW3MAcquisitionTermsV1(invalidExpiry));
});

Deno.test("rejects the same buyer and seller UUID with different letter casing", () => {
  const samePartyDifferentCase = fixture();
  samePartyDifferentCase.deal.buyer_id = "abcdefab-cdef-4abc-8def-abcdefabcdef";
  samePartyDifferentCase.deal.seller_id = "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF";
  assertThrows(() => validateW3MAcquisitionTermsV1(samePartyDifferentCase));
});

Deno.test("rejects impossible UTC calendar dates and accepts leap days", () => {
  const impossibleMonthDay = fixture();
  impossibleMonthDay.delivery.deadline = "2026-02-30T00:00:00Z";
  assertThrows(() => validateW3MAcquisitionTermsV1(impossibleMonthDay));

  const nonLeapYear = fixture();
  nonLeapYear.delivery.deadline = "2027-02-29T00:00:00Z";
  assertThrows(() => validateW3MAcquisitionTermsV1(nonLeapYear));

  const leapYear = fixture();
  leapYear.delivery.deadline = "2028-02-29T00:00:00Z";
  validateW3MAcquisitionTermsV1(leapYear);
});

Deno.test("rejects sparse arrays, undefined, non-finite values, and cycles", () => {
  const sparse = fixture();
  sparse.transfer_scope.included_assets = new Array(2);
  assertThrows(() => validateW3MAcquisitionTermsV1(sparse));
  const undefinedValue = fixture();
  (undefinedValue.disclosures as unknown[]).push(undefined);
  assertThrows(() => validateW3MAcquisitionTermsV1(undefinedValue));
  const nonFinite = fixture();
  (nonFinite.disclosures as unknown[]).push({ metric: Number.NaN });
  assertThrows(() => validateW3MAcquisitionTermsV1(nonFinite));
  const circular = fixture() as Record<string, unknown>;
  circular.loop = circular;
  assertThrows(() => validateW3MAcquisitionTermsV1(circular));
});

Deno.test("rejects fee percentages above 100 without floating-point rounding", () => {
  const invalid = fixture();
  invalid.platform_fee.percent = "100.00000000000000000000000000000001";
  assertThrows(() => validateW3MAcquisitionTermsV1(invalid));
});

Deno.test("rejects a seller net currency mismatch", () => {
  const invalid = fixture();
  invalid.seller_net.currency = "BNB";
  assertThrows(() => validateW3MAcquisitionTermsV1(invalid));
});


Deno.test("requires fee plus seller net to equal consideration exactly", () => {
  const invalidFeeSplit = fixture();
  invalidFeeSplit.platform_fee.amount = "74.99";
  assertThrows(() => validateW3MAcquisitionTermsV1(invalidFeeSplit));

  const invalidNetSplit = fixture();
  invalidNetSplit.seller_net.amount = "925.01";
  assertThrows(() => validateW3MAcquisitionTermsV1(invalidNetSplit));

  const exactLongDecimals = fixture();
  exactLongDecimals.consideration.amount = "0.30000000000000000003";
  exactLongDecimals.platform_fee.amount = "0.02250000000000000000";
  exactLongDecimals.seller_net.amount = "0.27750000000000000003";
  validateW3MAcquisitionTermsV1(exactLongDecimals);
});

Deno.test("enforces the fixed 7.5% fee and exact fee amount", () => {
  const wrongRate = fixture();
  wrongRate.platform_fee.percent = "8";
  assertThrows(() => validateW3MAcquisitionTermsV1(wrongRate));

  const wrongAmount = fixture();
  wrongAmount.platform_fee.amount = "74.99";
  wrongAmount.seller_net.amount = "925.01";
  assertThrows(() => validateW3MAcquisitionTermsV1(wrongAmount));

  const validRoundedFee = fixture();
  validRoundedFee.consideration.amount = "10.01";
  validRoundedFee.platform_fee.amount = "0.75";
  validRoundedFee.seller_net.amount = "9.26";
  validateW3MAcquisitionTermsV1(validRoundedFee);
});

Deno.test("supports an explicitly disabled optional inspection period", () => {
  const noInspection = fixture();
  setInspection(noInspection, { enabled: false, window: null, acceptance_criteria: [] });
  validateW3MAcquisitionTermsV1(noInspection);

  const ambiguousInspection = fixture();
  setInspection(ambiguousInspection, { enabled: false, window: "5 days", acceptance_criteria: [] });
  assertThrows(() => validateW3MAcquisitionTermsV1(ambiguousInspection));

  const incompleteEnabledInspection = fixture();
  setInspection(incompleteEnabledInspection, { enabled: true, window: null, acceptance_criteria: [] });
  assertThrows(() => validateW3MAcquisitionTermsV1(incompleteEnabledInspection));
});


Deno.test("bounds decimal precision before exact arithmetic", () => {
  const excessiveFraction = fixture();
  excessiveFraction.consideration.amount = "1." + "1".repeat(37);
  assertThrows(() => validateW3MAcquisitionTermsV1(excessiveFraction));

  const excessiveInteger = fixture();
  excessiveInteger.consideration.amount = "1".repeat(79);
  assertThrows(() => validateW3MAcquisitionTermsV1(excessiveInteger));
});


Deno.test("rejects placeholder legal, dispute, escrow, and inspection policy text", () => {
  const governingPlaceholder = fixture();
  governingPlaceholder.governing_terms.governing_law = "Pending legal review";
  assertThrows(() => validateW3MAcquisitionTermsV1(governingPlaceholder));

  const venuePlaceholder = fixture();
  venuePlaceholder.governing_terms.venue_or_process = "TBD";
  assertThrows(() => validateW3MAcquisitionTermsV1(venuePlaceholder));

  const disputePlaceholder = fixture();
  disputePlaceholder.dispute.text = "To be determined";
  assertThrows(() => validateW3MAcquisitionTermsV1(disputePlaceholder));

  const escrowPlaceholder = fixture();
  escrowPlaceholder.escrow.release_condition = "Placeholder";
  assertThrows(() => validateW3MAcquisitionTermsV1(escrowPlaceholder));

  const inspectionPlaceholder = fixture();
  inspectionPlaceholder.inspection.window = "Pending";
  assertThrows(() => validateW3MAcquisitionTermsV1(inspectionPlaceholder));
});

Deno.test("rejects blank delivery, inspection, and risk acknowledgement items", () => {
  const blankDelivery = fixture();
  blankDelivery.delivery.checklist = [" "];
  assertThrows(() => validateW3MAcquisitionTermsV1(blankDelivery));

  const blankCriterion = fixture();
  blankCriterion.inspection.acceptance_criteria = [""];
  assertThrows(() => validateW3MAcquisitionTermsV1(blankCriterion));

  const blankRisk = fixture();
  blankRisk.risk_acknowledgements = [" "];
  assertThrows(() => validateW3MAcquisitionTermsV1(blankRisk));
});
