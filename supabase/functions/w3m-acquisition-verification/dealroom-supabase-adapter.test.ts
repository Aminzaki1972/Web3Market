import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  evaluateDealRoomRowsWithW3M,
  type DealRoomDealRow,
  type DealRoomPolicyRow,
} from "./dealroom-supabase-adapter.ts";
import type { W3MRegistryReadClient, W3MRegistryReadResult, W3MRegistrySelectQuery } from "./persisted-report-loader.ts";

function client(): W3MRegistryReadClient {
  return {
    from(table: string) {
      return {
        select() {
          const result: W3MRegistryReadResult = table === "w3m_acquisition_reports"
            ? { data: null, error: null }
            : { data: [], error: null };
          const query = {
            eq() { return query; },
            order() { return query; },
            limit() { return query; },
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

const deal: DealRoomDealRow = {
  id: "deal-1", project_id: "project-1", buyer_id: "buyer-1", seller_id: "seller-1",
  amount: "100", currency: "USDT", expected_amount: "100", chain_id: 56,
  safe_address: "0x2222222222222222222222222222222222222222",
  token_contract: "0x3333333333333333333333333333333333333333",
  payment_status: "confirmed", payment_tx_hash: "0x" + "a".repeat(64),
  delivery_status: "accepted", buyer_approved_at: "2026-11-06T19:00:00.000Z",
  dispute_status: "none", release_tx_hash: null,
};
const policy: DealRoomPolicyRow = {
  deal_id: "deal-1", deal_amount: "100", fee_percent: "7.5", fee_amount: "7.5",
  seller_net_amount: "92.5", chain_id: 56,
  safe_address: "0x2222222222222222222222222222222222222222",
  token_contract: "0x3333333333333333333333333333333333333333",
  seller_wallet: "0x4444444444444444444444444444444444444444",
  platform_wallet: "0x2B15cC63eE3b833F502C065767695Fa2B584f8c9",
  safe_nonce: 7, status: "locked",
};

Deno.test("strict Deal Room adapter passes exact text rows to the W3M gate and fails closed without report", async () => {
  const result = await evaluateDealRoomRowsWithW3M({
    client: client(), deal, policy, stage: "PREPARE",
    now: "2026-11-06T20:00:00.000Z", safeConfigurationMatches: true,
  });
  assertEquals(result.authorized, false);
  assertEquals(result.reportVerificationIssues.includes("REPORT_ROW_INVALID"), true);
  assertEquals(result.dealTermsHash.length, 64);
});

Deno.test("strict Deal Room adapter rejects floating-point financial fields", async () => {
  await assertRejects(() => evaluateDealRoomRowsWithW3M({
    client: client(), deal: { ...deal, amount: 100 }, policy, stage: "PREPARE",
    now: "2026-11-06T20:00:00.000Z", safeConfigurationMatches: true,
  }));
});

Deno.test("strict Deal Room adapter rejects non-none dispute states", async () => {
  await assertRejects(() => evaluateDealRoomRowsWithW3M({
    client: client(), deal: { ...deal, dispute_status: "resolved" }, policy, stage: "PREPARE",
    now: "2026-11-06T20:00:00.000Z", safeConfigurationMatches: true,
  }));
});

Deno.test("strict Deal Room adapter rejects policy rows belonging to another deal", async () => {
  await assertRejects(() => evaluateDealRoomRowsWithW3M({
    client: client(), deal, policy: { ...policy, deal_id: "deal-2" }, stage: "PREPARE",
    now: "2026-11-06T20:00:00.000Z", safeConfigurationMatches: true,
  }));
});
