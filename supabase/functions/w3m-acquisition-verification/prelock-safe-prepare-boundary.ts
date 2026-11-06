// W3M Protocol V1 — side-effect boundary for the pre-lock PREPARE phase.
// This wrapper is the only supported composition point before the legacy
// prepare-deal-release policy/transaction/audit writes. The caller supplies
// those writes as a callback; they are never invoked unless the fresh gate
// returns an exact authorized nonce and terms hash.
import {
  authorizePrelockSafePrepare,
  type PrelockSafePrepareDependencies,
  type PrelockSafePrepareResult,
} from "./prelock-safe-prepare-gate.ts";
import type { EthereumDigestRecoveryVerifier } from "./signature-verifier.ts";

export type PrelockPrepareWrite<T> = (binding: {
  dealId: string;
  dealTermsHash: string;
  safeNonce: string;
  readBlockNumber: string;
  readBlockHash: string;
}) => Promise<T>;

export type PrelockPrepareBoundaryResult<T> =
  | { allowed: true; authorization: PrelockSafePrepareResult; value: T }
  | { allowed: false; authorization: PrelockSafePrepareResult; value?: never };

export async function executePrelockPrepareOnlyAfterW3M<T>(
  dependencies: PrelockSafePrepareDependencies,
  dealId: string,
  now: string,
  recoverAndVerify: EthereumDigestRecoveryVerifier,
  writePolicyAndPendingTransaction: PrelockPrepareWrite<T>,
): Promise<PrelockPrepareBoundaryResult<T>> {
  const authorization = await authorizePrelockSafePrepare(
    dependencies,
    dealId,
    now,
    recoverAndVerify,
  );
  if (!authorization.authorized ||
      typeof authorization.dealTermsHash !== "string" ||
      !/^[0-9a-f]{64}$/i.test(authorization.dealTermsHash) ||
      typeof authorization.safeNonce !== "string" ||
      !/^(0|[1-9][0-9]*)$/.test(authorization.safeNonce) ||
      typeof authorization.readBlockNumber !== "string" ||
      typeof authorization.readBlockHash !== "string" ||
      !/^0x[0-9a-f]{64}$/i.test(authorization.readBlockHash)) {
    return { allowed: false, authorization };
  }
  const value = await writePolicyAndPendingTransaction({
    dealId,
    dealTermsHash: authorization.dealTermsHash,
    safeNonce: authorization.safeNonce,
    readBlockNumber: authorization.readBlockNumber,
    readBlockHash: authorization.readBlockHash,
  });
  return { allowed: true, authorization, value };
}
