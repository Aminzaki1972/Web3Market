/**
 * Administrative dispute-request gate for the isolated sandbox.
 *
 * This is a pure state model. It does not authenticate an administrator,
 * persist an audit log, suspend a live payout service, or lock a Safe.
 * A trusted backend must enforce reviewer permissions and persist transitions
 * atomically before any financial instruction can be considered.
 */

export type DisputeRequestParty = "buyer" | "seller";
export type DisputeRequestStatus =
  | "pending_admin_review"
  | "approved_lock_pending"
  | "declined_hold"
  | "administrative_hold_released";

export type DisputeRequestEvidence = {
  id: string;
  description: string;
  submittedAt: number;
};

export type DisputeRequest = {
  id: string;
  dealId: string;
  claimant: DisputeRequestParty;
  reason: string;
  submittedAt: number;
  evidence: DisputeRequestEvidence[];
  status: DisputeRequestStatus;
  /** True until an explicit, separately recorded release after a decline. */
  payoutHold: true | false;
  review: null | {
    outcome: "approved" | "declined";
    reason: string;
    reviewerId: string;
    reviewedAt: number;
  };
  holdRelease: null | {
    reason: string;
    reviewerId: string;
    releasedAt: number;
  };
};

function validText(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function validateEvidence(evidence: DisputeRequestEvidence[], submittedAt: number): void {
  const ids = new Set<string>();
  for (const item of evidence) {
    if (!validText(item.id) || !validText(item.description) ||
        !Number.isFinite(item.submittedAt) || item.submittedAt > submittedAt ||
        ids.has(item.id)) {
      throw new Error("Initial dispute evidence is invalid or duplicated");
    }
    ids.add(item.id);
  }
}

/** Either buyer or seller may submit a request; submission immediately raises an administrative payout hold. */
export function submitDisputeRequest(
  id: string,
  dealId: string,
  claimant: DisputeRequestParty,
  reason: string,
  submittedAt: number,
  evidence: DisputeRequestEvidence[] = [],
): DisputeRequest {
  if (!validText(id) || !validText(dealId) || !["buyer", "seller"].includes(claimant) ||
      !validText(reason) || !Number.isFinite(submittedAt)) {
    throw new Error("Dispute request requires an ID, deal, eligible claimant, reason and valid timestamp");
  }
  validateEvidence(evidence, submittedAt);
  return {
    id, dealId, claimant, reason, submittedAt, evidence: [...evidence],
    status: "pending_admin_review", payoutHold: true, review: null, holdRelease: null,
  };
}

/**
 * Administrative review is a separate action. Approval starts the lock-pending
 * phase; it never claims that the Safe is already locked. Decline retains the
 * payout hold until a separate explicit release action.
 *
 * reviewerId is audit metadata only; it is NOT proof of admin authorization.
 */
export function reviewDisputeRequest(
  request: DisputeRequest,
  outcome: "approved" | "declined",
  reason: string,
  reviewerId: string,
  reviewedAt: number,
): DisputeRequest {
  if (request.status !== "pending_admin_review" || request.review !== null ||
      !validText(reason) || !validText(reviewerId) || !Number.isFinite(reviewedAt) ||
      reviewedAt < request.submittedAt) {
    throw new Error("Only a pending request may receive one reasoned administrative review");
  }
  return {
    ...request,
    status: outcome === "approved" ? "approved_lock_pending" : "declined_hold",
    payoutHold: true,
    review: { outcome, reason, reviewerId, reviewedAt },
  };
}

/**
 * A declined request's administrative hold may be released only by a separate
 * explicit action, with a reason, and only when the trusted caller confirms
 * that no other dispute/security/administrative hold remains.
 */
export function releaseDeclinedDisputeHold(
  request: DisputeRequest,
  reason: string,
  reviewerId: string,
  releasedAt: number,
  otherActiveHoldExists: boolean,
): DisputeRequest {
  if (request.status !== "declined_hold" || request.review?.outcome !== "declined" ||
      request.payoutHold !== true || !validText(reason) || !validText(reviewerId) ||
      !Number.isFinite(releasedAt) || releasedAt < request.review.reviewedAt ||
      otherActiveHoldExists !== false) {
    throw new Error("Administrative hold release requires a declined request, explicit reason and no other active hold");
  }
  return {
    ...request,
    status: "administrative_hold_released",
    payoutHold: false,
    holdRelease: { reason, reviewerId, releasedAt },
  };
}
