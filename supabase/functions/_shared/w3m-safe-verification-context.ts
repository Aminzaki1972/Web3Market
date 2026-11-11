// Pure validation of the deal and database records used to derive the Safe owner set.
// This module performs no network, database, wallet, or chain operations.
export const W3M_PLATFORM_WALLET = "0x2B15cC63eE3b833F502C065767695Fa2B584f8c9";
const isAddress = (value: unknown): value is string =>
  typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value) && !/^0x0{40}$/i.test(value);
const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function assessSafeVerificationContext(input: {
  deal: { chain_id: unknown; safe_address: unknown };
  buyer: { wallet_address: unknown; wallet_verified: unknown };
  seller: { wallet_address: unknown; wallet_verified: unknown };
  policy: { seller_wallet: unknown; platform_wallet: unknown; safe_address: unknown; chain_id: unknown };
}) {
  const { deal, buyer, seller, policy } = input;
  if (Number(deal.chain_id) !== 56) return { ok: false, reason: "deal_chain_mismatch" } as const;
  if (!isAddress(deal.safe_address)) return { ok: false, reason: "safe_address_missing_or_invalid" } as const;
  if (buyer.wallet_verified !== true || seller.wallet_verified !== true ||
      !isAddress(buyer.wallet_address) || !isAddress(seller.wallet_address) ||
      !isAddress(policy.seller_wallet) || !isAddress(policy.platform_wallet)) {
    return { ok: false, reason: "verified_owner_identity_missing" } as const;
  }
  if (!sameAddress(seller.wallet_address, policy.seller_wallet)) {
    return { ok: false, reason: "seller_wallet_policy_mismatch" } as const;
  }
  if (!sameAddress(policy.platform_wallet, W3M_PLATFORM_WALLET)) {
    return { ok: false, reason: "platform_wallet_policy_mismatch" } as const;
  }
  if (!isAddress(policy.safe_address) || !sameAddress(policy.safe_address, deal.safe_address) ||
      Number(policy.chain_id) !== 56) {
    return { ok: false, reason: "release_policy_safe_mismatch" } as const;
  }
  return {
    ok: true,
    reason: "valid",
    expectedOwners: [buyer.wallet_address, seller.wallet_address, policy.platform_wallet] as const,
  } as const;
}
