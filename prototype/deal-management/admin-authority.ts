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
  nextAdminId: string,
  approvedAt: number,
  approvalReference: string,
): AdminAuthority {
  if (!nonBlank(authenticatedOwnerId) || authenticatedOwnerId !== current.ownerId) {
    throw new Error("Only the designated owner may replace the administrator");
  }
  if (!nonBlank(nextAdminId) || nextAdminId === current.ownerId ||
      nextAdminId === current.activeAdminId ||
      !Number.isSafeInteger(approvedAt) || approvedAt < current.appointedAt ||
      !nonBlank(approvalReference) ||
      !Number.isSafeInteger(current.generation) || current.generation < 1) {
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
