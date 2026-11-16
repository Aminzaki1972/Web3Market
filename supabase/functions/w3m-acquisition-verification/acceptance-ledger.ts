/**
 * Pure policy helpers for the W3M append-only agreement acceptance ledger.
 *
 * IMPORTANT: These helpers do NOT provide concurrency safety. Production persistence
 * must insert the nonce and acceptance row in one database transaction protected by
 * unique constraints (at minimum nonce, and deal_id + party_role). A read-then-write
 * check in an Edge Function is not replay protection.
 *
 * The caller must pass only server-derived identity/deal/wallet values and call the
 * candidate builder only after verifyW3MAgreementChallengeSignature succeeds.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH32 = /^0x[0-9a-f]{64}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const SIGNATURE = /^0x[0-9a-f]{130}$/i;
const MAX_UINT256 = (1n << 256n) - 1n;

export type W3MAgreementPartyRole = "buyer" | "seller";

export type W3MAcceptanceCandidateInput = {
  dealId: string;
  projectId: string;
  auditId: string;
  fingerprintId: string;
  fingerprintDigest: string;
  bindingHash: string;
  termsHash: string;
  termsVersion: string;
  partyRole: W3MAgreementPartyRole;
  authenticatedUserId: string;
  buyerUserId: string;
  sellerUserId: string;
  verifiedWalletAddress: string;
  recoveredSignerAddress: string;
  signature: string;
  nonce: string;
  deadline: number;
  acceptedAt: string;
};

export type W3MAcceptanceRecord = Readonly<{
  deal_id: string;
  project_id: string;
  audit_id: string;
  fingerprint_id: string;
  fingerprint_digest: string;
  binding_hash: string;
  terms_hash: string;
  terms_version: string;
  party_role: W3MAgreementPartyRole;
  user_id: string;
  wallet_address: string;
  signature: string;
  nonce: string;
  signature_deadline: number;
  accepted_at: string;
}>;

export type W3MAcceptanceLedgerRow = Pick<
  W3MAcceptanceRecord,
  "deal_id" | "party_role" | "nonce" | "terms_hash" | "terms_version"
>;

function requireTermsVersion(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value) ||
    BigInt(value) > MAX_UINT256) {
    throw new Error(label + " must be a positive uint256 decimal integer.");
  }
  return value;
}

function validateAcceptanceRecord(row: W3MAcceptanceRecord): void {
  if (!row || typeof row !== "object") {
    throw new Error("A persisted acceptance record is malformed.");
  }
  requireUuid(row.deal_id, "Persisted deal ID");
  requireUuid(row.project_id, "Persisted project ID");
  requireUuid(row.audit_id, "Persisted audit ID");
  requireUuid(row.fingerprint_id, "Persisted fingerprint ID");
  requireUuid(row.user_id, "Persisted accepting user ID");
  requireDigest(row.fingerprint_digest, "Persisted fingerprint digest");
  requireHash(row.binding_hash, "Persisted binding hash");
  requireHash(row.terms_hash, "Persisted terms hash");
  requireHash(row.nonce, "Persisted acceptance nonce");
  requireAddress(row.wallet_address, "Persisted signer wallet");
  if (row.party_role !== "buyer" && row.party_role !== "seller") {
    throw new Error("Persisted acceptance party role is invalid.");
  }
  requireTermsVersion(row.terms_version, "Persisted acceptance terms version");
  if (typeof row.signature !== "string" || !SIGNATURE.test(row.signature)) {
    throw new Error("Persisted acceptance signature is malformed.");
  }
  if (!Number.isSafeInteger(row.signature_deadline) || row.signature_deadline < 1) {
    throw new Error("Persisted signature deadline is invalid.");
  }
  if (typeof row.accepted_at !== "string") {
    throw new Error("Persisted acceptance timestamp must be a canonical ISO-8601 UTC string.");
  }
  const acceptedAtMs = Date.parse(row.accepted_at);
  if (!Number.isFinite(acceptedAtMs) || new Date(acceptedAtMs).toISOString() !== row.accepted_at ||
    acceptedAtMs > row.signature_deadline * 1000 ||
    row.signature_deadline - Math.floor(acceptedAtMs / 1000) > 15 * 60) {
    throw new Error("Persisted acceptance timestamp or signature lifetime is invalid.");
  }
}

function requireUuid(value: string, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new Error(label + " must be a UUID.");
  }
  return value.toLowerCase();
}

function requireHash(value: string, label: string): string {
  if (typeof value !== "string" || !HASH32.test(value)) {
    throw new Error(label + " must be bytes32.");
  }
  return value.toLowerCase();
}

function requireAddress(value: string, label: string): string {
  if (typeof value !== "string" || !ADDRESS.test(value)) {
    throw new Error(label + " must be an EVM wallet address.");
  }
  return value.toLowerCase();
}

function requireDigest(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(label + " must be a SHA-256 hex digest.");
  }
  const normalized = value.replace(/^0x/i, "");
  if (!/^[0-9a-f]{64}$/i.test(normalized)) {
    throw new Error(label + " must be a SHA-256 hex digest.");
  }
  return "0x" + normalized.toLowerCase();
}

function validateLedgerRow(row: W3MAcceptanceLedgerRow): void {
  if (!row || typeof row !== "object") {
    throw new Error("An existing acceptance ledger row is malformed.");
  }
  requireUuid(row.deal_id, "Existing deal ID");
  requireHash(row.nonce, "Existing acceptance nonce");
  requireHash(row.terms_hash, "Existing terms hash");
  if (row.party_role !== "buyer" && row.party_role !== "seller") {
    throw new Error("Existing acceptance party role is invalid.");
  }
  requireTermsVersion(row.terms_version, "Existing acceptance terms version");
}

/**
 * Creates a canonical acceptance row after the caller has verified the EIP-712
 * signature against freshly loaded trusted deal, binding, terms, nonce and wallet.
 * Identity fields must come from the authenticated session and trusted deal row.
 */
export function buildW3MAcceptanceRecord(
  input: W3MAcceptanceCandidateInput,
  nowSeconds = Math.floor(Date.now() / 1000),
): W3MAcceptanceRecord {
  if (!input || typeof input !== "object") {
    throw new Error("Acceptance candidate is required.");
  }
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw new Error("Current acceptance time must be a non-negative safe integer.");
  }

  const dealId = requireUuid(input.dealId, "Deal ID");
  const projectId = requireUuid(input.projectId, "Project ID");
  const auditId = requireUuid(input.auditId, "Audit ID");
  const fingerprintId = requireUuid(input.fingerprintId, "Fingerprint ID");
  const userId = requireUuid(input.authenticatedUserId, "Authenticated user ID");
  const buyerUserId = requireUuid(input.buyerUserId, "Buyer user ID");
  const sellerUserId = requireUuid(input.sellerUserId, "Seller user ID");

  if (buyerUserId === sellerUserId) {
    throw new Error("Buyer and seller must be different users.");
  }
  if (input.partyRole !== "buyer" && input.partyRole !== "seller") {
    throw new Error("Party role must be buyer or seller.");
  }
  const expectedUserId = input.partyRole === "buyer" ? buyerUserId : sellerUserId;
  if (userId !== expectedUserId) {
    throw new Error("Authenticated user is not authorized for this deal party role.");
  }

  const verifiedWallet = requireAddress(input.verifiedWalletAddress, "Verified wallet");
  const recoveredSigner = requireAddress(input.recoveredSignerAddress, "Recovered signer");
  if (typeof input.signature !== "string" || !SIGNATURE.test(input.signature)) {
    throw new Error("Verified EIP-712 signature must be a 65-byte hexadecimal value.");
  }
  if (verifiedWallet !== recoveredSigner) {
    throw new Error("Recovered signer does not match the authenticated user's verified wallet.");
  }

  if (!Number.isSafeInteger(input.deadline) || input.deadline <= nowSeconds ||
    input.deadline > nowSeconds + 15 * 60) {
    throw new Error("Acceptance signature deadline is expired, invalid, or exceeds 15 minutes.");
  }
  const acceptedAtMs = Date.parse(input.acceptedAt);
  if (!Number.isFinite(acceptedAtMs) || new Date(acceptedAtMs).toISOString() !== input.acceptedAt) {
    throw new Error("Acceptance timestamp must be a canonical ISO-8601 UTC timestamp.");
  }
  if (acceptedAtMs > nowSeconds * 1000 + 30_000) {
    throw new Error("Acceptance timestamp is too far in the future.");
  }
  if (acceptedAtMs > input.deadline * 1000) {
    throw new Error("Acceptance timestamp must not be later than the signature deadline.");
  }

  const termsVersion = requireTermsVersion(input.termsVersion, "Terms version");

  return Object.freeze({
    deal_id: dealId,
    project_id: projectId,
    audit_id: auditId,
    fingerprint_id: fingerprintId,
    fingerprint_digest: requireDigest(input.fingerprintDigest, "Fingerprint digest"),
    binding_hash: requireHash(input.bindingHash, "Binding hash"),
    terms_hash: requireHash(input.termsHash, "Terms hash"),
    terms_version: termsVersion,
    party_role: input.partyRole,
    user_id: userId,
    wallet_address: verifiedWallet,
    signature: input.signature.toLowerCase(),
    nonce: requireHash(input.nonce, "Acceptance nonce"),
    signature_deadline: input.deadline,
    accepted_at: input.acceptedAt,
  });
}

export type W3MAcceptanceLedgerDecision =
  | { allowed: true; reason: "new_party_acceptance" }
  | { allowed: false; reason: "nonce_already_used" | "party_role_already_accepted" | "terms_version_conflict" };

/**
 * Advisory preflight only. Never use this read-only decision as the concurrency
 * boundary; enforce the same uniqueness rules in the database transaction.
 */
export function evaluateW3MAcceptanceLedger(
  candidate: W3MAcceptanceRecord,
  existingRows: readonly W3MAcceptanceLedgerRow[],
): W3MAcceptanceLedgerDecision {
  if (!Array.isArray(existingRows)) {
    throw new Error("Existing acceptance ledger rows are required.");
  }
  for (const row of existingRows) validateLedgerRow(row);
  if (existingRows.some((row) => row.nonce.toLowerCase() === candidate.nonce)) {
    return { allowed: false, reason: "nonce_already_used" };
  }
  const sameDealVersion = existingRows.filter((row) =>
    row.deal_id.toLowerCase() === candidate.deal_id &&
    row.terms_version === candidate.terms_version
  );
  if (sameDealVersion.some((row) => row.terms_hash.toLowerCase() !== candidate.terms_hash)) {
    return { allowed: false, reason: "terms_version_conflict" };
  }
  if (sameDealVersion.some((row) => row.party_role === candidate.party_role)) {
    return { allowed: false, reason: "party_role_already_accepted" };
  }
  return { allowed: true, reason: "new_party_acceptance" };
}

/**
 * @deprecated Advisory/legacy helper only. It does not validate the complete evidence
 * tuple or exact row count and MUST NOT gate settlement or finalization. Use
 * hasCompleteW3MAcceptancePair after reloading and cryptographically re-verifying
 * persisted signatures in the trusted server transaction.
 */
export function hasBothW3MPartyAcceptances(
  rows: readonly W3MAcceptanceRecord[],
  expected: { dealId: string; termsHash: string; bindingHash: string },
): boolean {
  const dealId = requireUuid(expected.dealId, "Expected deal ID");
  const termsHash = requireHash(expected.termsHash, "Expected terms hash");
  const bindingHash = requireHash(expected.bindingHash, "Expected binding hash");
  const matching = rows.filter((row) =>
    row.deal_id === dealId &&
    row.terms_hash === termsHash &&
    row.binding_hash === bindingHash
  );
  return matching.some((row) => row.party_role === "buyer") &&
    matching.some((row) => row.party_role === "seller") &&
    matching.find((row) => row.party_role === "buyer")!.user_id !==
      matching.find((row) => row.party_role === "seller")!.user_id;
}


export type W3MCompleteAcceptanceExpectation = {
  dealId: string;
  projectId: string;
  auditId: string;
  fingerprintId: string;
  fingerprintDigest: string;
  bindingHash: string;
  termsHash: string;
  termsVersion: string;
};

/**
 * Strict finalization predicate. It requires exactly two persisted rows for the
 * deal (one buyer and one seller) and an exact match of every evidence/terms
 * identifier. This is a pure consistency check, not signature verification,
 * persistence, or a substitute for transaction-level database constraints.
 */
export function hasCompleteW3MAcceptancePair(
  rows: readonly W3MAcceptanceRecord[],
  expected: W3MCompleteAcceptanceExpectation,
): boolean {
  if (!Array.isArray(rows)) {
    throw new Error("Persisted acceptance rows are required.");
  }
  for (const row of rows) validateAcceptanceRecord(row);
  const dealId = requireUuid(expected.dealId, "Expected deal ID");
  const projectId = requireUuid(expected.projectId, "Expected project ID");
  const auditId = requireUuid(expected.auditId, "Expected audit ID");
  const fingerprintId = requireUuid(expected.fingerprintId, "Expected fingerprint ID");
  const fingerprintDigest = requireDigest(expected.fingerprintDigest, "Expected fingerprint digest");
  const bindingHash = requireHash(expected.bindingHash, "Expected binding hash");
  const termsHash = requireHash(expected.termsHash, "Expected terms hash");
  const expectedTermsVersion = requireTermsVersion(expected.termsVersion, "Expected terms version");

  // Keep immutable acceptances for prior terms versions as historical evidence.
  // Only the exact expected version participates in the current acceptance pair.
  const dealRows = rows.filter((row) =>
    row.deal_id === dealId && row.terms_version === expectedTermsVersion
  );
  if (dealRows.length !== 2) return false;
  const buyerRows = dealRows.filter((row) => row.party_role === "buyer");
  const sellerRows = dealRows.filter((row) => row.party_role === "seller");
  if (buyerRows.length !== 1 || sellerRows.length !== 1) return false;

  const [buyer] = buyerRows;
  const [seller] = sellerRows;
  const matchesExpected = (row: W3MAcceptanceRecord) =>
    row.project_id === projectId &&
    row.audit_id === auditId &&
    row.fingerprint_id === fingerprintId &&
    row.fingerprint_digest === fingerprintDigest &&
    row.binding_hash === bindingHash &&
    row.terms_hash === termsHash &&
    row.terms_version === expectedTermsVersion;
  return matchesExpected(buyer) &&
    matchesExpected(seller) &&
    buyer.user_id !== seller.user_id &&
    buyer.nonce !== seller.nonce;
}
