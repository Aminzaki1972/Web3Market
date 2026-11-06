// W3M Protocol V1 — fail-closed PREPARE composition.
// This is the isolated replacement for the legacy multi-write PREPARE sequence.
// It must be called only from a server-side handler after authentication.
import type { EthereumDigestRecoveryVerifier } from "./signature-verifier.ts";
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";
import {
  authorizePrelockSafePrepare,
  type PrelockSafePrepareDependencies,
  type PrelockSafePrepareResult,
} from "./prelock-safe-prepare-gate.ts";
import {
  commitAtomicSafePrepare,
  type AtomicSafePrepareResult,
} from "./atomic-safe-prepare-rpc-adapter.ts";

export type AtomicPrelockPrepareResult =
  | { allowed: true; authorization: PrelockSafePrepareResult; committed: AtomicSafePrepareResult }
  | { allowed: false; authorization: PrelockSafePrepareResult };

export async function authorizeAndCommitPrelockSafePrepare(
  dependencies: PrelockSafePrepareDependencies,
  persistenceClient: W3MRpcClient,
  dealId: string,
  authenticatedActorId: string,
  now: string,
  recoverAndVerify: EthereumDigestRecoveryVerifier,
): Promise<AtomicPrelockPrepareResult> {
  const authorization = await authorizePrelockSafePrepare(
    dependencies, dealId, now, recoverAndVerify,
  );
  if (authorization.phase !== "PREPARE" || authorization.dealId !== dealId ||
      authorization.authorized !== true || authorization.issues.length !== 0 ||
      !authorization.atomicCommit) {
    return { allowed: false, authorization };
  }
  const committed = await commitAtomicSafePrepare(persistenceClient, {
    ...authorization.atomicCommit,
    actorId: authenticatedActorId,
  });
  return { allowed: true, authorization, committed };
}
