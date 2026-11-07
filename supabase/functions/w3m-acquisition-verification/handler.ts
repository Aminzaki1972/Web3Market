import {
  buildW3MAgreementTypedData,
  verifyW3MAgreementSignature,
  type W3MAgreementTypedData,
} from "./agreement-signature.ts";

export type W3MAdminClient = {
  auth: {
    getUser(token: string): Promise<{
      data?: { user?: { id: string } | null };
      error?: unknown;
    }>;
  };
  rpc(name: string, args: Record<string, unknown>): Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

type ChallengeRow = {
  id: string;
  deal_id: string;
  project_id: string;
  audit_id: string;
  fingerprint_id: string;
  fingerprint_digest: string;
  binding_hash: string;
  terms_hash: string;
  terms_version: number | string;
  party_role: "buyer" | "seller";
  user_id: string;
  wallet_address: string;
  nonce: string;
  signature_deadline: number | string;
  created_at: string;
  consumed_at: string | null;
};

type HandlerDependencies = {
  createAdminClient(url: string, serviceKey: string): W3MAdminClient;
  getEnv(name: string): string | undefined;
  nowSeconds?: () => number;
  randomBytes?: (length: number) => Uint8Array;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_32 = /^[0-9a-f]{64}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const SIGNATURE = /^0x[0-9a-f]{130}$/i;
const ORIGINS = new Set(["https://web3market.xyz", "https://www.web3market.xyz"]);

function allowedOrigin(origin: string | null): boolean {
  if (!origin) return true;
  if (ORIGINS.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:" &&
      (parsed.hostname === "web3market.pages.dev" ||
        parsed.hostname.endsWith(".web3market.pages.dev"));
  } catch {
    return false;
  }
}

function headers(origin: string | null): HeadersInit {
  const result: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
  if (origin && allowedOrigin(origin)) result["Access-Control-Allow-Origin"] = origin;
  return result;
}

function reply(origin: string | null, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}

function bearerToken(value: string | null): string | null {
  const match = /^Bearer\s+(.+)$/i.exec((value || "").trim());
  return match?.[1]?.trim() || null;
}

function uuidBytes32(value: string): string {
  if (!UUID.test(value)) throw new Error("Invalid UUID in trusted challenge evidence.");
  return "0x" + value.replaceAll("-", "").toLowerCase().padStart(64, "0");
}

function typedDataFromRow(row: ChallengeRow, now: number): W3MAgreementTypedData {
  const deadline = Number(row.signature_deadline);
  if (!Number.isSafeInteger(deadline)) throw new Error("Invalid challenge deadline.");
  return buildW3MAgreementTypedData({
    dealId: uuidBytes32(row.deal_id),
    fingerprintId: uuidBytes32(row.fingerprint_id),
    fingerprintDigest: "0x" + row.fingerprint_digest,
    bindingHash: "0x" + row.binding_hash,
    termsHash: "0x" + row.terms_hash,
    termsVersion: String(row.terms_version),
    partyRole: row.party_role,
    walletAddress: row.wallet_address,
    nonce: row.nonce,
    deadline,
  }, now);
}

function challengeInput(body: Record<string, unknown>): {
  dealId: string;
  projectId: string;
  auditId: string;
  fingerprintId: string;
  fingerprintDigest: string;
  bindingHash: string;
  termsHash: string;
  termsVersion: number;
  partyRole: "buyer" | "seller";
  walletAddress: string;
} | null {
  const dealId = String(body.deal_id || "");
  const projectId = String(body.project_id || "");
  const auditId = String(body.audit_id || "");
  const fingerprintId = String(body.fingerprint_id || "");
  const fingerprintDigest = String(body.fingerprint_digest || "");
  const bindingHash = String(body.binding_hash || "");
  const termsHash = String(body.terms_hash || "");
  const termsVersionText = String(body.terms_version || "");
  const walletAddress = String(body.wallet_address || "");
  const partyRole = body.party_role;
  const termsVersion = Number(termsVersionText);
  if (
    !UUID.test(dealId) || !UUID.test(projectId) || !UUID.test(auditId) ||
    !UUID.test(fingerprintId) || !HEX_32.test(fingerprintDigest) ||
    !HEX_32.test(bindingHash) || !HEX_32.test(termsHash) ||
    !/^[1-9][0-9]*$/.test(termsVersionText) ||
    !Number.isSafeInteger(termsVersion) ||
    (partyRole !== "buyer" && partyRole !== "seller") ||
    !ADDRESS.test(walletAddress)
  ) return null;
  return {
    dealId, projectId, auditId, fingerprintId,
    fingerprintDigest: fingerprintDigest.toLowerCase(),
    bindingHash: bindingHash.toLowerCase(),
    termsHash: termsHash.toLowerCase(),
    termsVersion, partyRole, walletAddress,
  };
}

function oneChallenge(data: unknown): ChallengeRow | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  const row = data[0] as ChallengeRow;
  if (!row || typeof row !== "object") return null;
  return row;
}

function rpcStatus(error: { code?: string; message?: string } | null): number {
  const code = error?.code || "";
  if (code === "42501") return 403;
  if (code === "22023" || code === "23503" || code === "23505" || code === "P0002") return 409;
  return 500;
}

export function createW3MAcquisitionHandler(deps: HandlerDependencies) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("Origin");
    if (!allowedOrigin(origin)) return reply(null, { ok: false, error: "Origin not allowed" }, 403);
    if (req.method === "OPTIONS") return new Response("ok", { status: 204, headers: headers(origin) });
    if (req.method !== "POST") return reply(origin, { ok: false, error: "POST required" }, 405);
    const token = bearerToken(req.headers.get("Authorization"));
    if (!token) return reply(origin, { ok: false, error: "Sign in required" }, 401);
    const contentLength = Number(req.headers.get("Content-Length") || "0");
    if (contentLength > 16_384) return reply(origin, { ok: false, error: "Request too large" }, 413);

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return reply(origin, { ok: false, error: "JSON object required" }, 400);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return reply(origin, { ok: false, error: "Valid JSON body required" }, 400);
    }

    const url = deps.getEnv("SUPABASE_URL");
    const serviceKey = deps.getEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) {
      return reply(origin, { ok: false, error: "W3M verification service is not configured" }, 503);
    }

    try {
      const admin = deps.createAdminClient(url, serviceKey);
      const { data: authData, error: authError } = await admin.auth.getUser(token);
      const user = authData?.user;
      if (authError || !user?.id) return reply(origin, { ok: false, error: "Unauthorized" }, 401);

      const now = deps.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
      if (!Number.isSafeInteger(now) || now < 0) {
        return reply(origin, { ok: false, error: "Verification clock unavailable" }, 503);
      }

      if (body.action === "challenge") {
        const input = challengeInput(body);
        if (!input) return reply(origin, { ok: false, error: "Invalid agreement challenge parameters" }, 400);
        const random = deps.randomBytes
          ? deps.randomBytes(32)
          : crypto.getRandomValues(new Uint8Array(32));
        if (!(random instanceof Uint8Array) || random.length !== 32) {
          return reply(origin, { ok: false, error: "Secure nonce generation failed" }, 503);
        }
        const nonce = "0x" + Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("");
        const deadline = now + 600;
        const { data: challengeId, error: issueError } = await admin.rpc(
          "w3m_issue_agreement_challenge",
          {
            p_deal_id: input.dealId,
            p_project_id: input.projectId,
            p_audit_id: input.auditId,
            p_fingerprint_id: input.fingerprintId,
            p_fingerprint_digest: input.fingerprintDigest,
            p_binding_hash: input.bindingHash,
            p_terms_hash: input.termsHash,
            p_terms_version: input.termsVersion,
            p_party_role: input.partyRole,
            p_user_id: user.id,
            p_wallet_address: input.walletAddress,
            p_nonce: nonce,
            p_signature_deadline: deadline,
          },
        );
        if (issueError) {
          const status = rpcStatus(issueError);
          return reply(origin, {
            ok: false,
            error: status === 403 ? "You are not authorized for this deal or verified wallet" :
              status === 409 ? "Deal, audit binding, or current terms are not eligible" :
                "Unable to issue agreement challenge",
          }, status);
        }
        if (typeof challengeId !== "string" || !UUID.test(challengeId)) {
          return reply(origin, { ok: false, error: "Challenge persistence could not be confirmed" }, 503);
        }
        const { data: challengeData, error: readError } = await admin.rpc(
          "w3m_get_agreement_challenge_for_verification",
          { p_challenge_id: challengeId },
        );
        if (readError) throw readError;
        const row = oneChallenge(challengeData);
        if (!row || row.user_id !== user.id || row.nonce !== nonce ||
          row.terms_hash !== input.termsHash || Number(row.signature_deadline) !== deadline ||
          row.consumed_at !== null) {
          return reply(origin, { ok: false, error: "Persisted challenge did not match the request" }, 503);
        }
        const typedData = typedDataFromRow(row, now);
        return reply(origin, { ok: true, challenge_id: challengeId, typed_data: typedData });
      }

      if (body.action === "accept") {
        const challengeId = String(body.challenge_id || "");
        const signature = String(body.signature || "");
        if (!UUID.test(challengeId) || !SIGNATURE.test(signature)) {
          return reply(origin, { ok: false, error: "Valid challenge_id and 65-byte signature are required" }, 400);
        }
        const { data: challengeData, error: readError } = await admin.rpc(
          "w3m_get_agreement_challenge_for_verification",
          { p_challenge_id: challengeId },
        );
        if (readError) throw readError;
        const row = oneChallenge(challengeData);
        if (!row) return reply(origin, { ok: false, error: "Agreement challenge not found" }, 404);
        if (row.user_id !== user.id) return reply(origin, { ok: false, error: "Challenge belongs to another account" }, 403);
        if (row.consumed_at !== null) return reply(origin, { ok: false, error: "Challenge has already been used" }, 409);

        let verified: ReturnType<typeof verifyW3MAgreementSignature>;
        try {
          const typedData = typedDataFromRow(row, now);
          verified = verifyW3MAgreementSignature({
            dealId: typedData.message.dealId,
            fingerprintId: typedData.message.fingerprintId,
            fingerprintDigest: typedData.message.fingerprintDigest,
            bindingHash: typedData.message.bindingHash,
            termsHash: typedData.message.termsHash,
            termsVersion: typedData.message.termsVersion,
            partyRole: row.party_role,
            walletAddress: row.wallet_address,
            nonce: typedData.message.nonce,
            deadline: Number(typedData.message.deadline),
          }, signature, now);
        } catch {
          return reply(origin, { ok: false, error: "Agreement signature is invalid, expired, or from the wrong wallet" }, 422);
        }

        const { data: acceptanceId, error: acceptError } = await admin.rpc(
          "w3m_record_agreement_acceptance",
          {
            p_challenge_id: challengeId,
            p_user_id: user.id,
            p_party_role: row.party_role,
            p_wallet_address: row.wallet_address,
            p_recovered_signer: verified.recoveredAddress,
            p_signature: signature,
            p_accepted_at: new Date(now * 1000).toISOString(),
          },
        );
        if (acceptError) {
          const status = rpcStatus(acceptError);
          return reply(origin, {
            ok: false,
            error: status === 403 ? "Deal, wallet, or participant state changed" :
              status === 409 ? "Challenge expired, was consumed, or its terms are no longer current" :
                "Unable to record agreement acceptance",
          }, status);
        }
        if (typeof acceptanceId !== "string" || !UUID.test(acceptanceId)) {
          return reply(origin, { ok: false, error: "Acceptance persistence could not be confirmed" }, 503);
        }
        return reply(origin, { ok: true, acceptance_id: acceptanceId });
      }

      return reply(origin, { ok: false, error: "Unknown action" }, 400);
    } catch (error) {
      console.error("w3m-acquisition-verification failed", error instanceof Error ? error.message : "unknown error");
      return reply(origin, { ok: false, error: "W3M verification request failed" }, 500);
    }
  };
}
