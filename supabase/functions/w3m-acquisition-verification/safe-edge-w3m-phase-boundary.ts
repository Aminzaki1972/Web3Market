// Phase-aware W3M authorization contract for isolated Safe handler integration.
// Every caller supplies the exact deal and, for SIGN/EXECUTE/FINALIZE, Safe tx hash
// it is about to mutate. The fresh authorization must match both before side effects.
import { executeOnlyAfterW3M, type W3MBoundaryAuthorization, type W3MBoundaryResult } from "./safe-edge-w3m-boundary.ts";

export type W3MSafePhase = "PREPARE" | "SIGN" | "EXECUTE" | "FINALIZE";

export interface W3MPhaseAuthorization extends W3MBoundaryAuthorization {
  phase: W3MSafePhase;
  dealId: string;
  safeTransactionHash?: string | null;
}

export interface W3MExpectedPhaseBinding {
  dealId: string;
  safeTransactionHash?: string | null;
}

const HASH = /^0x[0-9a-fA-F]{64}$/;

export async function executeSafePhaseOnlyAfterW3M<T>(
  expectedPhase: W3MSafePhase,
  expected: W3MExpectedPhaseBinding,
  authorizeFresh: () => Promise<W3MPhaseAuthorization>,
  protectedAction: () => Promise<T>,
): Promise<W3MBoundaryResult<T>> {
  return await executeOnlyAfterW3M(
    async () => {
      if (typeof expected?.dealId !== "string" || !expected.dealId.trim()) {
        return { authorized: false, issues: ["W3M_EXPECTED_DEAL_BINDING_MISSING"] };
      }
      const requiresHash = expectedPhase === "SIGN" || expectedPhase === "EXECUTE" ||
        expectedPhase === "FINALIZE";
      if (requiresHash && (typeof expected.safeTransactionHash !== "string" ||
          !HASH.test(expected.safeTransactionHash))) {
        return { authorized: false, issues: ["W3M_EXPECTED_SAFE_HASH_MISSING"] };
      }

      const authorization = await authorizeFresh();
      if (!authorization || authorization.phase !== expectedPhase ||
          authorization.dealId !== expected.dealId ||
          (requiresHash && (typeof authorization.safeTransactionHash !== "string" ||
            authorization.safeTransactionHash.toLowerCase() !== expected.safeTransactionHash!.toLowerCase()))) {
        return {
          authorized: false,
          issues: ["W3M_PHASE_OR_BINDING_MISMATCH"],
          reportId: authorization?.reportId,
          reportVersion: authorization?.reportVersion,
        };
      }
      return authorization;
    },
    protectedAction,
  );
}
