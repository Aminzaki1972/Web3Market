/**
 * Owner-controlled single-administrator authority model for the isolated sandbox.
 *
 * This is a pure domain model, not deployed identity/authentication. Production
 * must verify the owner's authenticated session, enforce the owner authority in
 * server-side storage/RLS, and atomically append an immutable appointment event.
 */
export type AdminAuthority = Readonly<{
  ownerId: string;
  activeAdminId: string;
  generation: number;
  appointedAt: number;
  approvalReference: string;
}>;

export type AdminAuthorityEvent = Readonly<{
  eventType: "admin_appointed" | "admin_replaced";
  ownerId: string;
  previousAdminId: string | null;
  activeAdminId: string;
  generation: number;
  occurredAt: number;
  approvalReference: string;
}>;

export type AdminAuthorityTransition = Readonly<{
  authority: AdminAuthority;
  event: AdminAuthorityEvent;
}>;

function nonBlank(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function createAdminAuthority(
  authenticatedOwnerId: string,
  designatedOwnerId: string,
  initialAdminId: string,
  appointedAt: number,
  approvalReference: string,
): AdminAuthority {
  if (!nonBlank(authenticatedOwnerId) || authenticatedOwnerId !== designatedOwnerId) {
    throw new Error("Only the designated owner may appoint the administrator");
  }
  if (!nonBlank(initialAdminId) || initialAdminId === designatedOwnerId ||
      !Number.isSafeInteger(appointedAt) || appointedAt < 0 ||
      !nonBlank(approvalReference)) {
    throw new Error("Initial administrator appointment is invalid");
  }
  return Object.freeze({
    ownerId: designatedOwnerId,
    activeAdminId: initialAdminId,
    generation: 1,
    appointedAt,
    approvalReference,
  });
}

export function replaceAdmin(
  authenticatedOwnerId: string,
  current: AdminAuthority,
  expectedGeneration: number,
  nextAdminId: string,
  approvedAt: number,
  approvalReference: string,
): AdminAuthority {
  if (!nonBlank(authenticatedOwnerId) || authenticatedOwnerId !== current.ownerId) {
    throw new Error("Only the designated owner may replace the administrator");
  }
  if (!Number.isSafeInteger(current.generation) || current.generation < 1 ||
      !Number.isSafeInteger(expectedGeneration) || expectedGeneration !== current.generation) {
    throw new Error("Administrator authority changed; reload before replacing");
  }
  if (!nonBlank(current.activeAdminId) || current.activeAdminId === current.ownerId ||
      !Number.isSafeInteger(current.appointedAt) || current.appointedAt < 0 ||
      !nonBlank(current.approvalReference) ||
      !nonBlank(nextAdminId) || nextAdminId === current.ownerId ||
      nextAdminId === current.activeAdminId ||
      !Number.isSafeInteger(approvedAt) || approvedAt < current.appointedAt ||
      !nonBlank(approvalReference)) {
    throw new Error("Administrator replacement is invalid");
  }
  return Object.freeze({
    ownerId: current.ownerId,
    activeAdminId: nextAdminId,
    generation: current.generation + 1,
    appointedAt: approvedAt,
    approvalReference,
  });
}

/** Builds the immutable audit event for a validated authority transition. */
export function createAdminReplacementEvent(
  previous: AdminAuthority,
  next: AdminAuthority,
): AdminAuthorityEvent {
  if (next.ownerId !== previous.ownerId ||
      next.generation !== previous.generation + 1 ||
      next.activeAdminId === previous.activeAdminId ||
      next.appointedAt < previous.appointedAt) {
    throw new Error("Administrator transition is not a valid single-step replacement");
  }
  return Object.freeze({
    eventType: "admin_replaced",
    ownerId: next.ownerId,
    previousAdminId: previous.activeAdminId,
    activeAdminId: next.activeAdminId,
    generation: next.generation,
    occurredAt: next.appointedAt,
    approvalReference: next.approvalReference,
  });
}
