import { assertEquals } from "jsr:@std/assert@1";
import { evaluateAcquisition, type AcquisitionEvidence, type EvidenceType } from "./decision-engine.ts";
import { buildSignedRegistryBatch } from "./report-registry-batch.ts";
import { verifyPersistedW3MReport } from "./persisted-report-guard.ts";

const DEAL = "deal-guard-1";
const PROJECT = "project-guard-1";
const BUYER = "buyer-guard-1";
const SELLER = "seller-guard-1";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const CONTENT_HASH = "a".repeat(64);
const TERMS_HASH = "b".repeat(64);
const NOW = "2026-11-05T21:00:00.000Z";
const EXPIRES = "2026-11-05T21:10:00.000Z";
const REPORT_ID = "10000000-0000-4000-8000-000000000001";

function evidence(): AcquisitionEvidence[] {
  const metadata: Record<string, Record<string, unknown>> = {
    PROJECT_IDENTITY: { projectApproved: true, identityMatched: true },
    CODE_AUDIT: { auditStatus: "completed", commitSha: COMMIT },
    OWNERSHIP_CONTROL: { sellerControlVerified: true },
    ASSET_TRANSFER: { transferConfirmed: true },
    DEAL_AGREEMENT: { buyerAcceptedTerms: true, sellerAcceptedTerms: true },
    PAYMENT: { paymentConfirmed: true },
    BUYER_ACCEPTANCE: { deliveryAccepted: true },
    DISPUTE_CHECK: { openDispute: false },
  };
  const types: EvidenceType[] = [
    "PROJECT_IDENTITY", "CODE_AUDIT", "OWNERSHIP_CONTROL", "ASSET_TRANSFER",
    "DEAL_AGREEMENT", "PAYMENT", "BUYER_ACCEPTANCE", "DISPUTE_CHECK",
  ];
  return types.map((type, index) => ({
    id: "source-evidence-" + index,
    type,
    result: "PASS",
    mandatory: true,
    dealId: DEAL,
    projectId: PROJECT,
    contentHash: CONTENT_HASH,
    observedAt: "2026-11-05T20:55:00.000Z",
    validUntil: EXPIRES,
    sourceRecordId: "source-record-" + index,
    sourceVersion: type === "CODE_AUDIT" ? COMMIT : "v1",
    metadata: metadata[type],
  }));
}

function ids(prefix: string, count: number): string[] {
  const namespace = prefix === "e" ? "20000000" : "30000000";
  return Array.from({ length: count }, (_, index) =>
    `${namespace}-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
  );
}

async function validRows() {
  const acquisitionEvidence = evidence();
  const decision = await evaluateAcquisition({
    dealId: DEAL, projectId: PROJECT, expectedCommitSha: COMMIT,
    evidence: acquisitionEvidence, now: NOW,
  });
  const batch = await buildSignedRegistryBatch({
    reportId: REPORT_ID,
    evidenceRowIds: ids("e", 8),
    eventRowIds: ids("v", 9),
    decision,
    evidence: acquisitionEvidence,
    reportVersion: 1,
    buyerId: BUYER,
    sellerId: SELLER,
    issuedAt: NOW,
    expiresAt: EXPIRES,
    dealTermsHash: TERMS_HASH,
    auditId: "audit-guard-1",
    expectedCommitSha: COMMIT,
    actorType: "VERIFIER",
    actorRef: "w3m-verifier-v1",
  }, async (digestHex) => ({
    signerKeyId: "guard-key-1",
    signature: "0x" + digestHex.slice(0, 64) + "b".repeat(66),
  }));

  const signerRows = [{
    key_id: "guard-key-1",
    algorithm: "ECDSA_SECP256K1_KECCAK256_RAW_DIGEST",
    public_address: "0x1111111111111111111111111111111111111111",
    status: "ACTIVE",
    valid_from: "2026-11-05T20:00:00.000Z",
    valid_until: null,
    revoked_at: null,
  }];
  return {
    reportRow: {
      ...batch.report,
      engine_version: batch.report.engine_version,
      issued_at: batch.report.issued_at,
      expires_at: batch.report.expires_at,
    },
    evidenceRows: batch.evidence,
    signerRows,
  };
}

Deno.test("persisted report guard rebuilds evidence and verifies canonical signature", async () => {
  const rows = await validRows();
  const result = await verifyPersistedW3MReport({
    expectedDealId: DEAL,
    expectedProjectId: PROJECT,
    expectedBuyerId: BUYER,
    expectedSellerId: SELLER,
    currentDealTermsHash: TERMS_HASH,
    latestReportVersion: 1,
    now: NOW,
    reportRow: rows.reportRow,
    evidenceRows: rows.evidenceRows,
    trustedSignerRegistryRows: rows.signerRows,
  }, async () => true);
  assertEquals(result.authorized, true);
  assertEquals(result.signatureValid, true);
  assertEquals(result.signerState, "ACTIVE");
  assertEquals(result.recomputedEvidenceHash, rows.reportRow.evidence_hash);
  assertEquals(result.issues, []);
});

Deno.test("persisted report guard rejects altered evidence details", async () => {
  const rows = await validRows();
  const altered = rows.evidenceRows.map((row, index) => index === 5
    ? { ...row, details: { ...row.details, paymentConfirmed: false } }
    : row);
  const result = await verifyPersistedW3MReport({
    expectedDealId: DEAL,
    expectedProjectId: PROJECT,
    expectedBuyerId: BUYER,
    expectedSellerId: SELLER,
    currentDealTermsHash: TERMS_HASH,
    latestReportVersion: 1,
    now: NOW,
    reportRow: rows.reportRow,
    evidenceRows: altered,
    trustedSignerRegistryRows: rows.signerRows,
  }, async () => true);
  assertEquals(result.authorized, false);
  if (!result.issues.includes("EVIDENCE_MANIFEST_RECOMPUTE_FAILED")) {
    throw new Error("Altered evidence metadata must invalidate the signed manifest.");
  }
});

Deno.test("persisted report guard rejects a changed terms hash and non-latest report", async () => {
  const rows = await validRows();
  const result = await verifyPersistedW3MReport({
    expectedDealId: DEAL,
    expectedProjectId: PROJECT,
    expectedBuyerId: BUYER,
    expectedSellerId: SELLER,
    currentDealTermsHash: "c".repeat(64),
    latestReportVersion: 2,
    now: NOW,
    reportRow: rows.reportRow,
    evidenceRows: rows.evidenceRows,
    trustedSignerRegistryRows: rows.signerRows,
  }, async () => true);
  assertEquals(result.authorized, false);
  assertEquals(result.issues.includes("DEAL_TERMS_HASH_MISMATCH"), true);
  assertEquals(result.issues.includes("REPORT_NOT_LATEST"), true);
});

Deno.test("persisted report guard rejects a revoked signer", async () => {
  const rows = await validRows();
  const revokedRows = rows.signerRows.map((row) => ({
    ...row, status: "REVOKED", revoked_at: "2026-11-05T20:59:00.000Z",
  }));
  const result = await verifyPersistedW3MReport({
    expectedDealId: DEAL,
    expectedProjectId: PROJECT,
    expectedBuyerId: BUYER,
    expectedSellerId: SELLER,
    currentDealTermsHash: TERMS_HASH,
    latestReportVersion: 1,
    now: NOW,
    reportRow: rows.reportRow,
    evidenceRows: rows.evidenceRows,
    trustedSignerRegistryRows: revokedRows,
  }, async () => true);
  assertEquals(result.authorized, false);
  assertEquals(result.signerState, "REVOKED");
  assertEquals(result.signatureValid, false);
});
