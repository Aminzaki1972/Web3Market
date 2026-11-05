import {
  verifyTrustedReportSignature,
  type TrustedSignerKey,
} from "./signature-verifier.ts";
function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Assertion failed: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const key: TrustedSignerKey = {
  keyId: "w3m-test-key-01",
  algorithm: "ECDSA_SECP256K1_KECCAK256_RAW_DIGEST",
  publicAddress: "0x1234567890123456789012345678901234567890",
  status: "ACTIVE",
  validFrom: "2026-01-01T00:00:00.000Z",
  validUntil: "2027-01-01T00:00:00.000Z",
  revokedAt: null,
};
const base = {
  digestHex: "a".repeat(64),
  signature: "0x" + "b".repeat(130),
  signerKeyId: key.keyId,
  checkedAt: "2026-11-05T12:00:00.000Z",
};
const accept = async (input: {
  digestHex: string;
  signature: string;
  expectedAddress: string;
}) => input.expectedAddress === key.publicAddress.toLowerCase() &&
  input.digestHex === base.digestHex;

Deno.test("trusted signer accepts only cryptographically verified matching address", async () => {
  const result = await verifyTrustedReportSignature(base, [key], accept);
  assertEquals(result.valid, true);
  if (result.valid) assertEquals(result.recoveredAddress, key.publicAddress.toLowerCase());
});

Deno.test("signature-shaped bytes alone do not establish trust", async () => {
  const result = await verifyTrustedReportSignature(base, [key], async () => false);
  assertEquals(result.valid, false);
  if (!result.valid) assertEquals(result.code, "SIGNATURE_INVALID");
});

Deno.test("rejects malformed digest", async () => {
  const result = await verifyTrustedReportSignature({ ...base, digestHex: "abc" }, [key], accept);
  assertEquals(result.valid, false);
  if (!result.valid) assertEquals(result.code, "INVALID_DIGEST");
});

Deno.test("rejects malformed signature encoding", async () => {
  const result = await verifyTrustedReportSignature({ ...base, signature: "0x1234" }, [key], accept);
  assertEquals(result.valid, false);
  if (!result.valid) assertEquals(result.code, "INVALID_SIGNATURE_FORMAT");
});

Deno.test("rejects unknown and ambiguous key IDs", async () => {
  const unknown = await verifyTrustedReportSignature({ ...base, signerKeyId: "missing" }, [key], accept);
  assertEquals(unknown.valid, false);
  if (!unknown.valid) assertEquals(unknown.code, "UNKNOWN_SIGNER_KEY");
  const ambiguous = await verifyTrustedReportSignature(base, [key, key], accept);
  assertEquals(ambiguous.valid, false);
  if (!ambiguous.valid) assertEquals(ambiguous.code, "UNKNOWN_SIGNER_KEY");
});

Deno.test("rejects revoked key even if its validity window is current", async () => {
  const revoked = await verifyTrustedReportSignature(base, [{ ...key, status: "REVOKED" }], accept);
  assertEquals(revoked.valid, false);
  if (!revoked.valid) assertEquals(revoked.code, "REVOKED_SIGNER_KEY");
});

Deno.test("rejects key with revocation timestamp", async () => {
  const revoked = await verifyTrustedReportSignature(base, [{
    ...key, revokedAt: "2026-11-04T00:00:00.000Z",
  }], accept);
  assertEquals(revoked.valid, false);
  if (!revoked.valid) assertEquals(revoked.code, "REVOKED_SIGNER_KEY");
});

Deno.test("rejects key before valid-from time", async () => {
  const result = await verifyTrustedReportSignature({
    ...base, checkedAt: "2025-12-31T23:59:59.000Z",
  }, [key], accept);
  assertEquals(result.valid, false);
  if (!result.valid) assertEquals(result.code, "SIGNER_KEY_NOT_YET_VALID");
});

Deno.test("rejects expired key", async () => {
  const result = await verifyTrustedReportSignature({
    ...base, checkedAt: "2027-01-01T00:00:01.000Z",
  }, [key], accept);
  assertEquals(result.valid, false);
  if (!result.valid) assertEquals(result.code, "SIGNER_KEY_EXPIRED");
});

Deno.test("rejects unsupported algorithm and malformed key address", async () => {
  const algorithm = await verifyTrustedReportSignature(base, [{
    ...key, algorithm: "UNSUPPORTED" as TrustedSignerKey["algorithm"],
  }], accept);
  assertEquals(algorithm.valid, false);
  if (!algorithm.valid) assertEquals(algorithm.code, "UNSUPPORTED_SIGNER_ALGORITHM");
  const address = await verifyTrustedReportSignature(base, [{ ...key, publicAddress: "0x123" }], accept);
  assertEquals(address.valid, false);
  if (!address.valid) assertEquals(address.code, "INVALID_SIGNER_KEY");
});

Deno.test("rejects invalid check timestamp", async () => {
  const result = await verifyTrustedReportSignature({ ...base, checkedAt: "not-a-date" }, [key], accept);
  assertEquals(result.valid, false);
  if (!result.valid) assertEquals(result.code, "INVALID_CHECK_TIME");
});

Deno.test("fails closed when cryptographic adapter throws", async () => {
  const result = await verifyTrustedReportSignature(base, [key], async () => {
    throw new Error("adapter unavailable");
  });
  assertEquals(result.valid, false);
  if (!result.valid) assertEquals(result.code, "CRYPTO_VERIFIER_ERROR");
});
