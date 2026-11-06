// W3M Protocol V1 — authenticated, one-use connected-wallet package endpoint.
// It never signs, broadcasts, or accepts client-supplied execution facts.
import {
  buildSafeWalletExecutionPackage,
  type BuildSafeWalletExecutionPackageInput,
  type SafeWalletExecutionPackage,
} from "./safe-wallet-execution-package.ts";
import {
  claimSafeExecutionAttempt,
  issueSafeWalletExecutionPackage,
  markSafeExecutionReconciliationRequired,
  type W3MRpcClient,
} from "./supabase-rpc-adapter.ts";
import type { SafeExecutionFreshSnapshot } from "./safe-execution-coordinator.ts";
import type { CanonicalBnbSafeExecutionFacts } from "./bnb-safe-execution-facts-reader.ts";
import type { SafeDigestSignatureVerifier } from "./safe-signature-set-validator.ts";
import { canonicalJson, sha256Hex } from "./decision-engine.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
function stablePackage(value: SafeWalletExecutionPackage): string {
  const copy = structuredClone(value) as unknown as Record<string, unknown>;
  delete copy.issuedAt;
  delete copy.expiresAt;
  delete copy.readBlockNumber;
  delete copy.readBlockHash;
  return canonicalJson(copy);
}

export interface W3MSafeWalletPackageRequestDependencies {
  authenticate(request: Request): Promise<{ userId: string } | null>;
  loadFresh(actorId: string, dealId: string): Promise<SafeExecutionFreshSnapshot>;
  loadLiveFacts(snapshot: SafeExecutionFreshSnapshot): Promise<CanonicalBnbSafeExecutionFacts>;
  rpc: W3MRpcClient;
  verifySignature?: SafeDigestSignatureVerifier;
  now?: () => number;
  buildPackage?: (input: BuildSafeWalletExecutionPackageInput) => Promise<SafeWalletExecutionPackage>;
}

export function createW3MSafeWalletPackageRequestHandler(
  deps: W3MSafeWalletPackageRequestDependencies,
) {
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== "POST") return json(405, { ok: false, error: "POST_REQUIRED" });
    let actor: { userId: string } | null;
    try { actor = await deps.authenticate(request); } catch {
      return json(401, { ok: false, error: "AUTHENTICATION_FAILED" });
    }
    if (!actor || !UUID.test(actor.userId)) {
      return json(401, { ok: false, error: "AUTHENTICATION_REQUIRED" });
    }
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
      body = parsed as Record<string, unknown>;
    } catch { return json(400, { ok: false, error: "INVALID_JSON" }); }
    if (typeof body.deal_id !== "string" || !UUID.test(body.deal_id)) {
      return json(400, { ok: false, error: "INVALID_PACKAGE_REQUEST" });
    }

    const now = deps.now?.() ?? Date.now();
    const issuedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + 90_000).toISOString();
    const build = deps.buildPackage ?? buildSafeWalletExecutionPackage;
    let attemptId: string | null = null;
    try {
      const first = await deps.loadFresh(actor.userId, body.deal_id);
      if (first.dealId !== body.deal_id || first.executorRef !== actor.userId ||
          !first.idempotencyKey?.trim()) {
        return json(403, { ok: false, error: "EXECUTION_ACTOR_OR_DEAL_BINDING_INVALID" });
      }
      const firstFacts = await deps.loadLiveFacts(first);
      const firstPackage = await build({
        snapshot: first, liveFacts: firstFacts, issuedAt, expiresAt,
        verifySignature: deps.verifySignature,
      });
      const claim = await claimSafeExecutionAttempt(deps.rpc, {
        dealId: first.dealId,
        transactionId: first.transactionId,
        reportId: first.reportId,
        safeTxHash: firstPackage.safeTransactionHash,
        executorRef: actor.userId,
        idempotencyKey: first.idempotencyKey,
      });
      attemptId = claim.attemptId;
      if (!claim.claimed || claim.state !== "CLAIMED") {
        return json(409, {
          ok: false, state: claim.state, attempt_id: claim.attemptId,
          error: "EXECUTION_ATTEMPT_NOT_AVAILABLE_FOR_PACKAGE",
        });
      }

      let fresh: SafeExecutionFreshSnapshot;
      let freshPackage: SafeWalletExecutionPackage;
      try {
        fresh = await deps.loadFresh(actor.userId, body.deal_id);
        if (fresh.dealId !== first.dealId || fresh.executorRef !== actor.userId ||
            fresh.transactionId !== first.transactionId ||
            fresh.reportId !== first.reportId ||
            fresh.reportVersion !== first.reportVersion ||
            fresh.idempotencyKey !== first.idempotencyKey ||
            fresh.agreementBinding?.termsVersionId !== first.agreementBinding?.termsVersionId ||
            fresh.agreementBinding?.termsVersion !== first.agreementBinding?.termsVersion ||
            fresh.agreementBinding?.termsHash?.toLowerCase() !== first.agreementBinding?.termsHash?.toLowerCase() ||
            fresh.agreementBinding?.buyerAcceptanceId !== first.agreementBinding?.buyerAcceptanceId ||
            fresh.agreementBinding?.sellerAcceptanceId !== first.agreementBinding?.sellerAcceptanceId ||
            fresh.agreementBinding?.buyerDigest?.toLowerCase() !== first.agreementBinding?.buyerDigest?.toLowerCase() ||
            fresh.agreementBinding?.sellerDigest?.toLowerCase() !== first.agreementBinding?.sellerDigest?.toLowerCase()) {
          throw new Error("PRE_ISSUANCE_BINDING_CHANGED");
        }
        const freshFacts = await deps.loadLiveFacts(fresh);
        freshPackage = await build({
          snapshot: fresh, liveFacts: freshFacts, issuedAt, expiresAt,
          verifySignature: deps.verifySignature,
        });
        if (stablePackage(firstPackage) !== stablePackage(freshPackage)) {
          throw new Error("PRE_ISSUANCE_SAFE_STATE_CHANGED");
        }
      } catch {
        await markSafeExecutionReconciliationRequired(
          deps.rpc, claim.attemptId, "WALLET_PACKAGE_PRE_ISSUANCE_STATE_CHANGED",
        ).catch(() => undefined);
        return json(409, {
          ok: false, state: "RECONCILIATION_REQUIRED", attempt_id: claim.attemptId,
          error: "WALLET_PACKAGE_REQUIRES_RECONCILIATION",
        });
      }

      const packageHash = await sha256Hex(canonicalJson(freshPackage));
      const issued = await issueSafeWalletExecutionPackage(deps.rpc, {
        attemptId: claim.attemptId,
        actorId: actor.userId,
        packageHash,
        package: freshPackage as unknown as Record<string, unknown>,
        expiresAt: freshPackage.expiresAt,
      });
      const stored = issued.package as unknown as SafeWalletExecutionPackage;
      if (Date.parse(issued.expiresAt) <= (deps.now?.() ?? Date.now()) ||
          stored.dealId !== body.deal_id ||
          stablePackage(stored) !== stablePackage(freshPackage)) {
        await markSafeExecutionReconciliationRequired(
          deps.rpc, claim.attemptId, "WALLET_PACKAGE_STORED_BINDING_MISMATCH",
        ).catch(() => undefined);
        return json(409, {
          ok: false, state: "RECONCILIATION_REQUIRED", attempt_id: claim.attemptId,
          error: "STORED_WALLET_PACKAGE_BINDING_MISMATCH",
        });
      }
      return json(200, {
        ok: true,
        state: "PACKAGE_ISSUED",
        attempt_id: claim.attemptId,
        package_hash: issued.packageHash,
        idempotent_replay: issued.idempotentReplay,
        package: stored,
      });
    } catch {
      if (attemptId) {
        await markSafeExecutionReconciliationRequired(
          deps.rpc, attemptId, "WALLET_PACKAGE_ISSUANCE_FAILED",
        ).catch(() => undefined);
      }
      return json(409, {
        ok: false,
        state: attemptId ? "RECONCILIATION_REQUIRED" : "BLOCKED",
        attempt_id: attemptId,
        error: "W3M_WALLET_PACKAGE_FAIL_CLOSED",
      });
    }
  };
}
