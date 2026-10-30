import { assertEquals } from "jsr:@std/assert@1";
import { evaluateTrustBadge, type AuditEvidence, type TrustedPremiumApproval } from "./eligibility.ts";

const SHA = "a".repeat(40);
const baseAudit = (): AuditEvidence => ({
  audit_id: "audit-123",
  status: "completed",
  overall_score: 85,
  files_scanned: 1000,
  eligible_files: 1000,
  persisted_file_count: 1000,
  oversized_files: 0,
  unreadable_files: 0,
  critical_count: 0,
  high_count: 0,
  commit_sha: SHA,
  current_commit_sha: SHA,
});
const approval = (): TrustedPremiumApproval => ({
  approved: true,
  audit_id: "audit-123",
  commit_sha: SHA,
  actor_id: "admin-user-id",
  event_id: "approval-event-id",
  source: "server",
});

Deno.test("80 to below 90 earns automatic Code Audit Verified", () => {
  const audit = baseAudit();
  audit.overall_score = 80;
  assertEquals(evaluateTrustBadge(audit), { eligible: true, badge: "code_audit_verified", reason: "automatic_threshold" });
  audit.overall_score = 89.99;
  assertEquals(evaluateTrustBadge(audit).badge, "code_audit_verified");
});

Deno.test("90 to 100 requires a matching server approval event", () => {
  const audit = baseAudit();
  audit.overall_score = 90;
  assertEquals(evaluateTrustBadge(audit).reason, "premium_approval_required");
  assertEquals(evaluateTrustBadge(audit, approval()).badge, "premium_verified");
  audit.overall_score = 100;
  assertEquals(evaluateTrustBadge(audit, approval()).badge, "premium_verified");
});

Deno.test("rounded 100 percent cannot hide one missing file", () => {
  const audit = baseAudit();
  audit.files_scanned = 999;
  audit.persisted_file_count = 999;
  assertEquals(evaluateTrustBadge(audit).reason, "incomplete_file_coverage");
});

Deno.test("one oversized or unreadable file blocks the badge", () => {
  const audit = baseAudit();
  audit.oversized_files = 1;
  assertEquals(evaluateTrustBadge(audit).reason, "skipped_or_unreadable_files");
  audit.oversized_files = 0;
  audit.unreadable_files = 1;
  assertEquals(evaluateTrustBadge(audit).reason, "skipped_or_unreadable_files");
});

Deno.test("Critical or High findings block the badge", () => {
  const audit = baseAudit();
  audit.critical_count = 1;
  assertEquals(evaluateTrustBadge(audit).reason, "critical_or_high_findings");
  audit.critical_count = 0;
  audit.high_count = 1;
  assertEquals(evaluateTrustBadge(audit).reason, "critical_or_high_findings");
});

Deno.test("changed commit makes the audit stale", () => {
  const audit = baseAudit();
  audit.current_commit_sha = "b".repeat(40);
  assertEquals(evaluateTrustBadge(audit).reason, "stale_or_invalid_commit");
});

Deno.test("a truthy string or incomplete approval cannot grant Premium", () => {
  const audit = baseAudit();
  audit.overall_score = 95;
  const forged = { ...approval(), approved: "yes" as unknown as boolean };
  assertEquals(evaluateTrustBadge(audit, forged).reason, "premium_approval_required");
  const missingActor = { ...approval(), actor_id: "" };
  assertEquals(evaluateTrustBadge(audit, missingActor).reason, "premium_approval_required");
});

Deno.test("approval for another audit or commit cannot grant Premium", () => {
  const audit = baseAudit();
  audit.overall_score = 95;
  assertEquals(evaluateTrustBadge(audit, { ...approval(), audit_id: "other-audit" }).reason, "premium_approval_required");
  assertEquals(evaluateTrustBadge(audit, { ...approval(), commit_sha: "b".repeat(40) }).reason, "premium_approval_required");
});

Deno.test("failed or unfinished audits never earn a badge", () => {
  const audit = baseAudit();
  audit.status = "failed";
  assertEquals(evaluateTrustBadge(audit).reason, "audit_not_completed");
});

Deno.test("score below 80 or outside the valid range is rejected", () => {
  const audit = baseAudit();
  audit.overall_score = 79.99;
  assertEquals(evaluateTrustBadge(audit).reason, "score_below_threshold_or_invalid");
  audit.overall_score = 100.01;
  assertEquals(evaluateTrustBadge(audit).reason, "score_below_threshold_or_invalid");
});
