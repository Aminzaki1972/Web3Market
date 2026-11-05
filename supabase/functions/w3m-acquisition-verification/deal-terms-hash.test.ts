import { assertEquals, assertNotEquals, assertRejects } from "jsr:@std/assert@1";
import { computeDealTermsHash, type DealTermsSnapshot } from "./deal-terms-hash.ts";

function snapshot(): DealTermsSnapshot {
  return {
    dealId: "deal-terms-1",
    projectId: "project-terms-1",
    buyerId: "buyer-terms-1",
    sellerId: "seller-terms-1",
    amount: "100.00000000",
    currency: "usdt",
    expectedAmount: "100.0",
    chainId: 56,
    safeAddress: "0x2222222222222222222222222222222222222222",
    tokenContract: "0x3333333333333333333333333333333333333333",
    policy: {
      dealAmount: "100",
      feePercent: "7.5000",
      feeAmount: "7.50000000",
      sellerNetAmount: "92.50000000",
      chainId: 56,
      safeAddress: "0x2222222222222222222222222222222222222222",
      tokenContract: "0x3333333333333333333333333333333333333333",
      sellerWallet: "0x4444444444444444444444444444444444444444",
      platformWallet: "0x2B15cC63eE3b833F502C065767695Fa2B584f8c9",
      safeNonce: "7",
      status: "locked",
    },
  };
}

Deno.test("deal terms hash normalizes exact decimals and EVM addresses", async () => {
  const first = await computeDealTermsHash(snapshot());
  const second = await computeDealTermsHash({
    ...snapshot(),
    amount: "100",
    expectedAmount: "100.000",
    policy: {
      ...snapshot().policy,
      dealAmount: "100.000",
      feePercent: "7.5",
      feeAmount: "7.5",
      sellerNetAmount: "92.5",
      chainId: 56,
      safeAddress: "0x2222222222222222222222222222222222222222",
      tokenContract: "0x3333333333333333333333333333333333333333",
    },
    safeAddress: snapshot().safeAddress.toUpperCase().replace("0X", "0x"),
  });
  assertEquals(first.dealTermsHash, second.dealTermsHash);
});

Deno.test("deal terms hash changes when a recipient or economic term changes", async () => {
  const base = await computeDealTermsHash(snapshot());
  const changed = await computeDealTermsHash({
    ...snapshot(),
    policy: {
      ...snapshot().policy,
      sellerWallet: "0x5555555555555555555555555555555555555555",
    },
  });
  assertNotEquals(base.dealTermsHash, changed.dealTermsHash);
});

Deno.test("deal terms hash rejects unsafe numeric input and mismatched policy amount", async () => {
  await assertRejects(() => computeDealTermsHash({ ...snapshot(), amount: 100 as unknown as string }));
  await assertRejects(() => computeDealTermsHash({
    ...snapshot(),
    policy: { ...snapshot().policy, dealAmount: "99" },
  }));
});
