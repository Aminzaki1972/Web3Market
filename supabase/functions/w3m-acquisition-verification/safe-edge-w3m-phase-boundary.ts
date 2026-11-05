// Phase-aware W3M authorization contract for isolated Safe handler integration.
// PREPARE protects transaction preparation and signature recording.
// EXECUTE protects broadcast. FINALIZE protects post-receipt database finalization.
// The caller must supply a fresh server-side authorization for the requested phase.
import { executeOnlyAfterW3M, type W3MBoundaryAuthorization, type W3MBoundaryResult } from "./safe-edge-w3m-boundary.ts";

export type W3MSafePhase = "PREPARE" | "SIGN" | "EXECUTE" | "FINALIZE";

export interface W3MPhaseAuthorization extends W3MBoundaryAuthorization {
  phase: W3MSafePhase;
  dealId: string;
  safeTransactionHash?: string | null;
}

export async function executeSafePhaseOnlyAfterW3M<T>(
  expectedPhase: W3MSafePhase,
  authorizeFresh: () => Promise<W3MPhaseAuthorization>,
  protectedAction: () => Promise<T>,
): Promise<W3MBoundaryResult<T>> {
  return await executeOnlyAfterW3M(
    async () => {
      const authorization = await authorizeFresh();
      if (
        authorization.phase !== expectedPhase ||
        typeof authorization.dealId !== "string" ||
        authorization.dealId.trim().length === 0 ||
        (expectedPhase !== "PREPARE" && expectedPhase !== "SIGN" &&
          (typeof authorization.safeTransactionHash !== "string" ||
           !/^0x[0-9a-fA-F]{64}$/.test(authorization.safeTransactionHash)))
      ) {
        return {
          authorized: false,
          issues: ["W3M_PHASE_OR_BINDING_MISMATCH"],
          reportId: authorization.reportId,
          reportVersion: authorization.reportVersion,
        };
      }
      return authorization;
    },
    protectedAction,
  );
}
