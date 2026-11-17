// W3M Protocol V1 — fail-closed adapter for Safe Edge Function boundaries.
// Each isolated Safe handler must call this immediately before its protected
// side effect. The authorizer must reload authoritative state on every call.
// This helper performs no I/O and does not itself authorize or execute a deal.

export interface W3MBoundaryAuthorization {
  authorized: boolean;
  issues: string[];
  reportId?: string | null;
  reportVersion?: number | null;
}

export interface W3MBoundaryResult<T> {
  allowed: boolean;
  authorization: W3MBoundaryAuthorization;
  value?: T;
}

export async function executeOnlyAfterW3M<T>(
  authorizeFresh: () => Promise<W3MBoundaryAuthorization>,
  protectedAction: () => Promise<T>,
): Promise<W3MBoundaryResult<T>> {
  let authorization: W3MBoundaryAuthorization;
  try {
    authorization = await authorizeFresh();
  } catch {
    return {
      allowed: false,
      authorization: {
        authorized: false,
        issues: ["W3M_AUTHORIZATION_UNAVAILABLE"],
      },
    };
  }

  if (
    !authorization ||
    authorization.authorized !== true ||
    !Array.isArray(authorization.issues) ||
    authorization.issues.length !== 0
  ) {
    return {
      allowed: false,
      authorization: authorization && Array.isArray(authorization.issues)
        ? { ...authorization, authorized: false }
        : { authorized: false, issues: ["W3M_AUTHORIZATION_MALFORMED"] },
    };
  }

  const value = await protectedAction();
  return { allowed: true, authorization, value };
}
