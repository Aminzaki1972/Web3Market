import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import { Wallet } from "npm:ethers@6.15.0";
import {
  buildW3MAgreementTypedData,
  verifyW3MAgreementSignature,
  type W3MAgreementAcceptanceInput,
} from "./agreement-signature.ts";

const NOW = 1_800_000_000;
const wallet = new Wallet("0x" + "11".repeat(32));
const otherWallet = new Wallet("0x" + "22".repeat(32));
const base: W3MAgreementAcceptanceInput = {
  dealId: "0x" + "01".repeat(32),
  fingerprintId: "0x" + "02".repeat(32),
  fingerprintDigest: "0x" + "03".repeat(32),
  bindingHash: "0x" + "0b".repeat(32),
  termsHash: "0x" + "04".repeat(32),
  termsVersion: "1",
  partyRole: "buyer",
  walletAddress: wallet.address,
  nonce: "0x" + "05".repeat(32),
  deadline: NOW + 300,
};

Deno.test("builds the fixed BNB Chain EIP-712 agreement domain and complete binding", () => {
  const typed = buildW3MAgreementTypedData(base, NOW);
  assertEquals(typed.domain.chainId, 56);
  assertEquals(typed.domain.name, "Web3Market Deal Agreement");
  assertEquals(typed.primaryType, "DealTermsAcceptance");
  assertEquals(typed.message.partyRole, 1);
  assertEquals(typed.message.fingerprintId, base.fingerprintId);
  assertEquals(typed.message.fingerprintDigest, base.fingerprintDigest);
  assertEquals(typed.message.bindingHash, base.bindingHash);
  assertEquals(typed.message.termsHash, base.termsHash);
});

Deno.test("recovers the verified wallet from a valid typed agreement signature", async () => {
  const typed = buildW3MAgreementTypedData(base, NOW);
  const signature = await wallet.signTypedData(typed.domain, typed.types, typed.message);
  const result = verifyW3MAgreementSignature(base, signature, NOW);
  assertEquals(result.valid, true);
  assertEquals(result.recoveredAddress.toLowerCase(), wallet.address.toLowerCase());
});

Deno.test("rejects a signature from a different wallet", async () => {
  const typed = buildW3MAgreementTypedData({ ...base, walletAddress: otherWallet.address }, NOW);
  const signature = await otherWallet.signTypedData(typed.domain, typed.types, typed.message);
  assertThrows(() => verifyW3MAgreementSignature({ ...base, walletAddress: wallet.address }, signature, NOW));
});

Deno.test("rejects signatures replayed against another deal, fingerprint, digest, or terms hash", async () => {
  const typed = buildW3MAgreementTypedData(base, NOW);
  const signature = await wallet.signTypedData(typed.domain, typed.types, typed.message);
  const mutations: W3MAgreementAcceptanceInput[] = [
    { ...base, dealId: "0x" + "06".repeat(32) },
    { ...base, fingerprintId: "0x" + "07".repeat(32) },
    { ...base, fingerprintDigest: "0x" + "08".repeat(32) },
    { ...base, bindingHash: "0x" + "0c".repeat(32) },
    { ...base, termsHash: "0x" + "09".repeat(32) },
    { ...base, termsVersion: "2" },
    { ...base, partyRole: "seller" },
    { ...base, nonce: "0x" + "0a".repeat(32) },
  ];
  for (const changed of mutations) {
    let rejected = false;
    try {
      verifyW3MAgreementSignature(changed, signature, NOW);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("A changed agreement binding must invalidate the signature.");
  }
});

Deno.test("rejects expired and excessively long signature deadlines", () => {
  const expired = { ...base, deadline: NOW };
  const tooLong = { ...base, deadline: NOW + 901 };
  let expiredRejected = false;
  let longRejected = false;
  try { buildW3MAgreementTypedData(expired, NOW); } catch { expiredRejected = true; }
  try { buildW3MAgreementTypedData(tooLong, NOW); } catch { longRejected = true; }
  assertEquals(expiredRejected, true);
  assertEquals(longRejected, true);
});

Deno.test("rejects malformed identifiers, roles, and signatures", () => {
  const invalidInputs = [
    { ...base, dealId: "0x1234" },
    { ...base, fingerprintDigest: "0x1234" },
    { ...base, termsVersion: "0" },
    { ...base, partyRole: "admin" as "buyer" },
    { ...base, walletAddress: "not-an-address" },
  ];
  for (const invalid of invalidInputs) {
    let rejected = false;
    try { buildW3MAgreementTypedData(invalid, NOW); } catch { rejected = true; }
    assertEquals(rejected, true);
  }
  let signatureRejected = false;
  try { verifyW3MAgreementSignature(base, "0x1234", NOW); } catch { signatureRejected = true; }
  assertEquals(signatureRejected, true);
});


Deno.test("rejects invalid verifier clock values before constructing typed data", () => {
  for (const now of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    let rejected = false;
    try { buildW3MAgreementTypedData(base, now); } catch { rejected = true; }
    assertEquals(rejected, true);
  }
});
