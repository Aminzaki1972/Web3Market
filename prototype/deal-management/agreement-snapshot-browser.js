/** Browser-compatible deterministic agreement hashing for the isolated preview only. */
function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function canonicalize(value) {
  const visit = (input, depth) => {
    if (depth > 64) throw new Error("Agreement snapshot exceeds maximum nesting depth");
    if (input === null) return "null";
    if (typeof input === "string") return JSON.stringify(input.normalize("NFC"));
    if (typeof input === "boolean") return input ? "true" : "false";
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new Error("Agreement snapshot contains a non-finite number");
      return Object.is(input, -0) ? "0" : JSON.stringify(input);
    }
    if (Array.isArray(input)) return "[" + input.map(item => visit(item, depth + 1)).join(",") + "]";
    if (isPlainRecord(input)) {
      const normalized = new Map();
      for (const [rawKey, item] of Object.entries(input)) {
        const key = rawKey.normalize("NFC");
        if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Agreement snapshot contains a prohibited object key");
        if (normalized.has(key)) throw new Error("Agreement snapshot has colliding normalized object keys");
        normalized.set(key, item);
      }
      return "{" + [...normalized.keys()].sort().map(key => JSON.stringify(key) + ":" + visit(normalized.get(key), depth + 1)).join(",") + "}";
    }
    throw new Error("Agreement snapshot contains an unsupported or lossy value");
  };
  return visit(value, 0);
}
export async function hashDealAgreementSnapshot(value) {
  if (!isPlainRecord(value)) throw new Error("Agreement terms must be a plain JSON object");
  const canonicalJson = canonicalize(value);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson));
  const termsHash = "0x" + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return { canonicalJson, termsHash };
}
