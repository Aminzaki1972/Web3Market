/**
 * Compose a signing challenge only from a binding that matches trusted server-loaded evidence.
 * The caller must authenticate the user, load expectedBinding and terms from trusted storage,
 * validate the verified wallet, and atomically consume the nonce after signature verification.
 */
import {
  buildW3MAgreementTypedData,
  verifyW3MAgreementSignature,
  type W3MAgreementTypedData,
} from "./agreement-signature.ts";
import {
  verifyW3MDealAuditBinding,
  type W3MDealAuditBinding,
  type W3MDealAuditBindingInput,
} from "./deal-audit-binding.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidToBytes32(value: string, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new Error(label + " must be a UUID.");
  }
  // UUIDs contain 128 bits; left-padding preserves the full value without truncation.
  return "0x" + value.replaceAll("-", "").toLowerCase().padStart(64, "0");
}

export type W3MAgreementChallengeRequest = {
  binding: W3MDealAuditBinding;
  expectedBinding: W3MDealAuditBindingInput;
  termsHash: string;
  termsVersion: string;
  partyRole: "buyer" | "seller";
  walletAddress: string;
  nonce: string;
  deadline: number;
};

/**
 * The EIP-712 message explicitly commits to the full deal-audit binding hash,
 * in addition to the audit fingerprint ID/digest and current terms hash/version.
 */
export async function buildW3MAgreementChallenge(
  request: W3MAgreementChallengeRequest,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ bindingHash: string; typedData: W3MAgreementTypedData }> {
  if (!request || typeof request !== "object") {
    throw new Error("Agreement challenge request is required.");
  }
  if (!await verifyW3MDealAuditBinding(request.binding, request.expectedBinding)) {
    throw new Error("Deal-audit binding is invalid or no longer matches trusted evidence.");
  }
  if (!/^[0-9a-f]{64}$/i.test(request.binding.binding_hash)) {
    throw new Error("Deal-audit binding hash is malformed.");
  }
  const bindingHash = "0x" + request.binding.binding_hash.toLowerCase();
  const typedData = buildW3MAgreementTypedData({
    dealId: uuidToBytes32(request.binding.deal_id, "Deal ID"),
    fingerprintId: uuidToBytes32(request.binding.fingerprint_id, "Fingerprint ID"),
    fingerprintDigest: "0x" + request.binding.fingerprint_digest,
    bindingHash,
    termsHash: request.termsHash,
    termsVersion: request.termsVersion,
    partyRole: request.partyRole,
    walletAddress: request.walletAddress,
    nonce: request.nonce,
    deadline: request.deadline,
  }, nowSeconds);
  return { bindingHash, typedData };
}


/**
 * Rebuild the challenge from current trusted evidence, then verify the submitted
 * signature against that exact message. This prevents a caller from verifying
 * against client-supplied typed data or stale deal terms.
 */
export async function verifyW3MAgreementChallengeSignature(
  request: W3MAgreementChallengeRequest,
  signature: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{
  valid: true;
  recoveredAddress: string;
  bindingHash: string;
  typedData: W3MAgreementTypedData;
}> {
  const challenge = await buildW3MAgreementChallenge(request, nowSeconds);
  const message = challenge.typedData.message;
  const verified = verifyW3MAgreementSignature({
    dealId: message.dealId,
    fingerprintId: message.fingerprintId,
    fingerprintDigest: message.fingerprintDigest,
    bindingHash: message.bindingHash,
    termsHash: message.termsHash,
    termsVersion: message.termsVersion,
    partyRole: request.partyRole,
    walletAddress: request.walletAddress,
    nonce: message.nonce,
    deadline: Number(message.deadline),
  }, signature, nowSeconds);
  return {
    valid: true,
    recoveredAddress: verified.recoveredAddress,
    bindingHash: challenge.bindingHash,
    typedData: verified.typedData,
  };
}
