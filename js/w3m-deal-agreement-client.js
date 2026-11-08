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
 * Read-only status adapter. The server authorizes the deal participant and
 * deliberately returns no signature, nonce, or challenge material.
 * @param {{dealId:string, accessToken:string, request:(body:object, accessToken:string)=>Promise<unknown>}} input
 */
export async function getW3MDealAgreementStatus(input) {
  if (!input || !UUID.test(input.dealId)) throw new Error("A valid deal ID is required.");
  if (typeof input.accessToken !== "string" || !input.accessToken.trim()) {
    throw new Error("An authenticated session is required.");
  }
  if (typeof input.request !== "function") throw new Error("Agreement request adapter is required.");
  const response = record(await input.request({
    action: "status", deal_id: input.dealId,
  }, input.accessToken), "Agreement status");
  if (response.ok !== true) throw new Error("Agreement status was rejected.");
  const result = record(response.result, "Agreement status result");
  if (result.deal_id !== input.dealId) throw new Error("Agreement status belongs to another deal.");
  if (typeof result.both_accepted !== "boolean" || typeof result.deal_eligible !== "boolean") {
    throw new Error("Agreement status flags are malformed.");
  }
  const acceptances = record(result.acceptances, "Agreement acceptance states");
  for (const role of ["buyer", "seller"]) {
    const party = record(acceptances[role], role + " acceptance state");
    if (typeof party.accepted !== "boolean" ||
        (party.accepted && typeof party.accepted_at !== "string") ||
        (party.stale !== undefined && typeof party.stale !== "boolean")) {
      throw new Error("Agreement acceptance state is malformed.");
    }
  }
  let currentTerms = null;
  if (result.current_terms !== null) {
    currentTerms = record(result.current_terms, "Current acquisition terms");
    if (typeof currentTerms.terms_version !== "string" ||
        !/^[1-9][0-9]*$/.test(currentTerms.terms_version) ||
        typeof currentTerms.terms_hash !== "string" ||
        !/^[0-9a-f]{64}$/i.test(currentTerms.terms_hash) ||
        !currentTerms.canonical_terms || typeof currentTerms.canonical_terms !== "object" ||
        Array.isArray(currentTerms.canonical_terms)) {
      throw new Error("Current acquisition terms are malformed.");
    }
  }
  return {
    dealId: input.dealId,
    currentTerms,
    acceptances: {
      buyer: { ...acceptances.buyer },
      seller: { ...acceptances.seller },
    },
    assets: (() => {
      if (!Array.isArray(result.assets)) throw new Error("Deal asset status is malformed.");
      return result.assets.map((raw) => {
        const asset = record(raw, "Deal asset");
        if (typeof asset.asset_id !== "string" || typeof asset.asset_name !== "string" ||
            typeof asset.status !== "string" || !Array.isArray(asset.events)) {
          throw new Error("Deal asset status is malformed.");
        }
        return {
          assetId: asset.asset_id,
          assetName: asset.asset_name,
          status: asset.status,
          deliveryUrl: typeof asset.delivery_url === "string" ? asset.delivery_url : null,
          deliveredAt: typeof asset.delivered_at === "string" ? asset.delivered_at : null,
          acceptedAt: typeof asset.accepted_at === "string" ? asset.accepted_at : null,
          events: asset.events.map((entry) => {
            const event = record(entry, "Deal asset event");
            if (typeof event.event_type !== "string" ||
                typeof event.attempt_number !== "number" ||
                typeof event.evidence_digest !== "string" ||
                !/^[0-9a-f]{64}$/i.test(event.evidence_digest) ||
                typeof event.occurred_at !== "string") {
              throw new Error("Deal asset event is malformed.");
            }
            return {
              eventType: event.event_type,
              attemptNumber: event.attempt_number,
              evidenceDigest: event.evidence_digest,
              occurredAt: event.occurred_at,
            };
          }),
        };
      });
    })(),
    bothAccepted: result.both_accepted,
    dealEligible: result.deal_eligible,
  };
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
