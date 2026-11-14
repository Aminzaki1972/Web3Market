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
  | "lock_confirmed"
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
  lockProof: null | DisputeLockProof;
  holdRelease: null | {
    reason: string;
    reviewerId: string;
    releasedAt: number;
  };
};

export type DisputeLockProof = {
  chainId: number;
  safeAddress: string;
  expectedSafeAddress: string;
  txHash: string;
  receiptStatus: "success" | "failed";
  confirmations: number;
  requiredConfirmations: number;
  canonicalBlockHash: string;
  lockEventObserved: boolean;
  lockStateVerified: boolean;
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
      !validText(reason) || !Number.isFinite(submittedAt) || evidence.length === 0) {
    throw new Error("Dispute request requires an ID, deal, eligible claimant, reason, valid timestamp and at least one evidence item");
  }
  validateEvidence(evidence, submittedAt);
  return {
    id, dealId, claimant, reason, submittedAt, evidence: [...evidence],
    status: "pending_admin_review", payoutHold: true, review: null, lockProof: null, holdRelease: null,
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
      !["approved", "declined"].includes(outcome) || !validText(reason) || !validText(reviewerId) || !Number.isFinite(reviewedAt) ||
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


/**
 * Record a normalized proof from a trusted server-side Safe/chain verifier.
 * This function validates shape and consistency only; it cannot query BNB
 * Chain or establish that the caller's proof is genuine.
 */
export function confirmDisputeLock(
  request: DisputeRequest,
  proof: DisputeLockProof,
): DisputeRequest {
  const address = /^0x[0-9a-fA-F]{40}$/;
  const hash = /^0x[0-9a-fA-F]{64}$/;
  if (request.status !== "approved_lock_pending" || request.review?.outcome !== "approved" ||
      proof.chainId !== 56 || !address.test(proof.safeAddress) ||
      !address.test(proof.expectedSafeAddress) ||
      proof.safeAddress.toLowerCase() !== proof.expectedSafeAddress.toLowerCase() ||
      !hash.test(proof.txHash) || proof.receiptStatus !== "success" ||
      !Number.isInteger(proof.confirmations) || !Number.isInteger(proof.requiredConfirmations) ||
      proof.requiredConfirmations <= 0 || proof.confirmations < proof.requiredConfirmations ||
      !hash.test(proof.canonicalBlockHash) || proof.lockEventObserved !== true ||
      proof.lockStateVerified !== true) {
    throw new Error("Dispute lock requires matching Safe, successful canonical lock evidence and verified on-chain locked state");
  }
  return { ...request, status: "lock_confirmed", payoutHold: true, lockProof: { ...proof } };
}
