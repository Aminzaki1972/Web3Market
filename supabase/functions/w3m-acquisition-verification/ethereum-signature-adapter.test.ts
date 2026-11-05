import { secp256k1 } from "jsr:@noble/curves@1.8.2/secp256k1";
import { keccak_256 } from "jsr:@noble/hashes@1.7.1/sha3";
import {
  recoverEthereumAddressFromDigest,
  verifyEthereumRawDigestSignature,
} from "./ethereum-signature-adapter.ts";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function fromHex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
}
function fixture() {
  // Public deterministic test key only; never use this key outside tests.
  const privateKey = new Uint8Array(32);
  privateKey[31] = 1;
  const digest = new Uint8Array(32);
  digest[31] = 7;
  const signed = secp256k1.sign(digest, privateKey, { prehash: false });
  const signature = "0x" + toHex(new Uint8Array([
    ...signed.toCompactRawBytes(),
    signed.recovery! + 27,
  ]));
  const publicKey = secp256k1.getPublicKey(privateKey, false);
  const address = "0x" + toHex(keccak_256(publicKey.slice(1)).slice(12));
  return { digestHex: toHex(digest), signature, address };
}

Deno.test("recovers the Ethereum address from a real secp256k1 signature over raw digest", () => {
  const f = fixture();
  if (f.address !== "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf") {
    throw new Error("Keccak/address derivation did not match the canonical private-key-1 vector");
  }
  if (recoverEthereumAddressFromDigest(f.digestHex, f.signature) !== f.address) {
    throw new Error("Recovered address did not match the known test signer");
  }
});

Deno.test("verifies expected signer address and rejects a different address", async () => {
  const f = fixture();
  const valid = await verifyEthereumRawDigestSignature({
    digestHex: f.digestHex, signature: f.signature, expectedAddress: f.address,
  });
  const invalid = await verifyEthereumRawDigestSignature({
    digestHex: f.digestHex, signature: f.signature,
    expectedAddress: "0x0000000000000000000000000000000000000001",
  });
  if (!valid || invalid) throw new Error("Expected signer match/mismatch result was incorrect");
});

Deno.test("rejects a modified digest", async () => {
  const f = fixture();
  const altered = (f.digestHex.slice(0, -1) + (f.digestHex.endsWith("8") ? "9" : "8"));
  const valid = await verifyEthereumRawDigestSignature({
    digestHex: altered, signature: f.signature, expectedAddress: f.address,
  });
  if (valid) throw new Error("Modified digest was accepted");
});

Deno.test("rejects unsupported recovery values and malformed encodings", async () => {
  const f = fixture();
  const bytes = fromHex(f.signature.slice(2));
  bytes[64] = 31; // Safe eth_sign and EIP-155 variants are intentionally out of scope.
  const unsupported = await verifyEthereumRawDigestSignature({
    digestHex: f.digestHex, signature: "0x" + toHex(bytes), expectedAddress: f.address,
  });
  const malformed = await verifyEthereumRawDigestSignature({
    digestHex: f.digestHex, signature: "0x1234", expectedAddress: f.address,
  });
  if (unsupported || malformed) throw new Error("Unsupported signature format was accepted");
});

Deno.test("rejects high-S malleable signatures", async () => {
  const f = fixture();
  const bytes = fromHex(f.signature.slice(2));
  const parsed = secp256k1.Signature.fromCompact(bytes.slice(0, 64));
  const highS = secp256k1.CURVE.n - parsed.s;
  const highSBytes = new Uint8Array(32);
  let value = highS;
  for (let i = 31; i >= 0; i--) {
    highSBytes[i] = Number(value & 255n);
    value >>= 8n;
  }
  const malleable = new Uint8Array([...bytes.slice(0, 32), ...highSBytes, bytes[64]]);
  const accepted = await verifyEthereumRawDigestSignature({
    digestHex: f.digestHex, signature: "0x" + toHex(malleable), expectedAddress: f.address,
  });
  if (accepted) throw new Error("High-S signature was accepted");
});
