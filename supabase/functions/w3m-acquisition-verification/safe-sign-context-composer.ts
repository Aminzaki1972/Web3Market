// W3M Protocol V1 — phase-aware fresh context composer for Safe SIGN.
// It is intentionally separate from EXECUTE: SIGN accepts an awaiting-signatures
// transaction, while EXECUTE requires the full threshold and execution snapshot.
import {
  loadFreshSafeHandlerContext,
  type FreshSafeHandlerContextDependencies,
} from "./fresh-safe-handler-context.ts";
import { authorizeSafeHandlerPhase } from "./safe-handler-w3m-authorizer.ts";
import { verifyEthereumRawDigestSignature } from "./ethereum-signature-adapter.ts";
import type { W3MSignContext } from "./safe-sign-request-handler.ts";

export async function loadAndAuthorizeFreshSafeSignContext(
  dependencies: FreshSafeHandlerContextDependencies,
  input: {
    actorId: string;
    dealId: string;
    safeTransactionHash: string;
    now: string;
  },
): Promise<W3MSignContext> {
  const fresh = await loadFreshSafeHandlerContext(
    dependencies,
    input.dealId,
    input.now,
    "SIGN",
    input.actorId,
  );
  if (!fresh.verifiedWallet ||
      (fresh.signerRole !== "buyer" && fresh.signerRole !== "seller")) {
    throw new Error("Authenticated deal participant has no verified signing wallet.");
  }
  const decision = await authorizeSafeHandlerPhase(
    "SIGN",
    async () => fresh,
    verifyEthereumRawDigestSignature,
    input.safeTransactionHash,
  );
  const authorization = {
    authorized: decision.authorized,
    phase: "SIGN" as const,
    dealId: decision.dealId,
    safeTransactionHash: decision.safeTransactionHash ?? null,
    issues: decision.issues,
    reportId: decision.reportId ?? undefined,
    reportVersion: decision.reportVersion ?? undefined,
  };
  return {
    authorization,
    verifiedWallet: fresh.verifiedWallet,
    signerRole: fresh.signerRole,
    transactionStatus: fresh.transactionStatus,
  };
}
