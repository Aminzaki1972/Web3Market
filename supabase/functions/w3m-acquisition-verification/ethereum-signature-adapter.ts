// Ethereum-compatible secp256k1 recovery for W3M report signatures.
// Dependency versions are pinned. This verifies the raw 32-byte report digest;
// it does not apply EIP-191 personal_sign prefixing.
import { secp256k1 } from "jsr:@noble/curves@1.8.2/secp256k1";
import { keccak_256 } from "jsr:@noble/hashes@1.8.0/sha3";

const HEX_32 = /^[0-9a-f]{64}$/i;
const HEX_SIGNATURE = /^0x[0-9a-f]{130}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;

function fromHex(value: string): Uint8Array {
  if (value.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(value)) {
    throw new Error("Invalid hexadecimal input");
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Recover the Ethereum address that signed a raw 32-byte digest. */
export function recoverEthereumAddressFromDigest(
  digestHex: string,
  signature: string,
): string {
  if (!HEX_32.test(digestHex)) throw new Error("Digest must be exactly 32 bytes");
  if (!HEX_SIGNATURE.test(signature)) throw new Error("Signature must be exactly 65 bytes");

  const bytes = fromHex(signature.slice(2));
  const compact = bytes.slice(0, 64);
  const rawV = bytes[64];
  const recovery = rawV === 27 || rawV === 28 ? rawV - 27 : rawV;
  // This protocol accepts Ethereum parity values only; it does not guess
  // EIP-155 transaction v values or Safe eth_sign (31/32) signatures.
  if (recovery !== 0 && recovery !== 1) throw new Error("Unsupported Ethereum recovery value");

  const parsed = secp256k1.Signature.fromCompact(compact);
  if (parsed.hasHighS()) throw new Error("High-S signature is non-canonical");

  const recovered = parsed.addRecoveryBit(recovery)
    .recoverPublicKey(fromHex(digestHex))
    .toRawBytes(false);
  if (recovered.length !== 65 || recovered[0] !== 4) {
    throw new Error("Recovered public key is not an uncompressed secp256k1 key");
  }

  // Ethereum address = low 20 bytes of Keccak-256(uncompressed pubkey[1:]).
  const addressHash = keccak_256(recovered.slice(1));
  const address = "0x" + toHex(addressHash.slice(12));
  if (!ADDRESS.test(address)) throw new Error("Recovered address is malformed");
  return address.toLowerCase();
}

export async function verifyEthereumRawDigestSignature(input: {
  digestHex: string;
  signature: string;
  expectedAddress: string;
}): Promise<boolean> {
  if (!ADDRESS.test(input.expectedAddress)) return false;
  try {
    const recovered = recoverEthereumAddressFromDigest(input.digestHex, input.signature);
    return recovered === input.expectedAddress.toLowerCase();
  } catch {
    return false;
  }
}
