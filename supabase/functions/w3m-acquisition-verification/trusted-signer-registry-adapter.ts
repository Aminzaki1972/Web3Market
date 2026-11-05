// Maps the service-role-only signer status view into the verifier's domain model.
// This module does not query Supabase; callers must pass rows read server-side.
import type { TrustedSignerKey } from "./signature-verifier.ts";

export type TrustedSignerRegistryMapResult =
  | { ok: true; keys: TrustedSignerKey[] }
  | { ok: false; code: "INVALID_REGISTRY_ROWS"; reason: string };

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const ALGORITHM = "ECDSA_SECP256K1_KECCAK256_RAW_DIGEST";

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function invalid(reason: string): TrustedSignerRegistryMapResult {
  return { ok: false, code: "INVALID_REGISTRY_ROWS", reason };
}

export function mapTrustedSignerRegistryRows(rows: unknown): TrustedSignerRegistryMapResult {
  if (!Array.isArray(rows)) return invalid("Signer registry query result must be an array.");

  const keys: TrustedSignerKey[] = [];
  const seen = new Set<string>();

  for (const [index, value] of rows.entries()) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return invalid("Signer registry row " + index + " is not an object.");
    }
    const row = value as Record<string, unknown>;
    const keyId = row.key_id;
    const algorithm = row.algorithm;
    const address = row.public_address;
    const status = row.status;
    const validFrom = row.valid_from;
    const validUntil = row.valid_until;
    const revokedAt = row.revoked_at;

    if (typeof keyId !== "string" || !keyId.trim() || keyId.length > 128 ||
        seen.has(keyId)) {
      return invalid("Signer registry row " + index + " has a missing, invalid, or duplicate key ID.");
    }
    if (algorithm !== ALGORITHM) {
      return invalid("Signer registry row " + index + " uses an unsupported algorithm.");
    }
    if (typeof address !== "string" || !ADDRESS.test(address)) {
      return invalid("Signer registry row " + index + " has an invalid public address.");
    }
    if (status !== "ACTIVE" && status !== "REVOKED") {
      return invalid("Signer registry row " + index + " has an unknown status.");
    }
    if (!isTimestamp(validFrom) ||
        !isNullableTimestamp(validUntil) ||
        !isNullableTimestamp(revokedAt)) {
      return invalid("Signer registry row " + index + " has invalid validity timestamps.");
    }
    if ((status === "ACTIVE" && revokedAt !== null) ||
        (status === "REVOKED" && revokedAt === null)) {
      return invalid("Signer registry row " + index + " has inconsistent revocation metadata.");
    }

    seen.add(keyId);
    keys.push({
      keyId,
      algorithm,
      publicAddress: address.toLowerCase(),
      status,
      validFrom,
      validUntil,
      revokedAt,
    });
  }

  return { ok: true, keys };
}
