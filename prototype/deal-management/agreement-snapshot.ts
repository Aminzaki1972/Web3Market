/**
 * Deterministic agreement snapshot serialization for the isolated sandbox.
 *
 * This is a pure serialization/hash primitive. It does not persist versions,
 * authenticate the caller, establish platform approval authority, or sign
 * EIP-712 messages. Production must calculate the digest on the trusted server
 * from the exact immutable terms snapshot.
 */

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeString(value: string): string {
  return value.normalize("NFC");
}

/** Canonical JSON: sorted normalized object keys, preserved array order, no lossy JS values. */
export function canonicalizeAgreementValue(value: unknown): string {
  const visit = (input: unknown, depth: number): string => {
    if (depth > 64) throw new Error("Agreement snapshot exceeds maximum nesting depth");
    if (input === null) return "null";
    if (typeof input === "string") return JSON.stringify(normalizeString(input));
    if (typeof input === "boolean") return input ? "true" : "false";
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new Error("Agreement snapshot contains a non-finite number");
      return Object.is(input, -0) ? "0" : JSON.stringify(input);
    }
    if (Array.isArray(input)) {
      return "[" + input.map(item => visit(item, depth + 1)).join(",") + "]";
    }
    if (isPlainRecord(input)) {
      const normalized = new Map<string, unknown>();
      for (const [rawKey, item] of Object.entries(input)) {
        const key = normalizeString(rawKey);
        if (key === "__proto__" || key === "prototype" || key === "constructor") {
          throw new Error("Agreement snapshot contains a prohibited object key");
        }
        if (normalized.has(key)) throw new Error("Agreement snapshot has colliding normalized object keys");
        normalized.set(key, item);
      }
      const keys = [...normalized.keys()].sort();
      return "{" + keys.map(key =>
        JSON.stringify(key) + ":" + visit(normalized.get(key), depth + 1)
      ).join(",") + "}";
    }
    throw new Error("Agreement snapshot contains an unsupported or lossy value");
  };
  return visit(value, 0);
}

/** SHA-256 digest of the canonical JSON, returned as a 0x-prefixed 32-byte hex string. */
export async function hashDealAgreementSnapshot(value: unknown): Promise<{
  canonicalJson: string;
  termsHash: string;
}> {
  if (!isPlainRecord(value)) throw new Error("Agreement terms must be a plain JSON object");
  const canonicalJson = canonicalizeAgreementValue(value);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson));
  const termsHash = "0x" + [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  return { canonicalJson, termsHash };
}
