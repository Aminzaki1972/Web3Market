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
