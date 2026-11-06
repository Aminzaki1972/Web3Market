// Server-side composition layer for isolated Safe handler integration.
// Loads a fresh exact Deal Room snapshot, current Safe facts, persisted W3M report,
// evidence and trusted signer state, then evaluates the stage-specific gate.
// FINALIZE is deliberately denied here: it requires independently verified BNB
// receipt/log evidence and the atomic finalization RPC, not a pre-execution gate.
import { checkDealRoomFromExactSnapshot, type CheckDealRoomFromSnapshotInput } from "./dealroom-terms-reader.ts";
import type { EthereumDigestRecoveryVerifier } from "./signature-verifier.ts";
import type { W3MSafePhase, W3MPhaseAuthorization } from "./safe-edge-w3m-phase-boundary.ts";

export type FreshSafeW3MContext = Omit<CheckDealRoomFromSnapshotInput, "stage" | "now"> & {
  now: string;
  /** Exact Safe hash loaded from the authoritative server-side transaction row. */
  safeTransactionHash?: string | null;
  /** Verified EIP-712 agreement pair from the strict Safe snapshot adapter. */
  agreementBinding?: {
    termsVersionId: string;
    termsVersion: string;
    termsHash: string;
    buyerAcceptanceId: string;
    sellerAcceptanceId: string;
    buyerDigest: string;
    sellerDigest: string;
  };
};

export async function authorizeSafeHandlerPhase(
  phase: W3MSafePhase,
  loadFreshContext: () => Promise<FreshSafeW3MContext>,
  recoverAndVerify: EthereumDigestRecoveryVerifier,
  safeTransactionHash?: string | null,
): Promise<W3MPhaseAuthorization> {
  if (phase === "FINALIZE") {
    return {
      authorized: false,
      issues: ["W3M_FINALIZATION_REQUIRES_VERIFIED_RECEIPT"],
      phase,
      dealId: "",
      safeTransactionHash: safeTransactionHash ?? null,
    };
  }

  try {
    const fresh = await loadFreshContext();
    if (!fresh || typeof fresh.dealId !== "string" || !fresh.dealId.trim()) {
      throw new Error("Fresh deal context is missing.");
    }
    const requiresStoredHash = phase === "SIGN" || phase === "EXECUTE";
    if (requiresStoredHash) {
      const agreement = fresh.agreementBinding;
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const hash = /^[0-9a-f]{64}$/i;
      const digest = /^0x[0-9a-f]{64}$/i;
      if (!agreement || !uuid.test(agreement.termsVersionId) ||
          !/^[1-9][0-9]*$/.test(agreement.termsVersion) ||
          !hash.test(agreement.termsHash) ||
          !uuid.test(agreement.buyerAcceptanceId) ||
          !uuid.test(agreement.sellerAcceptanceId) ||
          agreement.buyerAcceptanceId === agreement.sellerAcceptanceId ||
          !digest.test(agreement.buyerDigest) ||
          !digest.test(agreement.sellerDigest) ||
          agreement.buyerDigest.toLowerCase() === agreement.sellerDigest.toLowerCase()) {
        return {
          authorized: false,
          issues: ["W3M_IMMUTABLE_PARTY_AGREEMENT_REQUIRED"],
          phase,
          dealId: fresh.dealId,
          safeTransactionHash: fresh.safeTransactionHash ?? null,
        };
      }
    }
    if (requiresStoredHash && (
      typeof safeTransactionHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(safeTransactionHash) ||
      typeof fresh.safeTransactionHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(fresh.safeTransactionHash) ||
      fresh.safeTransactionHash.toLowerCase() !== safeTransactionHash.toLowerCase()
    )) {
      return {
        authorized: false,
        issues: ["W3M_SAFE_TRANSACTION_HASH_BINDING_MISMATCH"],
        phase,
        dealId: fresh.dealId,
        safeTransactionHash: fresh.safeTransactionHash ?? null,
      };
    }
    const stage = phase === "EXECUTE" ? "EXECUTE" : "PREPARE";
    const result = await checkDealRoomFromExactSnapshot({
      ...fresh,
      stage,
      now: fresh.now,
    }, recoverAndVerify);
    const issues = [
      ...result.decision.issues.map((issue) => issue.code),
      ...result.reportVerificationIssues,
    ];
    return {
      authorized: result.authorized === true && issues.length === 0,
      issues,
      phase,
      dealId: fresh.dealId,
      safeTransactionHash: fresh.safeTransactionHash ?? safeTransactionHash ?? null,
      reportId: result.decision.reportId,
      reportVersion: result.decision.reportVersion,
    };
  } catch {
    return {
      authorized: false,
      issues: ["W3M_FRESH_AUTHORIZATION_READ_FAILED"],
      phase,
      dealId: "",
      safeTransactionHash: safeTransactionHash ?? null,
    };
  }
}
