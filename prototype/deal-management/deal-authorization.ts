/**
 * Fail-closed Deal Room authorization policy for the isolated sandbox.
 *
 * IMPORTANT: This module does not verify a JWT or fetch trusted rows. A real
 * Edge Function must derive authenticatedUserId from the verified Supabase
 * session and load deal/admin records from the database before calling it.
 * Never pass a role, buyerId, sellerId or admin roster supplied by the client.
 */
export type TrustedDealRoster = Readonly<{
  dealId: string;
  buyerId: string;
  sellerId: string;
  /** Active admin IDs loaded from the trusted database, not request JSON. */
  activeAdminIds: readonly string[];
}>;

export type DealActorRole = "buyer" | "seller" | "admin";
export type DealAction =
  | "read_deal"
  | "send_message"
  | "submit_dispute_request"
  | "submit_dispute_evidence"
  | "respond_to_dispute"
  | "read_admin_workspace"
  | "review_dispute_request"
  | "record_dispute_decision"
  | "release_declined_hold";

const adminOnly = new Set<DealAction>([
  "read_admin_workspace",
  "review_dispute_request",
  "record_dispute_decision",
  "release_declined_hold",
]);
const participantOnly = new Set<DealAction>([
  "send_message",
  "submit_dispute_request",
  "submit_dispute_evidence",
  "respond_to_dispute",
]);

function nonBlank(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateTrustedDealRoster(roster: TrustedDealRoster): void {
  if (!nonBlank(roster.dealId) || !nonBlank(roster.buyerId) ||
      !nonBlank(roster.sellerId) || roster.buyerId === roster.sellerId ||
      roster.activeAdminIds.length > 1 ||
      new Set(roster.activeAdminIds).size !== roster.activeAdminIds.length ||
      roster.activeAdminIds.some(id => !nonBlank(id) ||
        id === roster.buyerId || id === roster.sellerId)) {
    throw new Error("Trusted deal roster is invalid or violates the single-admin invariant");
  }
}

export function resolveDealActor(
  authenticatedUserId: string,
  roster: TrustedDealRoster,
): DealActorRole | null {
  validateTrustedDealRoster(roster);
  if (!nonBlank(authenticatedUserId)) throw new Error("Authenticated user identity is required");
  if (authenticatedUserId === roster.buyerId) return "buyer";
  if (authenticatedUserId === roster.sellerId) return "seller";
  if (roster.activeAdminIds.includes(authenticatedUserId)) return "admin";
  return null;
}

/**
 * Resolves the actor exclusively from authenticated identity + trusted rows,
 * then enforces the action matrix. No client-supplied role is accepted.
 */
export function authorizeDealAction(
  authenticatedUserId: string,
  roster: TrustedDealRoster,
  action: DealAction,
): DealActorRole {
  if (![
    "read_deal", "send_message", "submit_dispute_request",
    "submit_dispute_evidence", "respond_to_dispute",
    "read_admin_workspace", "review_dispute_request",
    "record_dispute_decision", "release_declined_hold",
  ].includes(action)) {
    throw new Error("Unknown Deal Room action");
  }
  const role = resolveDealActor(authenticatedUserId, roster);
  if (!role) throw new Error("User is not authorized for this deal");
  if (adminOnly.has(action) && role !== "admin") {
    throw new Error("This action is restricted to the single active administrator");
  }
  if (participantOnly.has(action) && role === "admin") {
    throw new Error("Administrator cannot impersonate a buyer or seller participant");
  }
  return role;
}
