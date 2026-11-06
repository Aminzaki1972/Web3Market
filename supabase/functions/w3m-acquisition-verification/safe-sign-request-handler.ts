// W3M Protocol V1 — authenticated, fail-closed Safe SIGN request boundary.
// Dependency-injected on purpose: production credentials, fresh reads, typed-data
// verification and the atomic signer persistence RPC must be supplied server-side.
// This handler never trusts browser actor/wallet/role/owners/report authorization.
export interface W3MSignAuthorization {
  authorized: boolean;
  phase: "SIGN";
  dealId: string;
  safeTransactionHash: string | null;
  issues: string[];
  reportId?: string;
  reportVersion?: number;
}
export interface W3MSignContext {
  authorization: W3MSignAuthorization;
  verifiedWallet: string;
  signerRole: "buyer" | "seller";
  transactionStatus: "awaiting_signatures" | "signed";
}
export interface W3MSignPersistenceResult {
  recorded: boolean;
  idempotentReplay: boolean;
  confirmationsCount: number;
  requiredSignatures: number;
  status: "awaiting_signatures" | "signed";
}
export interface W3MSignHandlerDependencies {
  authenticate(request: Request): Promise<{ userId: string } | null>;
  loadFreshContext(input: {
    actorId: string;
    dealId: string;
    safeTransactionHash: string;
  }): Promise<W3MSignContext>;
  verifyTypedDataSignature(input: {
    dealId: string;
    safeTransactionHash: string;
    signature: string;
    expectedWallet: string;
    signerRole: "buyer" | "seller";
  }): Promise<boolean>;
  /** Must be a single service-role SQL RPC; never implement as multiple REST writes. */
  persistSignatureAtomically(input: {
    actorId: string;
    dealId: string;
    safeTransactionHash: string;
    signature: string;
    verifiedWallet: string;
    signerRole: "buyer" | "seller";
    authorization: W3MSignAuthorization;
  }): Promise<W3MSignPersistenceResult>;
}
const HASH = /^0x[0-9a-f]{64}$/i;
const SIGNATURE = /^0x[0-9a-f]{130}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
export function createW3MSafeSignRequestHandler(deps: W3MSignHandlerDependencies) {
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== "POST") return json(405, { ok: false, error: "POST_REQUIRED" });
    let actor: { userId: string } | null;
    try { actor = await deps.authenticate(request); } catch {
      return json(401, { ok: false, error: "AUTHENTICATION_FAILED" });
    }
    if (!actor || !UUID.test(actor.userId)) return json(401, { ok: false, error: "AUTHENTICATION_REQUIRED" });
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
      body = parsed as Record<string, unknown>;
    } catch { return json(400, { ok: false, error: "INVALID_JSON" }); }
    const dealId = body.deal_id;
    const safeHash = body.safe_tx_hash;
    const signature = body.signature;
    if (typeof dealId !== "string" || !UUID.test(dealId) ||
        typeof safeHash !== "string" || !HASH.test(safeHash) ||
        typeof signature !== "string" || !SIGNATURE.test(signature)) {
      return json(400, { ok: false, error: "INVALID_SIGN_REQUEST" });
    }
    try {
      const fresh = await deps.loadFreshContext({
        actorId: actor.userId,
        dealId,
        safeTransactionHash: safeHash,
      });
      const auth = fresh?.authorization;
      if (!auth || auth.authorized !== true || auth.phase !== "SIGN" ||
          auth.dealId !== dealId || auth.safeTransactionHash?.toLowerCase() !== safeHash.toLowerCase() ||
          !Array.isArray(auth.issues) || auth.issues.length !== 0) {
        return json(409, { ok: false, error: "W3M_SIGN_AUTHORIZATION_DENIED", issues: auth?.issues ?? [] });
      }
      if (!ADDRESS.test(fresh.verifiedWallet || "") ||
          (fresh.signerRole !== "buyer" && fresh.signerRole !== "seller") ||
          (fresh.transactionStatus !== "awaiting_signatures" && fresh.transactionStatus !== "signed")) {
        return json(409, { ok: false, error: "FRESH_SIGN_CONTEXT_INVALID" });
      }
      const valid = await deps.verifyTypedDataSignature({
        dealId,
        safeTransactionHash: safeHash,
        signature,
        expectedWallet: fresh.verifiedWallet,
        signerRole: fresh.signerRole,
      });
      if (valid !== true) return json(403, { ok: false, error: "SAFE_SIGNATURE_INVALID" });
      const saved = await deps.persistSignatureAtomically({
        actorId: actor.userId,
        dealId,
        safeTransactionHash: safeHash,
        signature,
        verifiedWallet: fresh.verifiedWallet,
        signerRole: fresh.signerRole,
        authorization: auth,
      });
      if (!saved || !Number.isInteger(saved.confirmationsCount) ||
          !Number.isInteger(saved.requiredSignatures) || saved.requiredSignatures !== 2 ||
          saved.confirmationsCount < 0 || saved.confirmationsCount > 2 ||
          (saved.status !== "awaiting_signatures" && saved.status !== "signed") ||
          typeof saved.recorded !== "boolean" || typeof saved.idempotentReplay !== "boolean") {
        return json(502, { ok: false, error: "ATOMIC_SIGN_PERSISTENCE_RESPONSE_INVALID" });
      }
      return json(200, {
        ok: true,
        recorded: saved.recorded,
        idempotent_replay: saved.idempotentReplay,
        confirmations_count: saved.confirmationsCount,
        required_signatures: 2,
        status: saved.status,
      });
    } catch {
      return json(409, { ok: false, error: "W3M_SIGN_FAIL_CLOSED" });
    }
  };
}
