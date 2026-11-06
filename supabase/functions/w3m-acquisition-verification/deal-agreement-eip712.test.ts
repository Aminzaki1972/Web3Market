import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import { secp256k1 } from "jsr:@noble/curves@1.8.2/secp256k1";
import { keccak_256 } from "jsr:@noble/hashes@1.7.1/sha3";
import {
  buildDealTermsAcceptanceTypedData,
  computeDealTermsAcceptanceDigest,
  verifyDealTermsAcceptanceSignature,
  type DealTermsAcceptanceInput,
} from "./deal-agreement-eip712.ts";

const base: DealTermsAcceptanceInput = {
  dealId: "71000000-0000-4000-8000-000000000001",
  projectId: "72000000-0000-4000-8000-000000000002",
  buyerId: "73000000-0000-4000-8000-000000000003",
  sellerId: "74000000-0000-4000-8000-000000000004",
  safeAddress: "0x2222222222222222222222222222222222222222",
  termsHash: "ab".repeat(32),
  termsVersion: "1",
  partyRole: "buyer",
};
function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function signer(digestHex: string, privateKeyByte: number) {
  const privateKey = new Uint8Array(32);
  privateKey[31] = privateKeyByte;
  const digest = Uint8Array.from(digestHex.match(/.{2}/g)!, (part) => Number.parseInt(part, 16));
  const signed = secp256k1.sign(digest, privateKey, { prehash: false });
  const wallet = "0x" + toHex(keccak_256(secp256k1.getPublicKey(privateKey, false).slice(1)).slice(12));
  const signature = "0x" + toHex(new Uint8Array([...signed.toCompactRawBytes(), signed.recovery! + 27]));
  return { wallet, signature };
}

Deno.test("builds EIP-712 typed data bound to BNB Chain 56 and exact acquisition fields", () => {
  const typed = buildDealTermsAcceptanceTypedData(base);
  assertEquals(typed.domain, { name: "Web3Market Deal Agreement", version: "1", chainId: 56 });
  assertEquals(typed.primaryType, "DealTermsAcceptance");
  assertEquals(typed.message.termsVersion, "1");
  assertEquals(typed.message.partyRole, 1);
  assertEquals(typed.message.safeAddress, base.safeAddress.toLowerCase());
  assertEquals(typed.message.termsHash, "0x" + base.termsHash);
});

Deno.test("buyer and seller roles produce different EIP-712 digests for identical terms", () => {
  const buyer = computeDealTermsAcceptanceDigest({ ...base, partyRole: "buyer" });
  const seller = computeDealTermsAcceptanceDigest({ ...base, partyRole: "seller" });
  assertEquals(buyer === seller, false);
});

Deno.test("recovers the verified wallet from a real typed-data digest signature", () => {
  const digest = computeDealTermsAcceptanceDigest(base).slice(2);
  const expected = signer(digest, 1);
  const result = verifyDealTermsAcceptanceSignature({
    acceptance: base, signature: expected.signature, expectedWallet: expected.wallet,
  });
  assertEquals(result.valid, true);
  assertEquals(result.recoveredWallet, expected.wallet);
});

Deno.test("rejects wrong wallet, altered terms, version, Safe, and role", () => {
  const expected = signer(computeDealTermsAcceptanceDigest(base).slice(2), 1);
  for (const acceptance of [
    { ...base, termsHash: "cd".repeat(32) },
    { ...base, termsVersion: "2" },
    { ...base, safeAddress: "0x3333333333333333333333333333333333333333" },
    { ...base, partyRole: "seller" as const },
  ]) {
    assertEquals(verifyDealTermsAcceptanceSignature({
      acceptance, signature: expected.signature, expectedWallet: expected.wallet,
    }).valid, false);
  }
  assertEquals(verifyDealTermsAcceptanceSignature({
    acceptance: base, signature: expected.signature,
    expectedWallet: "0x0000000000000000000000000000000000000002",
  }).valid, false);
});

Deno.test("rejects malformed UUIDs, hash, address, and non-positive version", () => {
  assertThrows(() => computeDealTermsAcceptanceDigest({ ...base, dealId: "not-a-uuid" }));
  assertThrows(() => computeDealTermsAcceptanceDigest({ ...base, termsHash: "0x1234" }));
  assertThrows(() => computeDealTermsAcceptanceDigest({ ...base, safeAddress: "0x1234" }));
  assertThrows(() => computeDealTermsAcceptanceDigest({ ...base, termsVersion: "0" }));
});

Deno.test("case-normalized UUIDs and Safe addresses produce the same digest", () => {
  const digest = computeDealTermsAcceptanceDigest(base);
  const normalized = computeDealTermsAcceptanceDigest({
    ...base, dealId: base.dealId.toUpperCase(), safeAddress: base.safeAddress.toUpperCase(),
  });
  assertEquals(digest, normalized);
});
