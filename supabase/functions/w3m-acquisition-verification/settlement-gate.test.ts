import {
  evaluateSettlementGate,
  type SettlementGateInput,
  type SettlementReportSnapshot,
} from "./settlement-gate.ts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const SIGNATURE = "0x" + "c".repeat(130);

function report(): SettlementReportSnapshot {
  return {
    id: "report-001",
    dealId: "deal-001",
    projectId: "project-001",
    status: "PASS",
    reportVersion: 3,
    issuedAt: "2026-11-05T17:00:00.000Z",
    expiresAt: "2026-11-05T19:00:00.000Z",
    evidenceHash: HASH_A,
    reportHash: HASH_B,
    signerKeyId: "w3m-test-key-v1",
    signature: SIGNATURE,
  };
}

function input(overrides: Partial<SettlementGateInput> = {}): SettlementGateInput {
  return {
    stage: "PREPARE",
    dealId: "deal-001",
    projectId: "project-001",
    now: "2026-11-05T18:00:00.000Z",
    report: report(),
    latestReportVersion: 3,
    isSuperseded: false,
    signatureValid: true,
    signerState: "ACTIVE",
    recomputedEvidenceHash: HASH_A,
    currentDealTermsHash: HASH_B,
    reportDealTermsHash: HASH_B,
    paymentConfirmed: true,
    deliveryAccepted: true,
    disputeOpen: false,
    safeConfigurationMatches: true,
    releaseAlreadyFinalized: false,
    ...overrides,
  };
}

Deno.test("complete signed current report authorizes PREPARE", () => {
  const result = evaluateSettlementGate(input());
  if (!result.authorized || result.issues.length !== 0) {
    throw new Error("Expected authorization, got " + JSON.stringify(result.issues));
  }
});

Deno.test("same rules are enforced at EXECUTE", () => {
  const result = evaluateSettlementGate(input({ stage: "EXECUTE" }));
  if (!result.authorized || result.stage !== "EXECUTE") {
    throw new Error("Expected EXECUTE authorization for valid evidence.");
  }
});

Deno.test("missing report is denied", () => {
  const result = evaluateSettlementGate(input({ report: null, latestReportVersion: null }));
  if (result.authorized || !result.issues.some((x) => x.code === "REPORT_MISSING")) {
    throw new Error("Missing report must be denied.");
  }
});

Deno.test("non-PASS report is denied", () => {
  const r = report(); r.status = "INCOMPLETE";
  const result = evaluateSettlementGate(input({ report: r }));
  if (result.authorized) throw new Error("INCOMPLETE report must be denied.");
});

Deno.test("report for another deal is denied", () => {
  const r = report(); r.dealId = "deal-other";
  const result = evaluateSettlementGate(input({ report: r }));
  if (result.authorized) throw new Error("Cross-deal report must be denied.");
});

Deno.test("expired report is denied", () => {
  const result = evaluateSettlementGate(input({ now: "2026-11-05T20:00:00.000Z" }));
  if (result.authorized) throw new Error("Expired report must be denied.");
});

Deno.test("superseded report is denied", () => {
  const result = evaluateSettlementGate(input({ isSuperseded: true }));
  if (result.authorized) throw new Error("Superseded report must be denied.");
});

Deno.test("older report version is denied", () => {
  const result = evaluateSettlementGate(input({ latestReportVersion: 4 }));
  if (result.authorized) throw new Error("Non-latest report must be denied.");
});

Deno.test("invalid signature or revoked signer is denied", () => {
  const invalid = evaluateSettlementGate(input({ signatureValid: false }));
  const revoked = evaluateSettlementGate(input({ signerState: "REVOKED" }));
  if (invalid.authorized || revoked.authorized) throw new Error("Invalid or revoked signer must be denied.");
});

Deno.test("changed evidence manifest is denied", () => {
  const result = evaluateSettlementGate(input({ recomputedEvidenceHash: HASH_B }));
  if (result.authorized) throw new Error("Evidence hash mismatch must be denied.");
});

Deno.test("changed deal terms are denied", () => {
  const result = evaluateSettlementGate(input({ currentDealTermsHash: HASH_A }));
  if (result.authorized) throw new Error("Changed deal terms must be denied.");
});

Deno.test("unconfirmed payment or delivery is denied", () => {
  const payment = evaluateSettlementGate(input({ paymentConfirmed: false }));
  const delivery = evaluateSettlementGate(input({ deliveryAccepted: false }));
  if (payment.authorized || delivery.authorized) throw new Error("Payment and delivery checks must fail closed.");
});

Deno.test("open dispute blocks settlement", () => {
  const result = evaluateSettlementGate(input({ disputeOpen: true }));
  if (result.authorized) throw new Error("Open dispute must block settlement.");
});

Deno.test("Safe mismatch or finalized release is denied", () => {
  const safe = evaluateSettlementGate(input({ safeConfigurationMatches: false }));
  const done = evaluateSettlementGate(input({ releaseAlreadyFinalized: true }));
  if (safe.authorized || done.authorized) throw new Error("Safe mismatch and duplicate release must be denied.");
});

Deno.test("malformed report hashes and missing signature are denied", () => {
  const r = report(); r.evidenceHash = "bad"; r.signature = null;
  const result = evaluateSettlementGate(input({ report: r }));
  if (result.authorized) throw new Error("Malformed signed report must be denied.");
});
