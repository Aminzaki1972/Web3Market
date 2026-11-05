import {
  evaluateAcquisition,
  type AcquisitionEvidence,
  type EvidenceType,
} from "./decision-engine.ts";

const DEAL = "deal-test-001";
const PROJECT = "project-test-001";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const HASH = "a".repeat(64);
const NOW = "2026-11-05T18:00:00.000Z";
const EXPIRY = "2026-11-06T18:00:00.000Z";

function evidence(type: EvidenceType, index: number): AcquisitionEvidence {
  const metadata: Record<string, unknown> = {
    PROJECT_IDENTITY: { projectApproved: true, identityMatched: true },
    CODE_AUDIT: { auditStatus: "completed", commitSha: COMMIT },
    OWNERSHIP_CONTROL: { sellerControlVerified: true },
    ASSET_TRANSFER: { transferConfirmed: true },
    DEAL_AGREEMENT: { buyerAcceptedTerms: true, sellerAcceptedTerms: true },
    PAYMENT: { paymentConfirmed: true },
    BUYER_ACCEPTANCE: { deliveryAccepted: true },
    DISPUTE_CHECK: { openDispute: false },
  }[type];

  return {
    id: "evidence-" + index,
    type,
    result: "PASS",
    mandatory: true,
    dealId: DEAL,
    projectId: PROJECT,
    contentHash: HASH,
    observedAt: "2026-11-05T17:00:00.000Z",
    validUntil: EXPIRY,
    sourceRecordId: "source-" + index,
    sourceVersion: type === "CODE_AUDIT" ? COMMIT : "v1",
    metadata,
  };
}

function completeEvidence(): AcquisitionEvidence[] {
  const types: EvidenceType[] = [
    "PROJECT_IDENTITY",
    "CODE_AUDIT",
    "OWNERSHIP_CONTROL",
    "ASSET_TRANSFER",
    "DEAL_AGREEMENT",
    "PAYMENT",
    "BUYER_ACCEPTANCE",
    "DISPUTE_CHECK",
  ];
  return types.map((type, index) => evidence(type, index + 1));
}

function context(items = completeEvidence()) {
  return {
    dealId: DEAL,
    projectId: PROJECT,
    expectedCommitSha: COMMIT,
    evidence: items,
    now: NOW,
  };
}

Deno.test("complete, current, correctly-bound evidence returns PASS", async () => {
  const result = await evaluateAcquisition(context());
  if (result.status !== "PASS") throw new Error(JSON.stringify(result.issues));
  if (result.passedMandatoryCount !== 8) throw new Error("Expected 8 passing mandatory evidence records.");
  if (!/^[0-9a-f]{64}$/.test(result.evidenceHash)) throw new Error("Expected SHA-256 evidence hash.");
});

Deno.test("missing evidence category returns INCOMPLETE", async () => {
  const items = completeEvidence().filter((item) => item.type !== "OWNERSHIP_CONTROL");
  const result = await evaluateAcquisition(context(items));
  if (result.status !== "INCOMPLETE") throw new Error("Expected INCOMPLETE, got " + result.status);
});

Deno.test("evidence from another deal is blocked", async () => {
  const items = completeEvidence();
  items[0].dealId = "another-deal";
  const result = await evaluateAcquisition(context(items));
  if (result.status !== "BLOCKED") throw new Error("Expected BLOCKED, got " + result.status);
});

Deno.test("audit commit mismatch is blocked", async () => {
  const items = completeEvidence();
  items.find((item) => item.type === "CODE_AUDIT")!.metadata = {
    auditStatus: "completed",
    commitSha: "f".repeat(40),
  };
  const result = await evaluateAcquisition(context(items));
  if (result.status !== "BLOCKED") throw new Error("Expected BLOCKED, got " + result.status);
});

Deno.test("stale evidence cannot pass", async () => {
  const items = completeEvidence();
  items[0].validUntil = "2026-11-05T17:59:59.000Z";
  const result = await evaluateAcquisition(context(items));
  if (result.status !== "INCOMPLETE") throw new Error("Expected INCOMPLETE, got " + result.status);
});

Deno.test("manual review evidence returns REVIEW_REQUIRED", async () => {
  const items = completeEvidence();
  items[0].result = "REVIEW_REQUIRED";
  const result = await evaluateAcquisition(context(items));
  if (result.status !== "REVIEW_REQUIRED") throw new Error("Expected REVIEW_REQUIRED, got " + result.status);
});

Deno.test("open dispute is blocked", async () => {
  const items = completeEvidence();
  items.find((item) => item.type === "DISPUTE_CHECK")!.metadata = { openDispute: true };
  const result = await evaluateAcquisition(context(items));
  if (result.status !== "BLOCKED") throw new Error("Expected BLOCKED, got " + result.status);
});

Deno.test("payment not confirmed is blocked", async () => {
  const items = completeEvidence();
  items.find((item) => item.type === "PAYMENT")!.metadata = { paymentConfirmed: false };
  const result = await evaluateAcquisition(context(items));
  if (result.status !== "BLOCKED") throw new Error("Expected BLOCKED, got " + result.status);
});

Deno.test("duplicate evidence IDs cannot pass", async () => {
  const items = completeEvidence();
  items[1].id = items[0].id;
  const result = await evaluateAcquisition(context(items));
  if (result.status === "PASS") throw new Error("Duplicate evidence IDs must never pass.");
});

Deno.test("missing or malformed commit cannot pass", async () => {
  const result = await evaluateAcquisition({
    ...context(),
    expectedCommitSha: "not-a-commit",
  });
  if (result.status !== "BLOCKED") throw new Error("Expected BLOCKED, got " + result.status);
});

Deno.test("audit source version must match the exact commit", async () => {
  const items = completeEvidence();
  const audit = items.find((item) => item.type === "CODE_AUDIT")!;
  audit.sourceVersion = "f".repeat(40);
  audit.metadata = { auditStatus: "completed", commitSha: COMMIT };
  const result = await evaluateAcquisition(context(items));
  if (result.status !== "BLOCKED") throw new Error("Expected BLOCKED, got " + result.status);
});

Deno.test("failed optional evidence does not override complete mandatory evidence", async () => {
  const items = completeEvidence();
  items.push({
    ...evidence("OWNERSHIP_CONTROL", 99),
    id: "optional-extra-evidence",
    mandatory: false,
    result: "FAILED",
  });
  const result = await evaluateAcquisition(context(items));
  if (result.status !== "PASS") throw new Error("Expected PASS, got " + result.status);
});


function revenueEvidence(overrides: Record<string, unknown> = {}): AcquisitionEvidence {
  return {
    id: "revenue-evidence-1",
    type: "REVENUE_VERIFICATION",
    result: "PASS",
    mandatory: true,
    dealId: DEAL,
    projectId: PROJECT,
    contentHash: HASH,
    observedAt: "2026-11-05T17:00:00.000Z",
    validUntil: EXPIRY,
    sourceRecordId: "56:0x1111111111111111111111111111111111111111",
    sourceVersion: "100-110@112",
    metadata: {
      revenueStatus: "PASS",
      revenueScopeConfirmed: true,
      actualRevenueRaw: "2500000",
      declaredRevenueRaw: "2500000",
      chainId: 56,
      tokenAddress: "0x1111111111111111111111111111111111111111",
      fromBlock: 100,
      toBlock: 110,
      minConfirmations: 5,
      receiptCount: 3,
    },
    ...overrides,
  };
}

Deno.test("conditional on-chain revenue evidence can be required by a deal", async () => {
  const items = [...completeEvidence(), revenueEvidence()];
  const required: EvidenceType[] = [
    "PROJECT_IDENTITY",
    "CODE_AUDIT",
    "OWNERSHIP_CONTROL",
    "ASSET_TRANSFER",
    "DEAL_AGREEMENT",
    "PAYMENT",
    "BUYER_ACCEPTANCE",
    "DISPUTE_CHECK",
    "REVENUE_VERIFICATION",
  ];
  const result = await evaluateAcquisition({
    ...context(items),
    requiredEvidenceTypes: required,
  });
  if (result.status !== "PASS") throw new Error(JSON.stringify(result.issues));
});

Deno.test("on-chain revenue amount mismatch blocks a deal that requires revenue evidence", async () => {
  const items = [...completeEvidence(), revenueEvidence({
    metadata: {
      revenueStatus: "PASS",
      revenueScopeConfirmed: true,
      actualRevenueRaw: "2499999",
      declaredRevenueRaw: "2500000",
      chainId: 56,
      tokenAddress: "0x1111111111111111111111111111111111111111",
      fromBlock: 100,
      toBlock: 110,
      minConfirmations: 5,
      receiptCount: 3,
    },
  })];
  const result = await evaluateAcquisition({
    ...context(items),
    requiredEvidenceTypes: [
      "PROJECT_IDENTITY", "CODE_AUDIT", "OWNERSHIP_CONTROL", "ASSET_TRANSFER",
      "DEAL_AGREEMENT", "PAYMENT", "BUYER_ACCEPTANCE", "DISPUTE_CHECK",
      "REVENUE_VERIFICATION",
    ],
  });
  if (result.status !== "BLOCKED") throw new Error("Revenue mismatch must block acquisition.");
});

Deno.test("unconfirmed revenue scope cannot pass when the deal requires revenue evidence", async () => {
  const items = [...completeEvidence(), revenueEvidence({
    metadata: {
      revenueStatus: "PASS",
      revenueScopeConfirmed: false,
      actualRevenueRaw: "2500000",
      declaredRevenueRaw: "2500000",
      chainId: 56,
      tokenAddress: "0x1111111111111111111111111111111111111111",
      fromBlock: 100,
      toBlock: 110,
      minConfirmations: 5,
      receiptCount: 3,
    },
  })];
  const result = await evaluateAcquisition({
    ...context(items),
    requiredEvidenceTypes: [
      "PROJECT_IDENTITY", "CODE_AUDIT", "OWNERSHIP_CONTROL", "ASSET_TRANSFER",
      "DEAL_AGREEMENT", "PAYMENT", "BUYER_ACCEPTANCE", "DISPUTE_CHECK",
      "REVENUE_VERIFICATION",
    ],
  });
  if (result.status !== "INCOMPLETE") throw new Error("Unconfirmed revenue scope must remain incomplete.");
});
