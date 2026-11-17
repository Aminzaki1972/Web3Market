import { mapTrustedSignerRegistryRows } from "./trusted-signer-registry-adapter.ts";

const active = {
  key_id: "signer-key-01",
  algorithm: "ECDSA_SECP256K1_KECCAK256_RAW_DIGEST",
  public_address: "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf",
  valid_from: "2026-01-01T00:00:00.000Z",
  valid_until: "2027-01-01T00:00:00.000Z",
  status: "ACTIVE",
  revoked_at: null,
};

Deno.test("maps a valid active signer row to verifier domain fields", () => {
  const result = mapTrustedSignerRegistryRows([active]);
  if (!result.ok || result.keys.length !== 1 ||
      result.keys[0].keyId !== active.key_id ||
      result.keys[0].publicAddress !== active.public_address ||
      result.keys[0].status !== "ACTIVE" ||
      result.keys[0].revokedAt !== null) {
    throw new Error("Active signer registry row was not mapped correctly.");
  }
});

Deno.test("maps a revoked signer row with immutable revocation timestamp", () => {
  const result = mapTrustedSignerRegistryRows([{
    ...active,
    status: "REVOKED",
    revoked_at: "2026-10-01T00:00:00.000Z",
  }]);
  if (!result.ok || result.keys[0].status !== "REVOKED" ||
      result.keys[0].revokedAt !== "2026-10-01T00:00:00.000Z") {
    throw new Error("Revoked signer row was not mapped correctly.");
  }
});

Deno.test("rejects non-array and non-object rows", () => {
  if (mapTrustedSignerRegistryRows(null).ok ||
      mapTrustedSignerRegistryRows([null]).ok ||
      mapTrustedSignerRegistryRows(["not-a-row"]).ok) {
    throw new Error("Malformed registry container or row was accepted.");
  }
});

Deno.test("rejects missing and duplicate key IDs", () => {
  if (mapTrustedSignerRegistryRows([{ ...active, key_id: "" }]).ok ||
      mapTrustedSignerRegistryRows([active, active]).ok) {
    throw new Error("Missing or duplicate key ID was accepted.");
  }
});

Deno.test("rejects unknown status and inconsistent revocation metadata", () => {
  if (mapTrustedSignerRegistryRows([{ ...active, status: "PAUSED" }]).ok ||
      mapTrustedSignerRegistryRows([{ ...active, revoked_at: "2026-10-01T00:00:00.000Z" }]).ok ||
      mapTrustedSignerRegistryRows([{
        ...active, status: "REVOKED", revoked_at: null,
      }]).ok) {
    throw new Error("Invalid signer lifecycle state was accepted.");
  }
});

Deno.test("rejects unsupported algorithm and malformed address", () => {
  if (mapTrustedSignerRegistryRows([{ ...active, algorithm: "P-256" }]).ok ||
      mapTrustedSignerRegistryRows([{ ...active, public_address: "0x123" }]).ok) {
    throw new Error("Unsupported algorithm or malformed address was accepted.");
  }
});

Deno.test("rejects malformed validity timestamps", () => {
  if (mapTrustedSignerRegistryRows([{ ...active, valid_from: "yesterday" }]).ok ||
      mapTrustedSignerRegistryRows([{ ...active, valid_until: "never" }]).ok) {
    throw new Error("Malformed signer validity timestamp was accepted.");
  }
});

Deno.test("normalizes the public address to lowercase", () => {
  const mixed = { ...active, public_address: "0x7E5F4552091A69125D5DFCB7B8C2659029395BDF" };
  const result = mapTrustedSignerRegistryRows([mixed]);
  if (!result.ok || result.keys[0].publicAddress !== active.public_address) {
    throw new Error("Signer address was not normalized.");
  }
});
