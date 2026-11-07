/**
 * Immutable, pure binding between one W3M deal and one persisted audit fingerprint.
 *
 * This module deliberately does not load rows, authorize participants, or persist state.
 * The server integration must enforce the same uniqueness rules transactionally.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMIT = /^[0-9a-f]{40}$/i;
const DIGEST = /^[0-9a-f]{64}$/i;
const REPOSITORY = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\/[a-z0-9_.-]+$/i;
const DOMAIN = "w3m-deal-audit-binding:v1\n";

export type W3MDealAuditBindingInput = {
  dealId: string;
  projectId: string;
  auditId: string;
  fingerprintId: string;
  fingerprintDigest: string;
  repository: string;
  commitSha: string;
};

export type W3MDealAuditBinding = {
  schema: "w3m-deal-audit-binding-v1";
  deal_id: string;
  project_id: string;
  audit_id: string;
  fingerprint_id: string;
  fingerprint_digest: string;
  repository: string;
  commit_sha: string;
  binding_hash: string;
};

function requireUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new Error(label + " must be a UUID.");
  }
  return value.toLowerCase();
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(label + " is required.");
  }
  return value;
}

function normalizeInput(input: W3MDealAuditBindingInput): Omit<W3MDealAuditBinding, "schema" | "binding_hash"> {
  if (!input || typeof input !== "object") throw new Error("A deal-audit binding input is required.");
  const repository = requireString(input.repository, "Repository");
  if (!REPOSITORY.test(repository)) throw new Error("Repository must use owner/repository identity.");
  if (typeof input.commitSha !== "string" || !COMMIT.test(input.commitSha)) {
    throw new Error("A full 40-character audited commit SHA is required.");
  }
  if (typeof input.fingerprintDigest !== "string" || !DIGEST.test(input.fingerprintDigest)) {
    throw new Error("Fingerprint digest must be a 32-byte SHA-256 hex value.");
  }
  return {
    deal_id: requireUuid(input.dealId, "Deal ID"),
    project_id: requireUuid(input.projectId, "Project ID"),
    audit_id: requireUuid(input.auditId, "Audit ID"),
    fingerprint_id: requireUuid(input.fingerprintId, "Fingerprint ID"),
    fingerprint_digest: input.fingerprintDigest.toLowerCase(),
    repository: repository.toLowerCase(),
    commit_sha: input.commitSha.toLowerCase(),
  };
}

function sameEvidence(
  a: Omit<W3MDealAuditBinding, "schema" | "binding_hash">,
  b: Omit<W3MDealAuditBinding, "schema" | "binding_hash">,
): boolean {
  return a.project_id === b.project_id &&
    a.audit_id === b.audit_id &&
    a.fingerprint_id === b.fingerprint_id &&
    a.fingerprint_digest === b.fingerprint_digest &&
    a.repository === b.repository &&
    a.commit_sha === b.commit_sha;
}

function stableJson(value: Record<string, string>): string {
  return "{" + Object.keys(value).sort().map((key) =>
    JSON.stringify(key) + ":" + JSON.stringify(value[key])
  ).join(",") + "}";
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(DOMAIN + value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Build a deterministic binding and fail closed on conflicting existing bindings.
 * A fingerprint may support multiple deals only for the exact same project/audit/
 * repository/commit evidence; it can never be reassigned to another project/evidence.
 */
export async function createW3MDealAuditBinding(
  input: W3MDealAuditBindingInput,
  existingBindings: W3MDealAuditBinding[] = [],
): Promise<W3MDealAuditBinding> {
  const candidate = normalizeInput(input);
  if (!Array.isArray(existingBindings)) throw new Error("Existing binding records must be an array.");

  let sameDeal: W3MDealAuditBinding | undefined;
  for (const raw of existingBindings) {
    if (!raw || raw.schema !== "w3m-deal-audit-binding-v1" ||
      typeof raw.binding_hash !== "string" || !DIGEST.test(raw.binding_hash)) {
      throw new Error("An existing deal-audit binding record is malformed.");
    }
    const existing = normalizeInput({
      dealId: raw.deal_id,
      projectId: raw.project_id,
      auditId: raw.audit_id,
      fingerprintId: raw.fingerprint_id,
      fingerprintDigest: raw.fingerprint_digest,
      repository: raw.repository,
      commitSha: raw.commit_sha,
    });
    const expectedHash = await sha256Hex(stableJson(existing));
    if (raw.binding_hash.toLowerCase() !== expectedHash) {
      throw new Error("An existing deal-audit binding hash does not match its contents.");
    }
    if (existing.deal_id === candidate.deal_id) {
      if (sameDeal) throw new Error("More than one audit binding exists for this deal.");
      sameDeal = { ...raw, ...existing, schema: "w3m-deal-audit-binding-v1" };
      if (!sameEvidence(existing, candidate)) {
        throw new Error("A deal is already bound to a different audit fingerprint; create a new deal revision.");
      }
    }
    if (
      existing.fingerprint_id === candidate.fingerprint_id ||
      existing.fingerprint_digest === candidate.fingerprint_digest
    ) {
      if (!sameEvidence(existing, candidate)) {
        throw new Error("This fingerprint is already associated with different project or audit evidence.");
      }
    }
  }

  if (sameDeal) return sameDeal;
  const bindingHash = await sha256Hex(stableJson(candidate));
  return {
    schema: "w3m-deal-audit-binding-v1",
    ...candidate,
    binding_hash: bindingHash,
  };
}

/** Recompute and verify a binding before it is used in a signing challenge. */
export async function verifyW3MDealAuditBinding(
  binding: W3MDealAuditBinding,
  expected: W3MDealAuditBindingInput,
): Promise<boolean> {
  if (!binding || binding.schema !== "w3m-deal-audit-binding-v1") return false;
  let normalized: Omit<W3MDealAuditBinding, "schema" | "binding_hash">;
  let expectedNormalized: Omit<W3MDealAuditBinding, "schema" | "binding_hash">;
  try {
    normalized = normalizeInput({
      dealId: binding.deal_id,
      projectId: binding.project_id,
      auditId: binding.audit_id,
      fingerprintId: binding.fingerprint_id,
      fingerprintDigest: binding.fingerprint_digest,
      repository: binding.repository,
      commitSha: binding.commit_sha,
    });
    expectedNormalized = normalizeInput(expected);
  } catch {
    return false;
  }
  if (!sameEvidence(normalized, expectedNormalized) || normalized.deal_id !== expectedNormalized.deal_id) return false;
  if (typeof binding.binding_hash !== "string" || !DIGEST.test(binding.binding_hash)) return false;
  return (await sha256Hex(stableJson(normalized))) === binding.binding_hash.toLowerCase();
}
