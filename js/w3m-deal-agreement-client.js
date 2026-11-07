// Browser-side coordinator for the isolated EIP-712 agreement endpoint.
// This module is not imported by the live Deal Room. It accepts injected network
// and wallet adapters so the production page cannot be changed accidentally.
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BYTES32 = /^0x[0-9a-f]{64}$/i;
const SIGNATURE = /^0x[0-9a-f]{130}$/i;
const UINT = /^(0|[1-9][0-9]*)$/;
const ACCEPTANCE_FIELDS = [
  ["dealId", "bytes32"],
  ["fingerprintId", "bytes32"],
  ["fingerprintDigest", "bytes32"],
  ["bindingHash", "bytes32"],
  ["termsHash", "bytes32"],
  ["termsVersion", "uint256"],
  ["partyRole", "uint8"],
  ["wallet", "address"],
  ["nonce", "bytes32"],
  ["deadline", "uint256"],
];

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label + " response is malformed.");
  }
  return value;
}
function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(label + " is missing.");
  return value;
}
function normalizeBytes32(value, label) {
  if (typeof value !== "string") throw new Error(label + " is malformed.");
  const normalized = value.startsWith("0x") ? value : "0x" + value;
  if (!BYTES32.test(normalized)) throw new Error(label + " must be bytes32.");
  return normalized.toLowerCase();
}
function uuidToBytes32(value) {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error("Deal ID is invalid.");
  return "0x" + value.replaceAll("-", "").toLowerCase().padStart(64, "0");
}
function validateTypedData(typedData, dealId, partyRole, walletAddress, fingerprintId, fingerprintDigest, bindingHash, termsHash, termsVersion) {
  const data = record(typedData, "EIP-712 typed data");
  const domain = record(data.domain, "EIP-712 domain");
  const message = record(data.message, "EIP-712 message");
  const domainKeys = Object.keys(domain).sort().join(",");
  if (domainKeys !== "chainId,name,version" ||
      domain.name !== "Web3Market Deal Agreement" ||
      domain.version !== "1" || domain.chainId !== 56) {
    throw new Error("EIP-712 domain is not the fixed Web3Market BNB Chain domain.");
  }
  if (data.primaryType !== "DealTermsAcceptance") {
    throw new Error("EIP-712 primary type is invalid.");
  }
  const types = record(data.types, "EIP-712 types");
  const fields = types.DealTermsAcceptance;
  if (!Array.isArray(fields) || fields.length !== ACCEPTANCE_FIELDS.length ||
      fields.some((field, index) => !field || field.name !== ACCEPTANCE_FIELDS[index][0] ||
        field.type !== ACCEPTANCE_FIELDS[index][1] ||
        Object.keys(field).sort().join(",") !== "name,type")) {
    throw new Error("EIP-712 acceptance field schema is invalid.");
  }
  if (Object.keys(types).some((key) => key !== "DealTermsAcceptance" && key !== "EIP712Domain")) {
    throw new Error("EIP-712 contains an unexpected custom type.");
  }
  const expectedRole = partyRole === "buyer" ? 1 : 2;
  if (message.dealId !== uuidToBytes32(dealId) ||
      normalizeBytes32(message.fingerprintId, "Signed fingerprint ID") !== fingerprintId ||
      normalizeBytes32(message.fingerprintDigest, "Signed fingerprint digest") !== fingerprintDigest ||
      normalizeBytes32(message.bindingHash, "Signed binding hash") !== bindingHash ||
      normalizeBytes32(message.termsHash, "Signed terms hash") !== termsHash ||
      String(message.termsVersion) !== termsVersion ||
      message.partyRole !== expectedRole ||
      typeof message.wallet !== "string" ||
      message.wallet.toLowerCase() !== walletAddress.toLowerCase() ||
      !BYTES32.test(message.nonce) ||
      typeof message.deadline !== "string" || !UINT.test(message.deadline) ||
      !Number.isSafeInteger(Number(message.deadline)) || Number(message.deadline) <= 0) {
    throw new Error("EIP-712 message is not fully bound to the expected deal, evidence, terms, role, wallet, nonce, and deadline.");
  }
  return data;
}
function validatePrepared(value, dealId, walletAddress) {
  const result = record(value, "Agreement preparation");
  if (result.ok !== true) throw new Error("Agreement preparation was rejected.");
  const prepared = record(result.result, "Agreement preparation result");
  const wallet = requiredText(prepared.walletAddress, "Verified party wallet").toLowerCase();
  if (!ADDRESS.test(wallet) || wallet !== walletAddress.toLowerCase()) {
    throw new Error("Connected wallet does not match the currently verified party wallet.");
  }
  if (prepared.dealId !== dealId) throw new Error("Agreement preparation belongs to another deal.");
  if (prepared.partyRole !== "buyer" && prepared.partyRole !== "seller") {
    throw new Error("Agreement party role is invalid.");
  }
  const challengeId = requiredText(prepared.challengeId, "Persisted agreement challenge ID");
  if (!UUID.test(challengeId)) throw new Error("Persisted agreement challenge ID is invalid.");
  const version = requiredText(prepared.termsVersion, "Terms version");
  if (!/^[1-9][0-9]*$/.test(version)) throw new Error("Terms version is invalid.");
  if (typeof prepared.fingerprintId !== "string" || !UUID.test(prepared.fingerprintId)) {
    throw new Error("Prepared fingerprint ID is invalid.");
  }
  const fingerprintId = uuidToBytes32(prepared.fingerprintId);
  const fingerprintDigest = normalizeBytes32(prepared.fingerprintDigest, "Prepared fingerprint digest");
  const bindingHash = normalizeBytes32(prepared.bindingHash, "Prepared binding hash");
  const termsHash = normalizeBytes32(prepared.termsHash, "Prepared terms hash");
  const typedData = validateTypedData(
    prepared.typedData, dealId, prepared.partyRole, wallet, fingerprintId, fingerprintDigest, bindingHash, termsHash, version,
  );
  return { ...prepared, challengeId, walletAddress: wallet, typedData };
}

/**
 * @param {{
 *   dealId: string,
 *   accessToken: string,
 *   walletAddress: string,
 *   request: (body: object, accessToken: string) => Promise<unknown>,
 *   signTypedData: (walletAddress: string, typedData: object) => Promise<string>,
 * }} input
 */
export async function signAndSubmitW3MDealAgreement(input) {
  if (!input || !UUID.test(input.dealId)) throw new Error("A valid deal ID is required.");
  if (typeof input.accessToken !== "string" || !input.accessToken.trim()) {
    throw new Error("An authenticated session is required.");
  }
  if (typeof input.walletAddress !== "string" || !ADDRESS.test(input.walletAddress)) {
    throw new Error("A connected EVM wallet is required.");
  }
  if (typeof input.request !== "function" || typeof input.signTypedData !== "function") {
    throw new Error("Agreement request and wallet signing adapters are required.");
  }
  const preparedResponse = await input.request({ action: "prepare", deal_id: input.dealId, wallet_address: input.walletAddress }, input.accessToken);
  const prepared = validatePrepared(preparedResponse, input.dealId, input.walletAddress);
  const signature = await input.signTypedData(prepared.walletAddress, prepared.typedData);
  if (typeof signature !== "string" || !SIGNATURE.test(signature)) {
    throw new Error("Wallet returned a malformed EIP-712 signature.");
  }
  const acceptedResponse = record(await input.request({
    action: "accept", deal_id: input.dealId, challenge_id: prepared.challengeId, signature,
  }, input.accessToken), "Agreement acceptance");
  if (acceptedResponse.ok !== true) throw new Error("Agreement acceptance was rejected.");
  const accepted = record(acceptedResponse.result, "Agreement acceptance result");
  if (accepted.dealId !== input.dealId ||
      accepted.partyRole !== prepared.partyRole ||
      String(accepted.termsVersion) !== prepared.termsVersion ||
      typeof accepted.acceptanceId !== "string" ||
      typeof accepted.idempotentReplay !== "boolean") {
    throw new Error("Accepted agreement does not match the exact signed deal, party, and terms version.");
  }
  return {
    dealId: input.dealId,
    partyRole: prepared.partyRole,
    termsVersion: prepared.termsVersion,
    acceptanceId: accepted.acceptanceId,
    idempotentReplay: accepted.idempotentReplay,
  };
}
