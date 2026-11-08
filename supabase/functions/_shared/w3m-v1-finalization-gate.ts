import {
  verifyW3MFinalizationAcceptancePair,
} from "../w3m-acquisition-verification/finalization-acceptance.ts";
import type {
  W3MAcceptanceRecord,
  W3MCompleteAcceptanceExpectation,
} from "../w3m-acquisition-verification/acceptance-ledger.ts";
import type {
  W3MDealAuditBinding,
  W3MDealAuditBindingInput,
} from "../w3m-acquisition-verification/deal-audit-binding.ts";

export type W3MFinalizationGateClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

export type W3MFinalizationEvidence = {
  dealId: string;
  projectId: string;
  buyerUserId: string;
  sellerUserId: string;
  dealStatus: string;
  disputeStatus: string;
  auditId: string;
  fingerprintId: string;
  fingerprintDigest: string;
  repository: string;
  commitSha: string;
  bindingHash: string;
  termsHash: string;
  termsVersion: string;
  acceptanceCount: number;
  assetCount: number;
};

export class W3MFinalizationGateError extends Error {
  readonly code: "W3M_FINALIZATION_EVIDENCE_UNAVAILABLE" | "W3M_ACCEPTANCE_PAIR_INVALID";
  constructor(
    code: W3MFinalizationGateError["code"],
    message: string,
  ) {
    super(message);
    this.name = "W3MFinalizationGateError";
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH32 = /^0x[0-9a-f]{64}$/i;

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new W3MFinalizationGateError("W3M_FINALIZATION_EVIDENCE_UNAVAILABLE", label + " is missing.");
  }
  return value;
}

function requiredUuid(value: unknown, label: string): string {
  const normalized = requiredString(value, label);
  if (!UUID.test(normalized)) {
    throw new W3MFinalizationGateError("W3M_FINALIZATION_EVIDENCE_UNAVAILABLE", label + " is invalid.");
  }
  return normalized.toLowerCase();
}

function requiredHash(value: unknown, label: string): string {
  const normalized = requiredString(value, label);
  if (!HASH32.test(normalized)) {
    throw new W3MFinalizationGateError("W3M_FINALIZATION_EVIDENCE_UNAVAILABLE", label + " is invalid.");
  }
  return normalized.toLowerCase();
}

function rawHash(value: string): string {
  return value.replace(/^0x/i, "").toLowerCase();
}

async function assertW3MFinalizationReadyInternal(
  admin: W3MFinalizationGateClient,
  dealId: string,
  requireAssets: boolean,
): Promise<W3MFinalizationEvidence> {
  if (!UUID.test(dealId)) {
    throw new W3MFinalizationGateError("W3M_FINALIZATION_EVIDENCE_UNAVAILABLE", "Deal ID is invalid.");
  }

  const { data, error } = await admin.rpc("w3m_get_deal_finalization_evidence", {
    p_deal_id: dealId,
  });
  if (error || !Array.isArray(data) || data.length !== 1) {
    throw new W3MFinalizationGateError(
      "W3M_FINALIZATION_EVIDENCE_UNAVAILABLE",
      "Current W3M finalization evidence could not be loaded.",
    );
  }

  const row = data[0] as Record<string, unknown>;
  const deal = requiredUuid(row.deal_id, "Evidence deal ID");
  const project = requiredUuid(row.project_id, "Evidence project ID");
  const buyer = requiredUuid(row.buyer_id, "Buyer user ID");
  const seller = requiredUuid(row.seller_id, "Seller user ID");
  const audit = requiredUuid(row.audit_id, "Audit ID");
  const fingerprint = requiredUuid(row.fingerprint_id, "Fingerprint ID");
  const digest = requiredHash(row.fingerprint_digest, "Fingerprint digest");
  const bindingHash = requiredHash(row.binding_hash, "Deal-audit binding hash");
  const termsHash = requiredHash(row.terms_hash, "Current terms hash");
  const repository = requiredString(row.repository, "Repository");
  const commitSha = requiredString(row.commit_sha, "Audited commit SHA");
  const termsVersion = requiredString(row.terms_version, "Current terms version");
  const dealStatus = requiredString(row.deal_status, "Deal status");
  const disputeStatus = requiredString(row.dispute_status, "Dispute status");

  if (deal !== dealId.toLowerCase() || buyer === seller ||
    !/^[1-9][0-9]*$/.test(termsVersion)) {
    throw new W3MFinalizationGateError(
      "W3M_FINALIZATION_EVIDENCE_UNAVAILABLE",
      "Finalization evidence does not describe this distinct-party deal.",
    );
  }

  const acceptanceRows = row.acceptance_rows;
  if (!Array.isArray(acceptanceRows)) {
    throw new W3MFinalizationGateError(
      "W3M_FINALIZATION_EVIDENCE_UNAVAILABLE",
      "Persisted acceptance evidence is malformed.",
    );
  }

  const binding: W3MDealAuditBinding = {
    schema: "w3m-deal-audit-binding-v1",
    deal_id: deal,
    project_id: project,
    audit_id: audit,
    fingerprint_id: fingerprint,
    fingerprint_digest: rawHash(digest),
    repository,
    commit_sha: commitSha,
    binding_hash: rawHash(bindingHash),
  };
  const expectedBinding: W3MDealAuditBindingInput = {
    dealId: deal,
    projectId: project,
    auditId: audit,
    fingerprintId: fingerprint,
    fingerprintDigest: rawHash(digest),
    repository,
    commitSha,
  };
  const expected: W3MCompleteAcceptanceExpectation = {
    dealId: deal,
    projectId: project,
    auditId: audit,
    fingerprintId: fingerprint,
    fingerprintDigest: digest,
    bindingHash,
    termsHash,
    termsVersion,
  };

  const valid = await verifyW3MFinalizationAcceptancePair(
    acceptanceRows as W3MAcceptanceRecord[],
    expected,
    { buyerUserId: buyer, sellerUserId: seller },
    binding,
    expectedBinding,
  );
  if (!valid) {
    throw new W3MFinalizationGateError(
      "W3M_ACCEPTANCE_PAIR_INVALID",
      "Both buyer and seller must have valid signatures for the exact current deal, audit binding, and terms version.",
    );
  }

  let assetCount = 0;
  if (requireAssets) {
    const assetEvidence = await admin.rpc("w3m_get_deal_asset_finalization_evidence", {
      p_deal_id: dealId,
    });
    if (assetEvidence.error || !Array.isArray(assetEvidence.data) || assetEvidence.data.length !== 1) {
      throw new W3MFinalizationGateError(
        "W3M_FINALIZATION_EVIDENCE_UNAVAILABLE",
        "Per-asset delivery evidence could not be loaded.",
      );
    }
    const assetRow = assetEvidence.data[0] as Record<string, unknown>;
    if (requiredUuid(assetRow.deal_id, "Asset evidence deal ID") !== deal ||
        requiredUuid(assetRow.buyer_id, "Asset evidence buyer ID") !== buyer ||
        !Array.isArray(assetRow.asset_rows) || assetRow.asset_rows.length === 0) {
      throw new W3MFinalizationGateError(
        "W3M_FINALIZATION_EVIDENCE_UNAVAILABLE",
        "The deal has no verifiable asset delivery records.",
      );
    }
  
    const seenAssetIds = new Set<string>();
    const seenAssetNames = new Set<string>();
    for (const rawAsset of assetRow.asset_rows) {
      if (!rawAsset || typeof rawAsset !== "object" || Array.isArray(rawAsset)) {
        throw new W3MFinalizationGateError(
          "W3M_FINALIZATION_EVIDENCE_UNAVAILABLE",
          "A per-asset delivery record is malformed.",
        );
      }
      const asset = rawAsset as Record<string, unknown>;
      const assetId = requiredUuid(asset.asset_id, "Asset ID");
      const assetName = requiredString(asset.asset_name, "Asset name").trim().toLowerCase();
      if (seenAssetIds.has(assetId) || seenAssetNames.has(assetName) || assetName.length === 0 ||
          asset.status !== "accepted" ||
          requiredUuid(asset.accepted_by, "Asset accepting buyer") !== buyer ||
          typeof asset.accepted_at !== "string" || !Number.isFinite(Date.parse(asset.accepted_at)) ||
          !Array.isArray(asset.events) || asset.events.length < 2) {
        throw new W3MFinalizationGateError(
          "W3M_FINALIZATION_EVIDENCE_UNAVAILABLE",
          "Every distinct deal asset must be accepted by the buyer after a recorded delivery.",
        );
      }
      seenAssetIds.add(assetId);
      seenAssetNames.add(assetName);
  
      const events = asset.events as unknown[];
      const last = events[events.length - 1] as Record<string, unknown>;
      const previous = events[events.length - 2] as Record<string, unknown>;
      if (!last || !previous || last.event_type !== "accepted" ||
          previous.event_type !== "delivered" ||
          requiredUuid(last.actor_user_id, "Asset acceptance actor") !== buyer ||
          typeof last.evidence_digest !== "string" || !/^[0-9a-f]{64}$/i.test(last.evidence_digest) ||
          typeof previous.evidence_digest !== "string" || !/^[0-9a-f]{64}$/i.test(previous.evidence_digest) ||
          last.evidence_digest.toLowerCase() !== previous.evidence_digest.toLowerCase() ||
          last.attempt_number !== previous.attempt_number ||
          typeof last.occurred_at !== "string" || typeof previous.occurred_at !== "string" ||
          Date.parse(last.occurred_at) < Date.parse(previous.occurred_at)) {
        throw new W3MFinalizationGateError(
          "W3M_FINALIZATION_EVIDENCE_UNAVAILABLE",
          "The latest event for each asset must be a buyer acceptance of its latest delivery attempt.",
        );
      }
    }
    assetCount = seenAssetIds.size;
  }

  return {
    dealId: deal,
    projectId: project,
    buyerUserId: buyer,
    sellerUserId: seller,
    dealStatus,
    disputeStatus,
    auditId: audit,
    fingerprintId: fingerprint,
    fingerprintDigest: digest,
    repository,
    commitSha,
    bindingHash,
    termsHash,
    termsVersion,
    acceptanceCount: acceptanceRows.length,
    assetCount,
  };
}

export async function assertW3MAgreementReady(
  admin: W3MFinalizationGateClient,
  dealId: string,
): Promise<Omit<W3MFinalizationEvidence, "assetCount">> {
  const evidence = await assertW3MFinalizationReadyInternal(admin, dealId, false);
  const { assetCount: _assetCount, ...agreement } = evidence;
  return agreement;
}

export async function assertW3MFinalizationReady(
  admin: W3MFinalizationGateClient,
  dealId: string,
): Promise<W3MFinalizationEvidence> {
  return assertW3MFinalizationReadyInternal(admin, dealId, true);
}
