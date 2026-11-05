import { secp256k1 } from "jsr:@noble/curves@1.8.2/secp256k1";
import { keccak_256 } from "jsr:@noble/hashes@1.7.1/sha3";
import { prepareAcquisitionProtocolBatch } from "./protocol-orchestrator.ts";
import type { ProtocolOrchestratorInput } from "./protocol-orchestrator.ts";
import type { AcquisitionEvidence, EvidenceType } from "./decision-engine.ts";
import type { AssetTransferEvent } from "./asset-transfer-orchestrator.ts";

const DEAL = "deal-orch-1";
const PROJECT = "project-orch-1";
const ASSET = "repo-orch-1";
const SELLER = "seller-orch-1";
const BUYER = "buyer-orch-1";
const AUDIT = "audit-orch-1";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const HASH = "a".repeat(64);
const NOW = "2026-11-05T20:00:00.000Z";
const EXPIRES = "2026-11-05T20:10:00.000Z";
const UUIDS = Array.from({ length: 18 }, (_, i) =>
  "00000000-0000-4000-8000-" + String(i + 1).padStart(12, "0")
);

const TEST_PRIVATE_KEY = new Uint8Array(32);
TEST_PRIVATE_KEY[31] = 1;
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
const TEST_ADDRESS = "0x" + bytesToHex(
  keccak_256(secp256k1.getPublicKey(TEST_PRIVATE_KEY, false).slice(1)).slice(12),
);
const TEST_SIGNER_REGISTRY_ROWS = [{
  key_id: "test-signer-v1",
  algorithm: "ECDSA_SECP256K1_KECCAK256_RAW_DIGEST",
  public_address: TEST_ADDRESS,
  status: "ACTIVE",
  valid_from: "2026-01-01T00:00:00.000Z",
  valid_until: "2027-01-01T00:00:00.000Z",
  revoked_at: null,
}];
const signer = async (digestHex: string) => {
  const digest = Uint8Array.from(digestHex.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
  const signature = secp256k1.sign(digest, TEST_PRIVATE_KEY, { prehash: false });
  return {
    signerKeyId: "test-signer-v1",
    signature: "0x" + bytesToHex(new Uint8Array([
      ...signature.toCompactRawBytes(),
      signature.recovery! + 27,
    ])),
  };
};

function evidence(): AcquisitionEvidence[] {
  const meta: Record<string, Record<string, unknown>> = {
    PROJECT_IDENTITY: { projectApproved: true, identityMatched: true },
    CODE_AUDIT: { auditStatus: "completed", commitSha: COMMIT },
    DEAL_AGREEMENT: { buyerAcceptedTerms: true, sellerAcceptedTerms: true },
    PAYMENT: { paymentConfirmed: true },
    BUYER_ACCEPTANCE: { deliveryAccepted: true },
    DISPUTE_CHECK: { openDispute: false },
  };
  const types: EvidenceType[] = [
    "PROJECT_IDENTITY", "CODE_AUDIT", "DEAL_AGREEMENT",
    "PAYMENT", "BUYER_ACCEPTANCE", "DISPUTE_CHECK",
  ];
  return types.map((type, i) => ({
    id: "base-orch-" + i,
    type,
    result: "PASS",
    mandatory: true,
    dealId: DEAL,
    projectId: PROJECT,
    contentHash: HASH,
    observedAt: "2026-11-05T19:00:00.000Z",
    validUntil: EXPIRES,
    sourceRecordId: type === "CODE_AUDIT" ? AUDIT : "source-orch-" + i,
    sourceVersion: type === "CODE_AUDIT" ? COMMIT : "v1",
    metadata: meta[type],
  }));
}

function event(phase: "SELLER" | "BUYER"): AssetTransferEvent {
  const buyer = phase === "BUYER";
  return {
    eventId: "event-" + phase,
    eventType: buyer ? "BUYER_CONTROL_VERIFIED" : "SELLER_CONTROL_VERIFIED",
    assetId: ASSET,
    dealId: DEAL,
    projectId: PROJECT,
    sourceProvider: "github",
    sourceRecordId: "repo-record",
    sourceVersion: "v1",
    sourceEventId: "source-event-" + phase,
    proofHash: HASH,
    observedAt: "2026-11-05T19:00:00.000Z",
    validUntil: EXPIRES,
    authoritative: true,
    currentOwnerIdentity: buyer ? BUYER : SELLER,
  };
}

function input(overrides: Partial<ProtocolOrchestratorInput> = {}): ProtocolOrchestratorInput {
  return {
    acquisition: {
      dealId: DEAL,
      projectId: PROJECT,
      expectedCommitSha: COMMIT,
      expectedAssetId: ASSET,
      sellerIdentity: SELLER,
      buyerIdentity: BUYER,
      baseEvidence: evidence(),
      sellerControlEvent: event("SELLER"),
      buyerControlEvent: event("BUYER"),
      requireRevenueVerification: false,
      now: NOW,
    },
    reportId: UUIDS[0],
    evidenceRowIds: UUIDS.slice(1, 9),
    eventRowIds: UUIDS.slice(9, 18),
    reportVersion: 1,
    dealTermsHash: "b".repeat(64),
    auditId: AUDIT,
    issuedAt: NOW,
    expiresAt: EXPIRES,
    actorType: "VERIFIER",
    actorRef: "protocol-orchestrator-test",
    trustedSignerRegistryRows: TEST_SIGNER_REGISTRY_ROWS,
    ...overrides,
  };
}

Deno.test("orchestrator composes evidence, decision, canonical envelope and signed batch", async () => {
  const result = await prepareAcquisitionProtocolBatch(input(), signer);
  if (result.aggregation.decision.status !== "PASS") {
    throw new Error(JSON.stringify(result.aggregation.decision.issues));
  }
  if (result.registryBatch.report.report_hash !== result.registryBatch.digestToSign) {
    throw new Error("Signed digest and persisted report hash must match.");
  }
  if (result.registryBatch.report.report_payload.auditId !== AUDIT) {
    throw new Error("Report must bind the exact audit ID.");
  }
  if (result.persistenceRequired !== true || result.settlementAuthorized !== false ||
      result.executionEnabled !== false) {
    throw new Error("Orchestrator must not persist or authorize settlement.");
  }
});

Deno.test("orchestrator rejects Code Audit ID mismatch", async () => {
  let rejected = false;
  try {
    await prepareAcquisitionProtocolBatch(input({ auditId: "another-audit" }), signer);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Mismatched audit ID must be rejected.");
});

Deno.test("orchestrator rejects a Code Audit commit mismatch", async () => {
  const base = input();
  const changed = base.acquisition.baseEvidence.map((item) =>
    item.type === "CODE_AUDIT" ? { ...item, sourceVersion: "f".repeat(40) } : item
  );
  let rejected = false;
  try {
    await prepareAcquisitionProtocolBatch({
      ...base,
      acquisition: { ...base.acquisition, baseEvidence: changed },
    }, signer);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Wrong audited commit must be rejected.");
});

Deno.test("orchestrator rejects duplicate Code Audit evidence", async () => {
  const base = input();
  const duplicate = { ...base.acquisition.baseEvidence.find((item) => item.type === "CODE_AUDIT")!, id: "second-audit" };
  let rejected = false;
  try {
    await prepareAcquisitionProtocolBatch({
      ...base,
      acquisition: { ...base.acquisition, baseEvidence: [...base.acquisition.baseEvidence, duplicate] },
      evidenceRowIds: [...base.evidenceRowIds, UUIDS[17]],
      eventRowIds: [...base.eventRowIds, "00000000-0000-4000-8000-000000000020"],
    }, signer);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Ambiguous multiple Code Audit records must be rejected.");
});

Deno.test("orchestrator preserves conditional revenue requirement", async () => {
  const base = input();
  const result = await prepareAcquisitionProtocolBatch({
    ...base,
    acquisition: { ...base.acquisition, requireRevenueVerification: true },
  }, signer);
  if (result.aggregation.decision.status !== "INCOMPLETE") {
    throw new Error("Missing mandatory revenue proof must prevent PASS.");
  }
  if (result.registryBatch.report.status === "PASS") {
    throw new Error("Registry must not contain PASS without required revenue proof.");
  }
});

Deno.test("orchestrator rejects provider event from a different project", async () => {
  const base = input();
  let rejected = false;
  try {
    await prepareAcquisitionProtocolBatch({
      ...base,
      acquisition: {
        ...base.acquisition,
        buyerControlEvent: { ...base.acquisition.buyerControlEvent!, projectId: "other-project" },
      },
    }, signer);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Cross-project provider evidence must be rejected.");
});


Deno.test("orchestrator rejects a signature-shaped but cryptographically invalid signature", async () => {
  let rejected = false;
  try {
    await prepareAcquisitionProtocolBatch(input(), async () => ({
      signerKeyId: "test-signer-v1",
      signature: "0x" + "1".repeat(130),
    }));
  } catch (error) {
    rejected = String(error).includes("Trusted report signature verification failed");
  }
  if (!rejected) throw new Error("Signature-shaped bytes must not create a trusted report batch.");
});

Deno.test("orchestrator rejects a valid signature from a revoked registry key", async () => {
  let rejected = false;
  try {
    await prepareAcquisitionProtocolBatch(input({
      trustedSignerRegistryRows: [{ ...TEST_SIGNER_REGISTRY_ROWS[0], status: "REVOKED", revoked_at: NOW }],
    }), signer);
  } catch (error) {
    rejected = String(error).includes("REVOKED_SIGNER_KEY");
  }
  if (!rejected) throw new Error("Revoked signer key must not create a trusted report batch.");
});


Deno.test("orchestrator rejects malformed authoritative signer registry rows", async () => {
  let rejected = false;
  try {
    await prepareAcquisitionProtocolBatch(input({
      trustedSignerRegistryRows: [{ key_id: "missing-crypto-fields" }],
    }), signer);
  } catch (error) {
    rejected = String(error).includes("Trusted signer registry is invalid");
  }
  if (!rejected) throw new Error("Malformed signer registry data must fail closed.");
});
