/**
 * Buyer per-asset and final acceptance rules for isolated sandbox only.
 * No notices, clocks, dispute creation, database writes or payout actions.
 */
import type { DealAsset } from "./asset-transfer.ts";

export type AssetReviewStatus = "pending" | "accepted" | "rejected";
export type BuyerReview = {
  inspectionStartedAt: number;
  inspectionEndsAt: number | null;
  assets: Record<string, { status: AssetReviewStatus; reviewedAt: number | null; note: string }>;
  finalAcceptedAt: number | null;
  rejection: null | { assetId: string; reason: string; rejectedAt: number };
};

export function startBuyerReview(
  assets: DealAsset[], inspectionWindowMs: number | null, now: number,
): BuyerReview {
  if (!Number.isFinite(now) || (inspectionWindowMs !== null &&
      (!Number.isFinite(inspectionWindowMs) || inspectionWindowMs < 0))) {
    throw new Error("A valid review start and optional inspection window are required");
  }
  if (assets.length === 0 || assets.some(a => !a.id.trim()) ||
      new Set(assets.map(a => a.id)).size !== assets.length) {
    throw new Error("A non-empty list of uniquely identified assets is required");
  }
  if (assets.some(a => a.required && a.transferState !== "verified")) {
    throw new Error("All required assets must be verified before buyer review");
  }
  const records: BuyerReview["assets"] = {};
  for (const asset of assets) {
    records[asset.id] = { status: asset.required ? "pending" : "accepted",
      reviewedAt: asset.required ? null : now, note: asset.required ? "" : "Not required by agreement" };
  }
  return {
    inspectionStartedAt: now,
    inspectionEndsAt: inspectionWindowMs === null ? null : now + inspectionWindowMs,
    assets: records, finalAcceptedAt: null, rejection: null,
  };
}

export function reviewAsset(
  review: BuyerReview, assetId: string, decision: "accept" | "reject",
  now: number, note = "",
): BuyerReview {
  const current = review.assets[assetId];
  if (!current || review.finalAcceptedAt !== null || review.rejection !== null ||
      current.status !== "pending" || !Number.isFinite(now)) {
    throw new Error("This asset is not available for buyer review");
  }
  if (decision === "reject" && !note.trim()) throw new Error("A rejection reason is required");
  const next = {
    ...review,
    assets: { ...review.assets, [assetId]: {
      status: decision === "accept" ? "accepted" as const : "rejected" as const,
      reviewedAt: now, note,
    } },
  };
  if (decision === "reject") {
    next.rejection = { assetId, reason: note, rejectedAt: now };
  }
  return next;
}

export function finalBuyerAcceptance(review: BuyerReview, now: number): BuyerReview {
  if (review.finalAcceptedAt !== null || review.rejection !== null || !Number.isFinite(now) ||
      Object.values(review.assets).some(asset => asset.status !== "accepted")) {
    throw new Error("Final acceptance requires every required asset to be accepted");
  }
  return { ...review, finalAcceptedAt: now };
}
