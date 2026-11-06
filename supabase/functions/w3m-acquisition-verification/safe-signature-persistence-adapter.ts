// W3M Protocol V1 — atomic service-role persistence for a verified Safe signature.
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";
import type { W3MPhaseAuthorization } from "./safe-edge-w3m-phase-boundary.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const SIGNATURE = /^0x[0-9a-f]{130}$/i;

export interface AtomicSafeSignInput {
  actorId: string;
  dealId: string;
  safeTransactionHash: string;
  signature: string;
  verifiedWallet: string;
  signerRole: "buyer" | "seller";
  authorization: W3MPhaseAuthorization;
}
export interface AtomicSafeSignResult {
  recorded: boolean;
  idempotentReplay: boolean;
  confirmationsCount: number;
  requiredSignatures: 2;
  status: "awaiting_signatures" | "signed";
}

export async function persistSafeReleaseSignatureAtomically(
  client: W3MRpcClient,
  input: AtomicSafeSignInput,
): Promise<AtomicSafeSignResult> {
  if (!UUID.test(input.actorId) || !UUID.test(input.dealId) ||
      !HASH.test(input.safeTransactionHash) || !SIGNATURE.test(input.signature) ||
      !ADDRESS.test(input.verifiedWallet) ||
      (input.signerRole !== "buyer" && input.signerRole !== "seller")) {
    throw new Error("W3M atomic SIGN input is malformed.");
  }
  const auth = input.authorization;
  if (!auth || auth.authorized !== true || auth.phase !== "SIGN" ||
      auth.dealId !== input.dealId ||
      auth.safeTransactionHash?.toLowerCase() !== input.safeTransactionHash.toLowerCase() ||
      !Array.isArray(auth.issues) || auth.issues.length !== 0 ||
      typeof auth.reportId !== "string" || !UUID.test(auth.reportId) ||
      !Number.isInteger(auth.reportVersion) || Number(auth.reportVersion) < 1) {
    throw new Error("A fresh, exact W3M PASS authorization is required before SIGN persistence.");
  }
  const { data, error } = await client.rpc("w3m_record_safe_release_signature", {
    p_deal_id: input.dealId,
    p_actor_id: input.actorId,
    p_safe_tx_hash: input.safeTransactionHash.toLowerCase(),
    p_signature: input.signature.toLowerCase(),
    p_verified_wallet: input.verifiedWallet.toLowerCase(),
    p_signer_role: input.signerRole,
    p_w3m_authorization: {
      authorized: true,
      phase: "SIGN",
      deal_id: input.dealId,
      safe_tx_hash: input.safeTransactionHash.toLowerCase(),
      issues: [],
      report_id: auth.reportId,
      report_version: auth.reportVersion,
    },
  });
  if (error) throw new Error("W3M atomic Safe SIGN RPC failed.");
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("W3M atomic Safe SIGN RPC returned a malformed response.");
  }
  const result = data as Record<string, unknown>;
  if (result.recorded !== true || typeof result.idempotent_replay !== "boolean" ||
      !Number.isInteger(result.confirmations_count) ||
      Number(result.confirmations_count) < 1 || Number(result.confirmations_count) > 2 ||
      result.required_signatures !== 2 ||
      (result.status !== "awaiting_signatures" && result.status !== "signed")) {
    throw new Error("W3M atomic Safe SIGN RPC response failed strict validation.");
  }
  return {
    recorded: true,
    idempotentReplay: result.idempotent_replay,
    confirmationsCount: Number(result.confirmations_count),
    requiredSignatures: 2,
    status: result.status,
  };
}
