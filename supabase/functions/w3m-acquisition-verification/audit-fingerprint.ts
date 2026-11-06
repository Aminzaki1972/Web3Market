/**
 * Deterministic, domain-separated fingerprinting for a persisted W3M audit manifest.
 *
 * This module is intentionally pure apart from Web Crypto. It does not load audit
 * rows, authorize callers, persist records, or issue acquisition reports.
 */
const COMMIT_SHA = /^[0-9a-f]{40}$/i;
const AUDIT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPOSITORY = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\/[a-z0-9_.-]+$/i;
const DOMAIN = "w3m-audit-fingerprint:v1\n";

function canonicalJson(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value) as string;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Manifest contains a non-finite number.");
    return JSON.stringify(value) as string;
  }
  if (typeof value !== "object") {
    throw new Error("Manifest contains a value that is not JSON-compatible.");
  }
  if (seen.has(value)) throw new Error("Manifest contains a circular reference.");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return "[" + value.map((item) => canonicalJson(item, seen)).join(",") + "]";
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Manifest objects must be plain JSON objects.");
    }
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    return "{" + keys.map((key) =>
      JSON.stringify(key) + ":" + canonicalJson(object[key], seen)
    ).join(",") + "}";
  } finally {
    seen.delete(value);
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface AuditFingerprintInput {
  auditId: string;
  repository: string;
  commitSha: string;
  schemaVersion: string;
  manifest: Record<string, unknown>;
}

export async function computeW3MAuditFingerprint(input: AuditFingerprintInput): Promise<{
  algorithm: "sha-256";
  schemaVersion: string;
  canonicalPayload: string;
  digest: string;
}> {
  if (!input || !AUDIT_ID.test(input.auditId)) throw new Error("A valid audit ID is required.");
  if (!REPOSITORY.test(input.repository)) throw new Error("A normalized owner/repository identity is required.");
  if (!COMMIT_SHA.test(input.commitSha)) throw new Error("A full 40-character audited commit SHA is required.");
  if (typeof input.schemaVersion !== "string" || !/^[a-zA-Z0-9._-]{1,64}$/.test(input.schemaVersion)) {
    throw new Error("A valid manifest schema version is required.");
  }
  if (!input.manifest || typeof input.manifest !== "object" || Array.isArray(input.manifest)) {
    throw new Error("A JSON object audit manifest is required.");
  }

  const envelope = {
    schema_version: input.schemaVersion,
    audit_id: input.auditId.toLowerCase(),
    repository: input.repository.toLowerCase(),
    commit_sha: input.commitSha.toLowerCase(),
    manifest: input.manifest,
  };
  const canonicalPayload = canonicalJson(envelope);
  const encoded = new TextEncoder().encode(DOMAIN + canonicalPayload);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return {
    algorithm: "sha-256",
    schemaVersion: input.schemaVersion,
    canonicalPayload,
    digest: bytesToHex(new Uint8Array(digest)),
  };
}
