export type BadgeDecision =
  | { eligible: false; badge: null; reason: string }
  | { eligible: true; badge: "code_audit_verified"; reason: "automatic_threshold" }
  | { eligible: true; badge: "premium_verified"; reason: "admin_approved" }
  | { eligible: false; badge: null; reason: "premium_approval_required" };

export interface AuditEvidence {
  audit_id: string;
  status: string;
  overall_score: number;
  files_scanned: number;
  eligible_files: number;
  persisted_file_count: number;
  oversized_files: number;
  unreadable_files: number;
  critical_count: number;
  high_count: number;
  commit_sha: string;
  current_commit_sha: string;
}

export interface TrustedPremiumApproval {
  approved: boolean;
  audit_id: string;
  commit_sha: string;
  actor_id: string;
  event_id: string;
  source: "server";
}

/**
 * Pure policy evaluator only. It does not authenticate callers, fetch trusted
 * audit rows, verify GitHub's current commit, or persist approvals. A server
 * endpoint must do those things before passing its server-loaded evidence here.
 */
export function evaluateTrustBadge(
  audit: AuditEvidence,
  approval?: TrustedPremiumApproval | null,
): BadgeDecision {
  if (typeof audit.audit_id !== "string" || audit.audit_id.trim().length === 0) {
    return { eligible: false, badge: null, reason: "invalid_audit_id" };
  }
  if (audit.status !== "completed") return { eligible: false, badge: null, reason: "audit_not_completed" };
  if (!Number.isFinite(audit.overall_score) || audit.overall_score < 80 || audit.overall_score > 100) {
    return { eligible: false, badge: null, reason: "score_below_threshold_or_invalid" };
  }
  if (!Number.isInteger(audit.eligible_files) || audit.eligible_files <= 0 ||
      !Number.isInteger(audit.files_scanned) || audit.files_scanned !== audit.eligible_files ||
      !Number.isInteger(audit.persisted_file_count) || audit.persisted_file_count !== audit.files_scanned) {
    return { eligible: false, badge: null, reason: "incomplete_file_coverage" };
  }
  const counts = [audit.oversized_files, audit.unreadable_files, audit.critical_count, audit.high_count];
  if (counts.some((count) => !Number.isInteger(count) || count < 0)) {
    return { eligible: false, badge: null, reason: "invalid_evidence_counts" };
  }
  if (audit.oversized_files !== 0 || audit.unreadable_files !== 0) {
    return { eligible: false, badge: null, reason: "skipped_or_unreadable_files" };
  }
  if (audit.critical_count !== 0 || audit.high_count !== 0) {
    return { eligible: false, badge: null, reason: "critical_or_high_findings" };
  }
  if (!/^[0-9a-f]{40}$/i.test(audit.commit_sha) ||
      !/^[0-9a-f]{40}$/i.test(audit.current_commit_sha) ||
      audit.commit_sha.toLowerCase() !== audit.current_commit_sha.toLowerCase()) {
    return { eligible: false, badge: null, reason: "stale_or_invalid_commit" };
  }
  if (audit.overall_score < 90) {
    return { eligible: true, badge: "code_audit_verified", reason: "automatic_threshold" };
  }

  const trustedApproval = approval !== null && approval !== undefined &&
    typeof approval === "object" &&
    approval.approved === true &&
    approval.source === "server" &&
    typeof approval.audit_id === "string" && approval.audit_id === audit.audit_id &&
    typeof approval.commit_sha === "string" &&
    approval.commit_sha.toLowerCase() === audit.commit_sha.toLowerCase() &&
    typeof approval.actor_id === "string" && approval.actor_id.trim().length > 0 &&
    typeof approval.event_id === "string" && approval.event_id.trim().length > 0;

  if (!trustedApproval) return { eligible: false, badge: null, reason: "premium_approval_required" };
  return { eligible: true, badge: "premium_verified", reason: "admin_approved" };
}
