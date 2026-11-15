/**
 * Composes trusted-identity authorization with the dispute-intake state model.
 *
 * Sandbox/domain adapter only. Production must verify the Supabase JWT, load
 * the deal roster and active-admin authority from trusted server-side records,
 * then call equivalent logic inside one atomic backend transaction.
 */
import { authorizeDealAction, type TrustedDealRoster } from "./deal-authorization.ts";
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
