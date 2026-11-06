// Browser-side coordinator for the isolated EIP-712 agreement endpoint.
// This module is not imported by the live Deal Room. It accepts injected network
// and wallet adapters so the production page cannot be changed accidentally.
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE = /^0x[0-9a-f]{130}$/i;

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
  const version = requiredText(prepared.termsVersion, "Terms version");
  if (!/^[1-9][0-9]*$/.test(version)) throw new Error("Terms version is invalid.");
  const typedData = record(prepared.typedData, "EIP-712 typed data");
  const domain = record(typedData.domain, "EIP-712 domain");
  const message = record(typedData.message, "EIP-712 message");
  if (typedData.primaryType !== "DealTermsAcceptance" ||
      Number(domain.chainId) !== 56 ||
      domain.name !== "Web3Market Deal Agreement" ||
      domain.version !== "1" ||
      String(message.termsVersion) !== version ||
      Number(message.partyRole) !== (prepared.partyRole === "buyer" ? 1 : 2) ||
      typeof message.dealId !== "string" || !/^0x[0-9a-f]{64}$/i.test(message.dealId) ||
      typeof message.termsHash !== "string" || !/^0x[0-9a-f]{64}$/i.test(message.termsHash)) {
    throw new Error("EIP-712 payload is not bound to the expected Web3Market agreement domain and party.");
  }
  return { ...prepared, walletAddress: wallet, typedData };
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
  const preparedResponse = await input.request({ mode: "prepare", deal_id: input.dealId }, input.accessToken);
  const prepared = validatePrepared(preparedResponse, input.dealId, input.walletAddress);
  const signature = await input.signTypedData(prepared.walletAddress, prepared.typedData);
  if (typeof signature !== "string" || !SIGNATURE.test(signature)) {
    throw new Error("Wallet returned a malformed EIP-712 signature.");
  }
  const acceptedResponse = record(await input.request({
    mode: "accept", deal_id: input.dealId, signature,
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
