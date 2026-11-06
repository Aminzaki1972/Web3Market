// W3M Protocol V1 — mandatory boundary between PREPARE authorization and writes.
import type { PrelockSafePrepareResult } from "./prelock-safe-prepare-gate.ts";

export interface PrelockPrepareCommitBinding {
  dealId: string;
  dealTermsHash: string;
  safeNonce: string;
  readBlockNumber: string;
  readBlockHash: string;
}

export type PrelockPrepareCommitResult<T> =
  | { committed: false; issues: string[]; phase: "PREPARE" }
  | { committed: true; binding: PrelockPrepareCommitBinding; value: T; phase: "PREPARE" };

const HASH = /^0x[0-9a-f]{64}$/i;
const UINT = /^(0|[1-9][0-9]*)$/;
const BLOCK = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;

export async function commitReleasePreparationOnlyAfterW3M<T>(
  authorization: PrelockSafePrepareResult,
  commit: (binding: PrelockPrepareCommitBinding) => Promise<T>,
): Promise<PrelockPrepareCommitResult<T>> {
  if (authorization.phase !== "PREPARE" || authorization.authorized !== true ||
      !authorization.dealId || !authorization.dealTermsHash ||
      !HASH.test(authorization.dealTermsHash) ||
      !authorization.safeNonce || !UINT.test(authorization.safeNonce) ||
      !authorization.readBlockNumber || !BLOCK.test(authorization.readBlockNumber) ||
      !authorization.readBlockHash || !HASH.test(authorization.readBlockHash) ||
      !Array.isArray(authorization.issues) || authorization.issues.length !== 0) {
    return {
      committed: false,
      issues: [...(Array.isArray(authorization.issues) ? authorization.issues : []),
        "W3M_PRELOCK_COMMIT_BINDING_MISSING_OR_INVALID"],
      phase: "PREPARE",
    };
  }
  const binding: PrelockPrepareCommitBinding = {
    dealId: authorization.dealId,
    dealTermsHash: authorization.dealTermsHash,
    safeNonce: authorization.safeNonce,
    readBlockNumber: authorization.readBlockNumber,
    readBlockHash: authorization.readBlockHash,
  };
  const value = await commit(binding);
  return { committed: true, binding, value, phase: "PREPARE" };
}
