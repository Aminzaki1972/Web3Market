import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import { createDealAsset, recordAssetVerification, submitAssetEvidence } from "./asset-transfer.ts";
import { finalBuyerAcceptance, reviewAsset, startBuyerReview } from "./buyer-review.ts";

function verified(id: string) {
  const a = submitAssetEvidence(createDealAsset(id, "other"), {
    id: "e-" + id, kind: "independent_control_proof", source: "evidence source",
    reference: "ref-" + id, submittedAt: 100,
  });
  return recordAssetVerification(a, { status: "verified", summary: "Evidence checked",
    source: "reviewed source", checkedAt: 200 });
}

Deno.test("buyer accepts each asset then confirms final acceptance", () => {
  const review = startBuyerReview([verified("repo"), verified("domain")], null, 300);
  const one = reviewAsset(review, "repo", "accept", 400);
  assertThrows(() => finalBuyerAcceptance(one, 450));
  const two = reviewAsset(one, "domain", "accept", 500);
  const final = finalBuyerAcceptance(two, 550);
  assertEquals(final.finalAcceptedAt, 550);
});

Deno.test("buyer inspection offers 48 hours, 72 hours or 7 days and no default is imposed", () => {
  const noWindow = startBuyerReview([verified("repo")], null, 300);
  assertEquals(noWindow.inspectionEndsAt, null);
  for (const durationMs of [48 * 60 * 60 * 1000, 72 * 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000]) {
    const review = startBuyerReview([verified("repo")], durationMs, 300);
    assertEquals(review.inspectionEndsAt, 300 + durationMs);
  }
});

Deno.test("buyer rejection requires a reason and records rejection without silently opening dispute", () => {
  const review = startBuyerReview([verified("repo")], null, 300);
  assertThrows(() => reviewAsset(review, "repo", "reject", 400));
  const rejected = reviewAsset(review, "repo", "reject", 400, "Ownership evidence incomplete");
  assertEquals(rejected.rejection?.reason, "Ownership evidence incomplete");
  assertEquals(rejected.finalAcceptedAt, null);
  assertThrows(() => finalBuyerAcceptance(rejected, 500));
});

Deno.test("buyer cannot review unverified required assets", () => {
  const pending = createDealAsset("repo", "github_repository");
  assertThrows(() => startBuyerReview([pending], null, 300));
});

Deno.test("review rejects duplicate asset IDs and prevents repeat decisions", () => {
  const asset = verified("repo");
  assertThrows(() => startBuyerReview([asset, asset], null, 300));
  const review = startBuyerReview([asset], null, 300);
  const accepted = reviewAsset(review, "repo", "accept", 400);
  assertThrows(() => reviewAsset(accepted, "repo", "accept", 450));
});

Deno.test("inspection deadline passing never auto-accepts assets or authorizes final acceptance", () => {
  const startedAt = 1_000;
  const duration = 48 * 60 * 60 * 1000;
  const review = startBuyerReview([verified("repo")], duration, startedAt);
  const afterDeadline = review.inspectionEndsAt! + 1;
  // Time passing alone does not mutate the review or mark any asset accepted.
  assertEquals(review.assets.repo.status, "pending");
  assertEquals(review.finalAcceptedAt, null);
  assertThrows(() => finalBuyerAcceptance(review, afterDeadline));
  // The buyer may still make an explicit decision after the deadline in this model.
  const accepted = reviewAsset(review, "repo", "accept", afterDeadline);
  const final = finalBuyerAcceptance(accepted, afterDeadline + 1);
  assertEquals(final.finalAcceptedAt, afterDeadline + 1);
});
