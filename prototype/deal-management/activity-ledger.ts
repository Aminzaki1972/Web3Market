/**
 * Append-only Deal Room activity ledger MODEL for sandbox tests.
 *
 * This is an in-memory domain model, not a trusted audit service. It does not
 * authenticate actors, assign server time, persist records, hash/sign events,
 * or prove that referenced business/chain actions actually occurred.
 */
export type DealActivityRole = "buyer" | "seller" | "admin" | "system";

export type DealActivityEventType =
  | "offer_submitted"
  | "counter_offer_submitted"
  | "offer_accepted"
  | "offer_rejected"
  | "agreement_approved"
  | "deposit_detected"
  | "asset_transfer_submitted"
  | "ai_verification_completed"
  | "buyer_asset_accepted"
  | "buyer_asset_rejected"
  | "dispute_requested"
  | "dispute_reviewed"
  | "dispute_decision_recorded"
  | "safe_lock_confirmed"
  | "payout_requested"
  | "payout_execution_confirmed"
  | "message_posted"
  | "message_corrected"
  | "admin_review_recorded"
  | "deal_cancelled"
  | "deal_completed";

export type DealActivityParticipants = {
  dealId: string;
  buyerId: string;
  sellerId: string;
  adminIds: readonly string[];
  systemActorId: string;
};

export type DealActivityEvent = Readonly<{
  id: string;
  dealId: string;
  sequence: number;
  previousEventId: string | null;
  type: DealActivityEventType;
  actorId: string;
  actorRole: DealActivityRole;
  /** Caller-supplied in this model; production must assign trusted server time. */
  occurredAt: number;
  summary: string;
  /** Stable reference to a message, offer, agreement, evidence item or tx record. */
  referenceId?: string;
}>;

const eventTypes: readonly DealActivityEventType[] = [
  "offer_submitted", "counter_offer_submitted", "offer_accepted", "offer_rejected",
  "agreement_approved", "deposit_detected", "asset_transfer_submitted",
  "ai_verification_completed", "buyer_asset_accepted", "buyer_asset_rejected",
  "dispute_requested", "dispute_reviewed", "dispute_decision_recorded",
  "safe_lock_confirmed", "payout_requested", "payout_execution_confirmed",
  "message_posted", "message_corrected", "admin_review_recorded",
  "deal_cancelled", "deal_completed",
];

const adminOnly = new Set<DealActivityEventType>([
  "dispute_reviewed", "dispute_decision_recorded", "admin_review_recorded",
]);
const systemOnly = new Set<DealActivityEventType>([
  "deposit_detected", "ai_verification_completed", "safe_lock_confirmed",
  "payout_execution_confirmed", "deal_completed",
]);

function validRoster(p: DealActivityParticipants): boolean {
  return Boolean(p.dealId.trim() && p.buyerId.trim() && p.sellerId.trim() &&
    p.systemActorId.trim() && p.buyerId !== p.sellerId &&
    p.systemActorId !== p.buyerId && p.systemActorId !== p.sellerId &&
    !p.adminIds.some(id => !id.trim() || id === p.buyerId ||
      id === p.sellerId || id === p.systemActorId) &&
    new Set(p.adminIds).size === p.adminIds.length);
}

function actorMatches(
  actorId: string,
  role: DealActivityRole,
  p: DealActivityParticipants,
): boolean {
  if (role === "buyer") return actorId === p.buyerId;
  if (role === "seller") return actorId === p.sellerId;
  if (role === "admin") return p.adminIds.includes(actorId);
  return role === "system" && actorId === p.systemActorId;
}

/**
 * Returns a new frozen ledger with exactly one event appended.
 * No edit/delete/reorder operation is exposed.
 */
export function appendDealActivityEvent(
  ledger: readonly DealActivityEvent[],
  participants: DealActivityParticipants,
  event: Omit<DealActivityEvent, "sequence" | "previousEventId">,
): readonly DealActivityEvent[] {
  if (!validRoster(participants)) throw new Error("Deal activity participant roster is invalid");
  if (!eventTypes.includes(event.type) || event.dealId !== participants.dealId ||
      !event.id.trim() || !event.actorId.trim() ||
      !actorMatches(event.actorId, event.actorRole, participants)) {
    throw new Error("Activity event identity, type or deal is invalid");
  }
  if (adminOnly.has(event.type) && event.actorRole !== "admin") {
    throw new Error("This activity event requires an authorized admin actor");
  }
  if (systemOnly.has(event.type) && event.actorRole !== "system") {
    throw new Error("This activity event requires the trusted system actor");
  }
  if (ledger.some(item => item.dealId !== participants.dealId)) {
    throw new Error("An activity ledger cannot mix deal IDs");
  }
  if (ledger.some(item => item.id === event.id)) {
    throw new Error("Activity event ID already exists");
  }
  if (!Number.isFinite(event.occurredAt) ||
      (ledger.length > 0 && event.occurredAt < ledger[ledger.length - 1].occurredAt)) {
    throw new Error("Activity timestamp must be valid and chronological");
  }
  if (!event.summary.trim() || event.summary.length > 1000 ||
      (event.referenceId !== undefined && !event.referenceId.trim())) {
    throw new Error("Activity summary or reference is invalid");
  }

  const frozen = ledger.map(item => Object.freeze({ ...item }));
  const previous = frozen.length ? frozen[frozen.length - 1].id : null;
  const appended = Object.freeze({
    ...event,
    sequence: frozen.length + 1,
    previousEventId: previous,
  });
  return Object.freeze([...frozen, appended]);
}
