// Browser-side coordinator for the isolated EIP-712 agreement endpoint.
// Dynamically imported by the Deal Room; network and wallet adapters are injected.
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const BYTES32 = /^0x[0-9a-f]{64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE = /^0x[0-9a-f]{130}$/i;
const DOMAIN_FIELDS = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
];
const ACCEPTANCE_FIELDS = [
  { name: "dealId", type: "bytes32" },
  { name: "projectId", type: "bytes32" },
  { name: "buyerId", type: "bytes32" },
  { name: "sellerId", type: "bytes32" },
  { name: "safeAddress", type: "address" },
  { name: "termsHash", type: "bytes32" },
  { name: "termsVersion", type: "uint256" },
  { name: "partyRole", type: "uint8" },
];
function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(label + " response is malformed.");
  return value;
}
function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(label + " is missing.");
  return value;
}
function exactFields(actual, expected, label) {
  if (!Array.isArray(actual) || actual.length !== expected.length ||
      actual.some((field, index) => !field || field.name !== expected[index].name || field.type !== expected[index].type)) {
    throw new Error(label + " does not match the required EIP-712 schema.");
  }
}
function stableCanonicalValue(value) {
  if (Array.isArray(value)) return value.map(stableCanonicalValue);
  if (value !== null && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = stableCanonicalValue(value[key]);
    return result;
  }
  return value;
}
async function canonicalTermsHash(value) {
  const canonical = JSON.stringify(stableCanonicalValue(value));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
async function validatePrepared(value, dealId, walletAddress) {
  const root = record(value, "Agreement preparation");
  if (root.ok !== true) throw new Error("Agreement preparation was rejected.");
  const prepared = record(root.result, "Agreement preparation result");
  const canonicalTerms = record(prepared.canonicalTerms, "Canonical agreement terms");
  const wallet = requiredText(prepared.walletAddress, "Verified party wallet").toLowerCase();
  if (!ADDRESS.test(wallet) || wallet !== walletAddress.toLowerCase()) throw new Error("Connected wallet does not match the currently verified party wallet.");
  if (prepared.dealId !== dealId) throw new Error("Agreement preparation belongs to another deal.");
  if (prepared.partyRole !== "buyer" && prepared.partyRole !== "seller") throw new Error("Agreement party role is invalid.");
  const version = requiredText(prepared.termsVersion, "Terms version");
  if (!/^[1-9][0-9]*$/.test(version)) throw new Error("Terms version is invalid.");
  const preparedTermsHash = requiredText(prepared.termsHash, "Canonical terms hash").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(preparedTermsHash)) throw new Error("Canonical terms hash is invalid.");
  if (await canonicalTermsHash(canonicalTerms) !== preparedTermsHash) throw new Error("Canonical terms content does not match the server-provided SHA-256 hash.");
  const typedData = record(prepared.typedData, "EIP-712 typed data");
  const domain = record(typedData.domain, "EIP-712 domain");
  const message = record(typedData.message, "EIP-712 message");
  const types = record(typedData.types, "EIP-712 types");
  if (typedData.primaryType !== "DealTermsAcceptance" || Number(domain.chainId) !== 56 ||
      domain.name !== "Web3Market Deal Agreement" || domain.version !== "1" ||
      String(message.termsVersion) !== version ||
      Number(message.partyRole) !== (prepared.partyRole === "buyer" ? 1 : 2) ||
      !BYTES32.test(message.dealId) || !BYTES32.test(message.projectId) ||
      !BYTES32.test(message.buyerId) || !BYTES32.test(message.sellerId) ||
      !ADDRESS.test(message.safeAddress) ||
      !BYTES32.test(message.termsHash) ||
      message.termsHash.slice(2).toLowerCase() !== preparedTermsHash) {
    throw new Error("EIP-712 payload is not bound to the expected Web3Market agreement domain, terms, and party.");
  }
  exactFields(types.EIP712Domain, DOMAIN_FIELDS, "EIP-712 domain fields");
  exactFields(types.DealTermsAcceptance, ACCEPTANCE_FIELDS, "DealTermsAcceptance fields");
  return { ...prepared, canonicalTerms, walletAddress: wallet, typedData };
}
export async function signAndSubmitW3MDealAgreement(input) {
  if (!input || !UUID.test(input.dealId)) throw new Error("A valid deal ID is required.");
  if (typeof input.accessToken !== "string" || !input.accessToken.trim()) throw new Error("An authenticated session is required.");
  if (typeof input.walletAddress !== "string" || !ADDRESS.test(input.walletAddress)) throw new Error("A connected EVM wallet is required.");
  if (typeof input.request !== "function" || typeof input.signTypedData !== "function" || typeof input.reviewTerms !== "function") throw new Error("Agreement request, terms review, and wallet signing adapters are required.");
  const prepared = await validatePrepared(await input.request({ mode: "prepare", deal_id: input.dealId }, input.accessToken), input.dealId, input.walletAddress);
  const reviewed = await input.reviewTerms({ dealId: prepared.dealId, partyRole: prepared.partyRole, termsVersion: prepared.termsVersion, termsHash: prepared.termsHash, canonicalTerms: prepared.canonicalTerms });
  if (reviewed !== true) throw new Error("Agreement signing cancelled: exact canonical terms were not explicitly reviewed and accepted.");
  const signature = await input.signTypedData(prepared.walletAddress, prepared.typedData);
  if (typeof signature !== "string" || !SIGNATURE.test(signature)) throw new Error("Wallet returned a malformed EIP-712 signature.");
  const root = record(await input.request({ mode: "accept", deal_id: input.dealId, signature }, input.accessToken), "Agreement acceptance");
  if (root.ok !== true) throw new Error("Agreement acceptance was rejected.");
  const accepted = record(root.result, "Agreement acceptance result");
  if (accepted.dealId !== input.dealId || accepted.partyRole !== prepared.partyRole ||
      String(accepted.termsVersion) !== prepared.termsVersion ||
      typeof accepted.acceptanceId !== "string" || !UUID.test(accepted.acceptanceId) ||
      typeof accepted.idempotentReplay !== "boolean") {
    throw new Error("Accepted agreement does not match the exact signed deal, party, and terms version.");
  }
  return { dealId: input.dealId, partyRole: prepared.partyRole, termsVersion: prepared.termsVersion,
    acceptanceId: accepted.acceptanceId, idempotentReplay: accepted.idempotentReplay };
}
