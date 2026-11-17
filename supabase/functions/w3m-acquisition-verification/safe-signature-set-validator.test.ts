import {
  validateSafeSignatureSet,
  type SafeSignatureSetInput,
} from "./safe-signature-set-validator.ts";

const OWNER_A = "0x1111111111111111111111111111111111111111";
const OWNER_B = "0x2222222222222222222222222222222222222222";
const OWNER_C = "0x3333333333333333333333333333333333333333";
const HASH = "0x" + "a".repeat(64);
const SIG_A = "0x" + "1".repeat(130);
const SIG_B = "0x" + "2".repeat(130);

function input(overrides: Partial<SafeSignatureSetInput> = {}): SafeSignatureSetInput {
  return {
    safeTransactionHash: HASH,
    currentOwners: [OWNER_A, OWNER_B, OWNER_C],
    threshold: 2,
    storedSignatures: [
      { walletAddress: OWNER_A, signature: SIG_A, signatureStatus: "signed" },
      { walletAddress: OWNER_B, signature: SIG_B, signatureStatus: "signed" },
    ],
    ...overrides,
  };
}
const verifier = async ({ signature, expectedAddress }: {
  digestHex: string; signature: string; expectedAddress: string;
}) => (signature === SIG_A && expectedAddress === OWNER_A) ||
  (signature === SIG_B && expectedAddress === OWNER_B);

async function denied(candidate: SafeSignatureSetInput, code: string) {
  const result = await validateSafeSignatureSet(candidate, verifier);
  if (result.valid || !result.issues.includes(code)) {
    throw new Error("Expected " + code + ", received " + JSON.stringify(result));
  }
}

Deno.test("accepts two independently recovered current Safe owners at threshold", async () => {
  const result = await validateSafeSignatureSet(input(), verifier);
  if (!result.valid || result.validSignatures !== 2) throw new Error(JSON.stringify(result));
});
Deno.test("rejects a signature whose recovery does not match its stored signer", async () => {
  const x = input();
  x.storedSignatures[1].signature = SIG_A;
  await denied(x, "STORED_SIGNATURE_RECOVERY_FAILED");
});
Deno.test("rejects a stored signer who is no longer a Safe owner", async () => {
  const x = input();
  x.currentOwners = [OWNER_A, OWNER_C];
  await denied(x, "STORED_SIGNER_NOT_CURRENT_OWNER");
});
Deno.test("rejects duplicate signer rows", async () => {
  const x = input();
  x.storedSignatures[1].walletAddress = OWNER_A;
  await denied(x, "DUPLICATE_STORED_SIGNER");
});
Deno.test("rejects a non-confirmed signature row", async () => {
  const x = input();
  x.storedSignatures[1].signatureStatus = "pending";
  await denied(x, "STORED_SIGNATURE_NOT_CONFIRMED");
});
Deno.test("rejects malformed Safe transaction hash", async () => {
  await denied(input({ safeTransactionHash: "0x1234" }), "SAFE_TX_HASH_INVALID");
});
Deno.test("rejects malformed signature bytes", async () => {
  const x = input();
  x.storedSignatures[0].signature = "0x1234";
  await denied(x, "STORED_SIGNATURE_FORMAT_INVALID");
});
Deno.test("rejects fewer recovered signatures than Safe threshold", async () => {
  const x = input();
  x.storedSignatures = [x.storedSignatures[0]];
  await denied(x, "SAFE_SIGNATURES_BELOW_THRESHOLD");
});
Deno.test("rejects an invalid Safe threshold", async () => {
  await denied(input({ threshold: 4 }), "SAFE_THRESHOLD_INVALID");
});
Deno.test("rejects duplicated Safe owner metadata", async () => {
  await denied(input({ currentOwners: [OWNER_A, OWNER_A] }), "SAFE_OWNERS_DUPLICATED");
});
Deno.test("rejects malformed Safe owner metadata", async () => {
  await denied(input({ currentOwners: ["not-an-address"] }), "SAFE_OWNERS_INVALID");
});
Deno.test("rejects an exception from cryptographic recovery fail-closed", async () => {
  const result = await validateSafeSignatureSet(input(), async () => {
    throw new Error("crypto unavailable");
  });
  if (result.valid || !result.issues.includes("STORED_SIGNATURE_RECOVERY_FAILED")) {
    throw new Error("Cryptographic exception was not rejected");
  }
});


import { secp256k1 } from "jsr:@noble/curves@1.8.2/secp256k1";
import { keccak_256 } from "jsr:@noble/hashes@1.7.1/sha3";

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function realSigner(privateKeyByte: number, digest: Uint8Array) {
  const privateKey = new Uint8Array(32);
  privateKey[31] = privateKeyByte;
  const signature = secp256k1.sign(digest, privateKey, { prehash: false });
  const address = "0x" + hex(keccak_256(secp256k1.getPublicKey(privateKey, false).slice(1)).slice(12));
  return {
    walletAddress: address,
    signature: "0x" + hex(new Uint8Array([...signature.toCompactRawBytes(), signature.recovery! + 27])),
    signatureStatus: "signed",
  };
}

Deno.test("recovers actual Safe EIP-712 transaction digest signatures at execution gate", async () => {
  // Safe's TypedDataEncoder.hash is the 32-byte safe_tx_hash. EIP-712 signatures
  // are recovered from that digest directly; no personal_sign prefix is applied.
  const digest = new Uint8Array(32);
  digest[31] = 42;
  const a = realSigner(1, digest);
  const b = realSigner(2, digest);
  const result = await validateSafeSignatureSet({
    safeTransactionHash: "0x" + hex(digest),
    currentOwners: [a.walletAddress, b.walletAddress],
    threshold: 2,
    storedSignatures: [a, b],
  });
  if (!result.valid || result.validSignatures !== 2) {
    throw new Error("Real Safe digest signatures failed recovery: " + JSON.stringify(result));
  }
});


Deno.test("fails closed when trusted Safe owner rows are not an array", async () => {
  const malformed = input() as unknown as { safeTransactionHash: string; currentOwners: unknown; threshold: number; storedSignatures: unknown };
  malformed.currentOwners = null;
  const result = await validateSafeSignatureSet(malformed as SafeSignatureSetInput, verifier);
  if (result.valid || !result.issues.includes("SAFE_OWNERS_INVALID")) {
    throw new Error("Malformed owner rows were not rejected");
  }
});
Deno.test("fails closed when stored signer rows are not an array", async () => {
  const malformed = input() as unknown as { safeTransactionHash: string; currentOwners: unknown; threshold: number; storedSignatures: unknown };
  malformed.storedSignatures = null;
  const result = await validateSafeSignatureSet(malformed as SafeSignatureSetInput, verifier);
  if (result.valid || !result.issues.includes("STORED_SIGNATURE_ROWS_INVALID")) {
    throw new Error("Malformed signature rows were not rejected");
  }
});
