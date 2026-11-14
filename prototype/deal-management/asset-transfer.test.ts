import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import {
  allRequiredAssetsVerified, assessAssetEvidence, createDealAsset,
  recordAssetVerification, submitAssetEvidence,
} from "./asset-transfer.ts";

const ev = (kind: string) => ({ id: kind, kind, source: "reviewed evidence source",
  reference: "evidence-ref", submittedAt: 100 });

Deno.test("GitHub invitation/member access is not treated as ownership transfer", () => {
  const asset = submitAssetEvidence(createDealAsset("repo-1", "github_repository"), ev("member_invitation"));
  assertEquals(assessAssetEvidence(asset, asset.evidence), "needs_review");
  assertEquals(allRequiredAssetsVerified([asset]), false);
});

Deno.test("GitHub transfer or verified organization owner control can satisfy evidence type gate", () => {
  const asset = submitAssetEvidence(createDealAsset("repo-1", "github_repository"), ev("repository_transfer_completed"));
  const status = assessAssetEvidence(asset, asset.evidence);
  assertEquals(status, "verified");
  const verified = recordAssetVerification(asset, { status, summary: "Transfer evidence checked",
    source: "GitHub evidence", checkedAt: 200 });
  assertEquals(allRequiredAssetsVerified([verified]), true);
});

Deno.test("DNS change alone is not domain ownership transfer", () => {
  const asset = submitAssetEvidence(createDealAsset("domain-1", "domain"), ev("dns_records_changed"));
  assertEquals(assessAssetEvidence(asset, asset.evidence), "needs_review");
});

Deno.test("registrant or registrar account control evidence can pass domain evidence gate", () => {
  const asset = submitAssetEvidence(createDealAsset("domain-1", "domain"), ev("registrant_change_confirmed"));
  assertEquals(assessAssetEvidence(asset, asset.evidence), "verified");
});

Deno.test("verification must include evidence, source, summary and timestamp", () => {
  const asset = createDealAsset("other-1", "other");
  assertThrows(() => recordAssetVerification(asset, { status: "verified", summary: "ok", source: "test", checkedAt: 1 }));
});

Deno.test("GitHub invitation evidence cannot be manually promoted to verified", () => {
  const asset = submitAssetEvidence(createDealAsset("repo-2", "github_repository"), ev("member_invitation"));
  assertThrows(() => recordAssetVerification(asset, { status: "verified", summary: "claimed verified",
    source: "untrusted assertion", checkedAt: 200 }));
});

Deno.test("duplicate evidence IDs are rejected", () => {
  const asset = submitAssetEvidence(createDealAsset("repo-3", "github_repository"), ev("member_invitation"));
  assertThrows(() => submitAssetEvidence(asset, ev("member_invitation")));
});

Deno.test("required assets must all be verified; optional assets do not block", () => {
  const required = recordAssetVerification(
    submitAssetEvidence(createDealAsset("repo", "github_repository"), ev("repository_transfer_completed")),
    { status: "verified", summary: "verified", source: "GitHub", checkedAt: 200 });
  const optional = createDealAsset("bonus", "other", false);
  assertEquals(allRequiredAssetsVerified([required, optional]), true);
});
