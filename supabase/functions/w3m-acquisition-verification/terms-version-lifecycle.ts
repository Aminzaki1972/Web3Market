/**
 * Pure lifecycle guards for immutable W3M acquisition-terms versions.
 *
 * This module is not a database store. The server must load history from a
 * trusted append-only store while holding the deal lock, then persist the
 * candidate atomically with the same transaction that handles acceptances.
 */
export interface W3MTermsVersionRecord {
  deal_id: string;
  terms_version: number;
  terms_hash: string;
  canonical_terms_json: string;
  status: "published" | "superseded";
  published_at: string;
}

export interface W3MTermsVersionAppendPlan {
  supersede_versions: number[];
  publish: W3MTermsVersionRecord;
}

export interface W3MAcceptanceVersionReference {
  deal_id: string;
  terms_version: number;
  terms_hash: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;

function fail(message: string): never {
  throw new Error(message);
}

function assertContiguousVersions(versions: Set<number>, maxVersion: number): void {
  for (let version = 1; version <= maxVersion; version++) {
    if (!versions.has(version)) {
      fail("Terms history contains a missing immutable version: " + version + ".");
    }
  }
}

function validateVersion(record: W3MTermsVersionRecord): void {
  if (!record || typeof record !== "object" ||
    typeof record.deal_id !== "string" || !UUID.test(record.deal_id)) {
    fail("deal_id must be a UUID.");
  }
  if (!Number.isSafeInteger(record.terms_version) || record.terms_version < 1) {
    fail("terms_version must be a positive safe integer.");
  }
  if (typeof record.terms_hash !== "string" || !SHA256.test(record.terms_hash)) {
    fail("terms_hash must be a SHA-256 hex digest.");
  }
  if (typeof record.canonical_terms_json !== "string" || record.canonical_terms_json.length === 0) {
    fail("canonical_terms_json is required.");
  }
  if (record.status !== "published" && record.status !== "superseded") {
    fail("Terms version status is invalid.");
  }
  if (typeof record.published_at !== "string") {
    fail("published_at must be a canonical ISO-8601 UTC timestamp.");
  }
  const publishedAtMs = Date.parse(record.published_at);
  if (!Number.isFinite(publishedAtMs) ||
    new Date(publishedAtMs).toISOString() !== record.published_at) {
    fail("published_at must be a canonical ISO-8601 UTC timestamp.");
  }
}

/**
 * Validate a candidate append before writing it. Existing records are treated
 * as immutable history; only the next sequential version may be published.
 */
export function assertCanAppendW3MTermsVersion(
  history: readonly W3MTermsVersionRecord[],
  candidate: W3MTermsVersionRecord,
): void {
  validateVersion(candidate);
  const seenVersions = new Set<number>();
  const seenHashes = new Set<string>();
  let maxVersion = 0;

  for (const record of history) {
    validateVersion(record);
    if (record.deal_id.toLowerCase() !== candidate.deal_id.toLowerCase()) {
      fail("Terms history cannot mix different deals.");
    }
    if (seenVersions.has(record.terms_version)) fail("Terms history contains a duplicate version.");
    const normalizedHash = record.terms_hash.toLowerCase();
    if (seenHashes.has(normalizedHash)) fail("Terms history contains a duplicate terms hash.");
    seenVersions.add(record.terms_version);
    seenHashes.add(normalizedHash);
    maxVersion = Math.max(maxVersion, record.terms_version);
  }

  assertContiguousVersions(seenVersions, maxVersion);
  if (candidate.terms_version !== maxVersion + 1) {
    fail("A published terms version must be the next sequential version.");
  }
  if (seenHashes.has(candidate.terms_hash.toLowerCase())) {
    fail("A new version must have a new terms hash.");
  }
  if (candidate.status !== "published") {
    fail("A new terms version must enter the store as published.");
  }
  if (history.some((record) => record.status === "published")) {
    // The transaction must supersede the former current row atomically.
    // This guard requires the caller to stage history with only superseded rows.
    fail("The previous published version must be superseded in the same transaction before append.");
  }
}

/** Old acceptances never count for a newly published version or changed hash. */
export function isW3MAcceptanceCurrentForTerms(
  acceptance: W3MAcceptanceVersionReference,
  current: W3MTermsVersionRecord,
): boolean {
  validateVersion(current);
  return current.status === "published" &&
    acceptance.deal_id.toLowerCase() === current.deal_id.toLowerCase() &&
    acceptance.terms_version === current.terms_version &&
    acceptance.terms_hash.toLowerCase() === current.terms_hash.toLowerCase();
}

/** Returns only references that still match the current immutable version. */
export function filterCurrentW3MAcceptances<T extends W3MAcceptanceVersionReference>(
  acceptances: readonly T[],
  current: W3MTermsVersionRecord,
): T[] {
  return acceptances.filter((acceptance) => isW3MAcceptanceCurrentForTerms(acceptance, current));
}

/**
 * Build the complete state transition that a single database transaction must
 * apply: supersede the sole current version (if any), then publish the next.
 * The returned plan is advisory until persisted under a deal-row lock.
 */
export function buildW3MTermsVersionAppendPlan(
  history: readonly W3MTermsVersionRecord[],
  candidate: W3MTermsVersionRecord,
): W3MTermsVersionAppendPlan {
  validateVersion(candidate);
  const versions = new Set<number>();
  const hashes = new Set<string>();
  const current: W3MTermsVersionRecord[] = [];
  let maxVersion = 0;
  for (const record of history) {
    validateVersion(record);
    if (record.deal_id.toLowerCase() !== candidate.deal_id.toLowerCase()) {
      fail("Terms history cannot mix different deals.");
    }
    if (versions.has(record.terms_version)) fail("Terms history contains a duplicate version.");
    if (hashes.has(record.terms_hash.toLowerCase())) fail("Terms history contains a duplicate terms hash.");
    versions.add(record.terms_version);
    hashes.add(record.terms_hash.toLowerCase());
    maxVersion = Math.max(maxVersion, record.terms_version);
    if (record.status === "published") current.push(record);
  }
  assertContiguousVersions(versions, maxVersion);
  if (current.length > 1) fail("Terms history has more than one published version.");
  if (candidate.terms_version !== maxVersion + 1) fail("A published terms version must be the next sequential version.");
  if (hashes.has(candidate.terms_hash.toLowerCase())) fail("A new version must have a new terms hash.");
  if (candidate.status !== "published") fail("A new terms version must enter the store as published.");
  return { supersede_versions: current.map((record) => record.terms_version), publish: candidate };
}

/** Verify that the stored canonical document matches its domain-separated digest. */
export async function verifyW3MTermsVersionDigest(record: W3MTermsVersionRecord): Promise<boolean> {
  validateVersion(record);
  let parsed: unknown;
  try { parsed = JSON.parse(record.canonical_terms_json); } catch { return false; }
  if (JSON.stringify(parsed) !== record.canonical_terms_json) return false;
  const bytes = new TextEncoder().encode("w3m-acquisition-terms:v1\n" + record.canonical_terms_json);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return actual === record.terms_hash.toLowerCase();
}
