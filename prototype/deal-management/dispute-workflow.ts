/**
 * Composes trusted-identity authorization with the dispute-intake state model.
 *
 * Sandbox/domain adapter only. Production must verify the Supabase JWT, load
 * the deal roster and active-admin authority from trusted server-side records,
 * then call equivalent logic inside one atomic backend transaction.
 */
import { authorizeDealAction, type TrustedDealRoster } from "./deal-authorization.ts";
import { issueDisputeDecision, type DisputeAllocation, type DisputeCase } from "./disputes.ts";
import {
  reviewDisputeRequest, submitDisputeRequest,
  type DisputeRequest, type DisputeRequestEvidence,
} from "./dispute-intake.ts";

export function submitAuthorizedDisputeRequest(
  authenticatedUserId: string,
  roster: TrustedDealRoster,
  requestId: string,
  reason: string,
  submittedAt: number,
  evidence: DisputeRequestEvidence[],
): DisputeRequest {
  const role = authorizeDealAction(
    authenticatedUserId, roster, "submit_dispute_request",
  );
  if (role !== "buyer" && role !== "seller") {
    throw new Error("Only a buyer or seller may submit a dispute request");
  }
  return submitDisputeRequest(
    requestId, roster.dealId, role, reason, submittedAt, evidence,
  );
}

export function reviewDisputeRequestAsAdmin(
  authenticatedUserId: string,
  roster: TrustedDealRoster,
  request: DisputeRequest,
  outcome: "approved" | "declined",
  reason: string,
  reviewedAt: number,
): DisputeRequest {
  authorizeDealAction(
    authenticatedUserId, roster, "review_dispute_request",
  );
  if (request.dealId !== roster.dealId) {
    throw new Error("Dispute request does not belong to the authorized deal");
  }
  return reviewDisputeRequest(
    request, outcome, reason, authenticatedUserId, reviewedAt,
  );
}


/**
 * Issues the final financial decision only for the single authenticated active admin.
 * The dispute must match the same deal/request and its approved Safe lock must be confirmed.
 * Production must perform this transition atomically after loading all records server-side.
 */
export function issueAuthorizedDisputeDecision(
  authenticatedUserId: string,
  roster: TrustedDealRoster,
  request: DisputeRequest,
  dispute: DisputeCase,
  reason: string,
  allocation: DisputeAllocation,
  totalDeposited: bigint,
  originalGrossAgreedAmount: bigint,
  decidedAt: number,
): DisputeCase {
  authorizeDealAction(authenticatedUserId, roster, "record_dispute_decision");
  if (request.dealId !== roster.dealId || request.id !== dispute.id ||
      request.claimant !== dispute.claimant || request.status !== "lock_confirmed" ||
      request.review?.outcome !== "approved" || request.payoutHold !== true ||
      !request.lockProof) {
    throw new Error("A matching approved dispute with confirmed Safe lock and active payout hold is required");
  }
  const decided = issueDisputeDecision(
    dispute, reason, allocation, totalDeposited, originalGrossAgreedAmount, decidedAt,
  );
  return {
    ...decided,
    decision: {
      ...decided.decision!,
      authorization: {
        adminId: authenticatedUserId,
        dealId: roster.dealId,
        disputeRequestId: request.id,
      },
    },
  };
}
