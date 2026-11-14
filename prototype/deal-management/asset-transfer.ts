/**
 * Asset transfer evidence and buyer review rules for isolated sandbox only.
 * No GitHub/registrar APIs, AI calls, notifications, database writes or chain actions.
 */
export type AssetKind = "github_repository" | "domain" | "other";
export type TransferState = "pending" | "evidence_submitted" | "verified" | "needs_review" | "rejected";

export type AssetEvidence = {
  id: string;
  kind: string;
  source: string;
  reference: string;
  submittedAt: number;
};

export type AssetVerification = {
  status: "verified" | "needs_review" | "rejected";
  summary: string;
  source: string;
  checkedAt: number;
};

export type DealAsset = {
  id: string;
  kind: AssetKind;
  required: boolean;
  transferState: TransferState;
  evidence: AssetEvidence[];
  verification: AssetVerification | null;
};

export function createDealAsset(id: string, kind: AssetKind, required = true): DealAsset {
  if (!id.trim()) throw new Error("Asset ID is required");
  return { id, kind, required, transferState: "pending", evidence: [], verification: null };
}

export function submitAssetEvidence(
  asset: DealAsset, evidence: AssetEvidence,
): DealAsset {
  if (!evidence.id.trim() || !evidence.kind.trim() || !evidence.source.trim() ||
      !evidence.reference.trim() || !Number.isFinite(evidence.submittedAt)) {
    throw new Error("Complete evidence metadata is required");
  }
  if (asset.transferState === "verified" || asset.transferState === "rejected") {
    throw new Error("Evidence cannot be changed after a terminal verification result");
  }
  if (asset.evidence.some(item => item.id === evidence.id)) {
    throw new Error("Evidence IDs must be unique within an asset");
  }
  return {
    ...asset, transferState: "evidence_submitted",
    evidence: [...asset.evidence, evidence], verification: null,
  };
}

/** Checks whether evidence type is sufficient for the asset class; no external ownership claim is made. */
export function assessAssetEvidence(asset: DealAsset, evidence: AssetEvidence[]): AssetVerification["status"] {
  if (evidence.length === 0) return "needs_review";
  const kinds = evidence.map(item => item.kind.toLowerCase());
  if (asset.kind === "github_repository") {
    // Invitations/member access alone are not proof of repository/org ownership transfer.
    return kinds.some(k => ["repository_transfer_completed", "organization_owner_control_verified"].includes(k))
      ? "verified" : "needs_review";
  }
  if (asset.kind === "domain") {
    // DNS changes alone do not establish registrant or registrar-account control transfer.
    return kinds.some(k => ["registrant_change_confirmed", "registrar_account_control_transferred"].includes(k))
      ? "verified" : "needs_review";
  }
  return kinds.some(k => ["independent_control_proof", "platform_supported_transfer_receipt"].includes(k))
    ? "verified" : "needs_review";
}

export function recordAssetVerification(
  asset: DealAsset, verification: AssetVerification,
): DealAsset {
  if (!["verified", "needs_review", "rejected"].includes(verification.status) ||
      !verification.summary.trim() || !verification.source.trim() ||
      !Number.isFinite(verification.checkedAt)) {
    throw new Error("Verification result, summary, source and timestamp are required");
  }
  if (verification.status === "verified" &&
      assessAssetEvidence(asset, asset.evidence) !== "verified") {
    throw new Error("Evidence type is insufficient to verify this asset");
  }
  return { ...asset, transferState: verification.status, verification };
}

export function allRequiredAssetsVerified(assets: DealAsset[]): boolean {
  const required = assets.filter(asset => asset.required);
  return required.length > 0 && required.every(asset =>
    asset.transferState === "verified" && asset.verification?.status === "verified");
}
