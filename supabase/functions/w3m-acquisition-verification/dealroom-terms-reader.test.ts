import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  checkDealRoomFromExactSnapshot,
  type DealRoomTermsSnapshotRow,
  type DealRoomTermsRpcClient,
} from "./dealroom-terms-reader.ts";
import type { W3MRegistryReadClient, W3MRegistryReadResult, W3MRegistrySelectQuery } from "./persisted-report-loader.ts";

const row: DealRoomTermsSnapshotRow = {
  deal_id: "deal-reader-1", deal_status: "funded", project_id: "project-1", buyer_id: "buyer-1", seller_id: "seller-1",
  project_owner_id: "seller-1", project_status: "active",
  buyer_wallet: "0x5555555555555555555555555555555555555555",
  buyer_wallet_verified: "true", buyer_wallet_verified_at: "2026-11-05T00:00:00Z",
  seller_wallet: "0x4444444444444444444444444444444444444444",
  seller_wallet_verified: "true", seller_wallet_verified_at: "2026-11-05T00:00:00Z",
  deal_amount: "100.00000000", currency: "USDT", expected_amount: "100.00000000",
  deal_chain_id: "56", deal_safe_address: "0x2222222222222222222222222222222222222222",
  deal_token_contract: "0x55d398326f99059ff775485246999027b3197955",
  payment_status: "confirmed", payment_tx_hash: "0x" + "a".repeat(64),
  delivery_status: "accepted", buyer_approved_at: "2026-11-06T19:00:00+00:00",
  dispute_status: "none", release_tx_hash: null,
  policy_deal_id: "deal-reader-1", policy_deal_amount: "100.00000000",
  policy_fee_percent: "7.5000", policy_fee_amount: "7.50000000",
  policy_seller_net_amount: "92.50000000", policy_chain_id: "56",
  policy_safe_address: "0x2222222222222222222222222222222222222222",
  policy_token_contract: "0x55d398326f99059ff775485246999027b3197955",
  policy_seller_wallet: "0x4444444444444444444444444444444444444444",
  policy_platform_wallet: "0x2B15cC63eE3b833F502C065767695Fa2B584f8c9",
  policy_safe_nonce: "7", policy_status: "locked",
};

function client(data: unknown, error: unknown = null): DealRoomTermsRpcClient & W3MRegistryReadClient {
  return {
    rpc() { return Promise.resolve({ data, error }); },
    from(table: string) {
      return {
        select() {
          const result: W3MRegistryReadResult = table === "w3m_acquisition_reports"
            ? { data: null, error: null }
            : { data: [], error: null };
          const query = {
            eq() { return query; }, order() { return query; }, limit() { return query; },
            maybeSingle() { return Promise.resolve(result); },
            then(onfulfilled?: ((value: W3MRegistryReadResult) => unknown) | null,
              onrejected?: ((reason: unknown) => unknown) | null) {
              return Promise.resolve(result).then(onfulfilled ?? undefined, onrejected ?? undefined);
            },
          };
          return query as unknown as W3MRegistrySelectQuery;
        },
      };
    },
  };
}

Deno.test("exact snapshot loader feeds exact financial text into the W3M gate", async () => {
  const result = await checkDealRoomFromExactSnapshot({
    client: client([row]), dealId: "deal-reader-1", stage: "PREPARE",
    now: "2026-11-06T20:00:00.000Z", safeFacts: {
      chainId: 56,
      safeAddress: "0x2222222222222222222222222222222222222222",
      owners: [
        "0x4444444444444444444444444444444444444444",
        "0x5555555555555555555555555555555555555555",
        "0x2B15cC63eE3b833F502C065767695Fa2B584f8c9",
      ],
      threshold: 2,
      version: "1.4.1",
      nonce: "7",
      expectedBuyerWallet: "0x5555555555555555555555555555555555555555",
      expectedSellerWallet: "0x4444444444444444444444444444444444444444",
    },
  });
  assertEquals(result.authorized, false);
  assertEquals(result.dealTermsHash.length, 64);
  assertEquals(result.reportVerificationIssues.includes("REPORT_ROW_INVALID"), true);
});

Deno.test("exact snapshot loader rejects missing policy", async () => {
  await assertRejects(() => checkDealRoomFromExactSnapshot({
    client: client([{ ...row, policy_deal_id: null }]), dealId: "deal-reader-1",
    stage: "PREPARE", now: "2026-11-06T20:00:00.000Z",
    safeFacts: {
      chainId: 56,
      safeAddress: "0x2222222222222222222222222222222222222222",
      owners: [
        "0x4444444444444444444444444444444444444444",
        "0x5555555555555555555555555555555555555555",
        "0x2B15cC63eE3b833F502C065767695Fa2B584f8c9",
      ],
      threshold: 2,
      version: "1.4.1",
      nonce: "7",
      expectedBuyerWallet: "0x5555555555555555555555555555555555555555",
      expectedSellerWallet: "0x4444444444444444444444444444444444444444",
    },
  }));
});

Deno.test("exact snapshot loader rejects ambiguous rows and RPC errors", async () => {
  await assertRejects(() => checkDealRoomFromExactSnapshot({
    client: client([row, row]), dealId: "deal-reader-1", stage: "PREPARE",
    now: "2026-11-06T20:00:00.000Z", safeFacts: {
      chainId: 56,
      safeAddress: "0x2222222222222222222222222222222222222222",
      owners: [
        "0x4444444444444444444444444444444444444444",
        "0x5555555555555555555555555555555555555555",
        "0x2B15cC63eE3b833F502C065767695Fa2B584f8c9",
      ],
      threshold: 2,
      version: "1.4.1",
      nonce: "7",
      expectedBuyerWallet: "0x5555555555555555555555555555555555555555",
      expectedSellerWallet: "0x4444444444444444444444444444444444444444",
    },
  }));
  await assertRejects(() => checkDealRoomFromExactSnapshot({
    client: client(null, new Error("denied")), dealId: "deal-reader-1",
    stage: "PREPARE", now: "2026-11-06T20:00:00.000Z",
    safeFacts: {
      chainId: 56,
      safeAddress: "0x2222222222222222222222222222222222222222",
      owners: [
        "0x4444444444444444444444444444444444444444",
        "0x5555555555555555555555555555555555555555",
        "0x2B15cC63eE3b833F502C065767695Fa2B584f8c9",
      ],
      threshold: 2,
      version: "1.4.1",
      nonce: "7",
      expectedBuyerWallet: "0x5555555555555555555555555555555555555555",
      expectedSellerWallet: "0x4444444444444444444444444444444444444444",
    },
  }));
});


Deno.test("exact snapshot reader blocks live Safe chain, nonce, and owner mismatches", async () => {
  const baseFacts = {
    chainId: 56,
    safeAddress: "0x2222222222222222222222222222222222222222",
    owners: [
      "0x4444444444444444444444444444444444444444",
      "0x5555555555555555555555555555555555555555",
      "0x2B15cC63eE3b833F502C065767695Fa2B584f8c9",
    ],
    threshold: 2,
    version: "1.4.1",
    nonce: "7",
    expectedBuyerWallet: "0x5555555555555555555555555555555555555555",
    expectedSellerWallet: "0x4444444444444444444444444444444444444444",
  };
  const variants = [
    { ...baseFacts, chainId: 97 },
    { ...baseFacts, nonce: "8" },
    { ...baseFacts, owners: [baseFacts.owners[0], baseFacts.owners[0], baseFacts.owners[2]] },
    { ...baseFacts, threshold: 1 },
    { ...baseFacts, version: "1.3.0" },
  ];
  for (const safeFacts of variants) {
    const result = await checkDealRoomFromExactSnapshot({
      client: client([row]),
      dealId: "deal-reader-1",
      stage: "PREPARE",
      now: "2026-11-06T20:00:00.000Z",
      safeFacts,
    });
    assertEquals(
      result.decision.issues.some((issue) => issue.code === "SAFE_CONFIGURATION_MISMATCH"),
      true,
    );
  }
});
