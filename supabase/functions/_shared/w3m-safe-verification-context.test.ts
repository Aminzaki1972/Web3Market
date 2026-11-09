import { assertEquals } from "jsr:@std/assert@1.0.14";
import { assessSafeVerificationContext, W3M_PLATFORM_WALLET } from "./w3m-safe-verification-context.ts";

const BUYER = "0x1111111111111111111111111111111111111111";
const SELLER = "0x2222222222222222222222222222222222222222";
const SAFE = "0x3333333333333333333333333333333333333333";
const base = () => ({
  deal: { chain_id: 56, safe_address: SAFE },
  buyer: { wallet_address: BUYER, wallet_verified: true },
  seller: { wallet_address: SELLER, wallet_verified: true },
  policy: { seller_wallet: SELLER, platform_wallet: W3M_PLATFORM_WALLET, safe_address: SAFE, chain_id: 56 },
});

Deno.test("Safe context accepts verified participant wallets and exact release policy", () => {
  const result = assessSafeVerificationContext(base());
  assertEquals(result.ok, true);
  assertEquals(result.reason, "valid");
  if (result.ok) assertEquals([...result.expectedOwners], [BUYER, SELLER, W3M_PLATFORM_WALLET]);
});

Deno.test("Safe context rejects a deal on the wrong chain", () => {
  const input = base(); input.deal.chain_id = 97;
  assertEquals(assessSafeVerificationContext(input).reason, "deal_chain_mismatch");
});

Deno.test("Safe context rejects unverified or missing participant wallets", () => {
  const unverified = base(); unverified.buyer.wallet_verified = false;
  assertEquals(assessSafeVerificationContext(unverified).reason, "verified_owner_identity_missing");
  const missing = base(); missing.seller.wallet_address = null;
  assertEquals(assessSafeVerificationContext(missing).reason, "verified_owner_identity_missing");
});

Deno.test("Safe context rejects seller wallet policy mismatch", () => {
  const input = base(); input.policy.seller_wallet = BUYER;
  assertEquals(assessSafeVerificationContext(input).reason, "seller_wallet_policy_mismatch");
});

Deno.test("Safe context rejects an unexpected platform owner", () => {
  const input = base(); input.policy.platform_wallet = BUYER;
  assertEquals(assessSafeVerificationContext(input).reason, "platform_wallet_policy_mismatch");
});

Deno.test("Safe context rejects a different Safe address or policy chain", () => {
  const addressMismatch = base(); addressMismatch.policy.safe_address = BUYER;
  assertEquals(assessSafeVerificationContext(addressMismatch).reason, "release_policy_safe_mismatch");
  const chainMismatch = base(); chainMismatch.policy.chain_id = 97;
  assertEquals(assessSafeVerificationContext(chainMismatch).reason, "release_policy_safe_mismatch");
});

Deno.test("Safe context rejects malformed Safe addresses", () => {
  const input = base(); input.deal.safe_address = "0x1234";
  assertEquals(assessSafeVerificationContext(input).reason, "safe_address_missing_or_invalid");
});
