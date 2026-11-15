/**
 * Atomic in-memory transaction MODEL for dispute requests and payout holds.
 *
 * This is deliberately not a database adapter. It demonstrates the required
 * all-or-nothing state transition and idempotency contract for tests. A real
 * backend must implement the same operations in one PostgreSQL transaction
 * with row locks, unique constraints and trusted session/roster loading.
 */
import { authorizeDealAction, type TrustedDealRoster } from "./deal-authorization.ts";
import {
  releaseDeclinedDisputeHold, reviewDisputeRequest, submitDisputeRequest,
  type DisputeRequest, type DisputeRequestEvidence,
} from "./dispute-intake.ts";

export type DisputeStoreEventType =
  | "request_submitted"
  | "request_approved"
  | "request_declined"
  | "declined_hold_released";

export type DisputeStoreEvent = Readonly<{
  id: string;
  requestId: string;
  dealId: string;
  sequence: number;
  type: DisputeStoreEventType;
  actorId: string;
  actorRole: "buyer" | "seller" | "admin";
  occurredAt: number;
}>;

type ActiveHold = Readonly<{ requestId: string; active: true }>;
type IdempotencyRecord = Readonly<{ fingerprint: string; requestId: string }>;

export class InMemoryDisputeTransactionModel {
  readonly #roster: TrustedDealRoster;
  readonly #requests = new Map<string, DisputeRequest>();
  readonly #holds = new Map<string, ActiveHold>();
  readonly #events: DisputeStoreEvent[] = [];
  readonly #idempotency = new Map<string, IdempotencyRecord>();

  constructor(roster: TrustedDealRoster) {
    // Validate the trusted roster at construction; production must reload it
    // from the database within each transaction instead of caching it.
    authorizeDealAction(roster.buyerId, roster, "submit_dispute_request");
    this.#roster = Object.freeze({
      ...roster,
      activeAdminIds: Object.freeze([...roster.activeAdminIds]),
    });
  }

  submit(
    authenticatedUserId: string,
    requestId: string,
    idempotencyKey: string,
    reason: string,
    submittedAt: number,
    evidence: DisputeRequestEvidence[],
  ): DisputeRequest {
    const role = authorizeDealAction(
      authenticatedUserId, this.#roster, "submit_dispute_request",
    );
    if (role !== "buyer" && role !== "seller") throw new Error("Participant identity required");
    if (!idempotencyKey.trim()) throw new Error("Idempotency key is required");

    const fingerprint = JSON.stringify({ dealId: this.#roster.dealId, role, reason, evidence });
    const prior = this.#idempotency.get(idempotencyKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new Error("Idempotency key was reused with different request content");
      const existing = this.#requests.get(prior.requestId);
      if (!existing) throw new Error("Idempotency record is inconsistent");
      return existing;
    }
    if (this.#requests.has(requestId)) throw new Error("Dispute request ID already exists");
    if (this.#holds.has(this.#roster.dealId)) throw new Error("An active payout hold already exists for this deal");

    // Build and validate every new record before mutating the model. The commit
    // section below is synchronous, modelling a single atomic transaction.
    const request = submitDisputeRequest(
      requestId, this.#roster.dealId, role, reason, submittedAt, evidence,
    );
    const event: DisputeStoreEvent = Object.freeze({
      id: requestId + ":1", requestId, dealId: this.#roster.dealId,
      sequence: 1, type: "request_submitted", actorId: authenticatedUserId,
      actorRole: role, occurredAt: submittedAt,
    });

    this.#requests.set(requestId, request);
    this.#holds.set(this.#roster.dealId, Object.freeze({ requestId, active: true }));
    this.#events.push(event);
    this.#idempotency.set(idempotencyKey, Object.freeze({ fingerprint, requestId }));
    return request;
  }

  review(
    authenticatedUserId: string,
    requestId: string,
    outcome: "approved" | "declined",
    reason: string,
    reviewedAt: number,
  ): DisputeRequest {
    authorizeDealAction(authenticatedUserId, this.#roster, "review_dispute_request");
    const current = this.#requests.get(requestId);
    if (!current) throw new Error("Dispute request not found");
    const next = reviewDisputeRequest(current, outcome, reason, authenticatedUserId, reviewedAt);
    const sequence = this.#events.filter(event => event.requestId === requestId).length + 1;
    const event: DisputeStoreEvent = Object.freeze({
      id: requestId + ":" + sequence, requestId, dealId: this.#roster.dealId,
      sequence, type: outcome === "approved" ? "request_approved" : "request_declined",
      actorId: authenticatedUserId, actorRole: "admin", occurredAt: reviewedAt,
    });
    // The active hold is intentionally retained for both outcomes.
    if (!this.#holds.has(this.#roster.dealId)) throw new Error("Payout hold is missing; review aborted");
    this.#requests.set(requestId, next);
    this.#events.push(event);
    return next;
  }

  releaseDeclinedHold(
    authenticatedUserId: string,
    requestId: string,
    reason: string,
    releasedAt: number,
  ): DisputeRequest {
    authorizeDealAction(authenticatedUserId, this.#roster, "release_declined_hold");
    const current = this.#requests.get(requestId);
    if (!current) throw new Error("Dispute request not found");
    const hold = this.#holds.get(this.#roster.dealId);
    if (!hold || hold.requestId !== requestId) throw new Error("Matching active payout hold is required");
    const next = releaseDeclinedDisputeHold(
      current, reason, authenticatedUserId, releasedAt, false,
    );
    const sequence = this.#events.filter(event => event.requestId === requestId).length + 1;
    const event: DisputeStoreEvent = Object.freeze({
      id: requestId + ":" + sequence, requestId, dealId: this.#roster.dealId,
      sequence, type: "declined_hold_released", actorId: authenticatedUserId,
      actorRole: "admin", occurredAt: releasedAt,
    });
    this.#requests.set(requestId, next);
    this.#holds.delete(this.#roster.dealId);
    this.#events.push(event);
    return next;
  }

  canIssuePayoutInstruction(): boolean {
    return !this.#holds.has(this.#roster.dealId);
  }

  getRequest(requestId: string): DisputeRequest | null {
    return this.#requests.get(requestId) ?? null;
  }

  getEvents(requestId: string): readonly DisputeStoreEvent[] {
    return Object.freeze(this.#events.filter(event => event.requestId === requestId));
  }

  hasActiveHold(): boolean {
    return this.#holds.has(this.#roster.dealId);
  }
}
