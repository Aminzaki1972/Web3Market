import { buildSignedRegistryBatch, type RegistryBatchInput } from "./report-registry-batch.ts";
import { evaluateAcquisition, type AcquisitionEvidence, type EvidenceType } from "./decision-engine.ts";

const DEAL = "deal-registry-1";
const PROJECT = "project-registry-1";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const HASH = "a".repeat(64);
const NOW = "2026-11-05T21:00:00.000Z";
const EXPIRES = "2026-11-05T21:10:00.000Z";
const REPORT_ID = "10000000-0000-4000-8000-000000000001";

function evidence(): AcquisitionEvidence[] {
  const metadata: Record<string, Record<string, unknown>> = {
    PROJECT_IDENTITY: { projectApproved: true, identityMatched: true },
    CODE_AUDIT: { auditStatus: "completed", commitSha: COMMIT },
    DEAL_AGREEMENT: { buyerAcceptedTerms: true, sellerAcceptedTerms: true },
    PAYMENT: { paymentConfirmed: true },
    BUYER_ACCEPTANCE: { deliveryAccepted: true },
    DISPUTE_CHECK: { openDispute: false },
    OWNERSHIP_CONTROL: { sellerControlVerified: true },
    ASSET_TRANSFER: { transferConfirmed: true },
  };
  const types: EvidenceType[] = [
    "PROJECT_IDENTITY", "CODE_AUDIT", "OWNERSHIP_CONTROL", "ASSET_TRANSFER",
    "DEAL_AGREEMENT", "PAYMENT", "BUYER_ACCEPTANCE", "DISPUTE_CHECK",
  ];
  return types.map((type, i) => ({
    id: "evidence-" + i,
    type,
    result: "PASS",
    mandatory: true,
    dealId: DEAL,
    projectId: PROJECT,
    contentHash: HASH,
    observedAt: "2026-11-05T20:55:00.000Z",
    validUntil: EXPIRES,
    sourceRecordId: "source-" + i,
    sourceVersion: type === "CODE_AUDIT" ? COMMIT : "v1",
    metadata: metadata[type],
  }));
}

async function decision() {
  return await evaluateAcquisition({
    dealId: DEAL,
    projectId: PROJECT,
    expectedCommitSha: COMMIT,
    evidence: evidence(),
    now: NOW,
  });
}

function ids(prefix: string, count: number): string[] {
  const namespace = prefix === "e" ? "20000000" : "30000000";
  return Array.from({ length: count }, (_, i) =>
    `${namespace}-0000-4000-8000-${String(i + 1).padStart(12, "0")}`
  );
}

async function input(): Promise<RegistryBatchInput> {
  return {
    reportId: REPORT_ID,
    evidenceRowIds: ids("e", 8),
    eventRowIds: ids("v", 9),
    decision: await decision(),
    evidence: evidence(),
    reportVersion: 1,
    buyerId: "buyer-1",
    sellerId: "seller-1",
    issuedAt: NOW,
    expiresAt: EXPIRES,
    dealTermsHash: "b".repeat(64),
    auditId: "audit-registry-1",
    expectedCommitSha: COMMIT,
    actorType: "VERIFIER",
    actorRef: "w3m-verifier-v1",
  };
}

const mockSigner = async (digestHex: string) => ({
  signerKeyId: "w3m-verifier-key-1",
  signature: "0x" + digestHex.slice(0, 64) + "b".repeat(66),
});

Deno.test("builds a signed report and append-only evidence/event rows", async () => {
  const result = await buildSignedRegistryBatch(await input(), mockSigner);
  if (result.report.status !== "PASS" || result.report.report_hash !== result.digestToSign ||
      result.report.report_signature.length !== 132 || result.evidence.length !== 8 ||
      result.events.length !== 9 || result.events[0].event_type !== "REPORT_CREATED" ||
      result.report.report_payload.protocol !== "W3M Protocol V1" ||
      result.report.report_payload.auditId !== "audit-registry-1" ||
      result.report.report_payload.dealTermsHash !== "b".repeat(64)) {
    throw new Error("Registry batch does not match the signed PASS report contract.");
  }
  if (result.evidence.some((row) => row.report_id !== REPORT_ID) ||
      result.events.some((row) => row.report_id !== REPORT_ID)) {
    throw new Error("All rows must bind to the same immutable report ID.");
  }
});

Deno.test("canonical report digest is stable when evidence input order changes", async () => {
  const base = await input();
  const first = await buildSignedRegistryBatch(base, mockSigner);
  const second = await buildSignedRegistryBatch({ ...base, evidence: [...base.evidence].reverse() }, mockSigner);
  if (first.digestToSign !== second.digestToSign) {
    throw new Error("Canonical report digest must not depend on evidence array order.");
  }
});

Deno.test("PASS report cannot be built without a valid 65-byte signature", async () => {
  let rejected = false;
  try {
    await buildSignedRegistryBatch(await input(), async () => ({
      signerKeyId: "key-1",
      signature: "0x1234",
    }));
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Unsigned PASS report must be rejected.");
});

Deno.test("report cannot include evidence bound to another deal", async () => {
  const base = await input();
  const altered = [...base.evidence];
  altered[0] = { ...altered[0], dealId: "another-deal" };
  let rejected = false;
  try { await buildSignedRegistryBatch({ ...base, evidence: altered }, mockSigner); }
  catch { rejected = true; }
  if (!rejected) throw new Error("Cross-deal evidence must be rejected.");
});

Deno.test("report expiry and decision time are enforced", async () => {
  const base = await input();
  let rejectedExpiry = false;
  let rejectedIssueTime = false;
  try { await buildSignedRegistryBatch({ ...base, expiresAt: NOW }, mockSigner); }
  catch { rejectedExpiry = true; }
  try { await buildSignedRegistryBatch({ ...base, issuedAt: "2026-11-05T20:59:00.000Z" }, mockSigner); }
  catch { rejectedIssueTime = true; }
  if (!rejectedExpiry || !rejectedIssueTime) throw new Error("Invalid report times must be rejected.");
});

Deno.test("duplicate or invalid registry row IDs are rejected", async () => {
  const base = await input();
  let rejected = false;
  try {
    await buildSignedRegistryBatch({ ...base, eventRowIds: [base.evidenceRowIds[0], ...base.eventRowIds.slice(1)] }, mockSigner);
  } catch { rejected = true; }
  if (!rejected) throw new Error("Registry row ID collisions must be rejected.");
});

Deno.test("registry builder rejects expiry before evidence verification time", async () => {
  const base = await input();
  const staleDecision = { ...base.decision, checkedAt: "2026-11-05T21:05:00.000Z" };
  let rejected = false;
  try {
    await buildSignedRegistryBatch({ ...base, decision: staleDecision }, mockSigner);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Registry report must not expire before its evidence check time.");
});

Deno.test("registry builder rejects identical buyer and seller identities", async () => {
  const base = await input();
  let rejected = false;
  try {
    await buildSignedRegistryBatch({ ...base, buyerId: "same-party", sellerId: "same-party" }, mockSigner);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Buyer and seller must be distinct.");
});
