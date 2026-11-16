import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  getW3MCanonicalSettlement,
  assertW3MSettlementPolicyMatches,
  W3MSettlementEvidenceError,
} from "./w3m-v1-settlement-evidence.ts";

const dealId = "71000000-0000-4000-8000-000000000001";
const hash = "a".repeat(64);
function payload(overrides: Record<string, unknown> = {}) {
  return {
    deal_id: dealId,
    terms_version: 1,
    terms_hash: hash,
    canonical_terms_json: {
      schema: "w3m-acquisition-terms-v1",
      terms_version: "1",
      consideration: { amount: "1000.00", currency: "USDT" },
      platform_fee: { percent: "7.50", amount: "75.00" },
      seller_net: { amount: "925.00", currency: "USDT" },
      payment: {
        method: "safe_multisig",
        chain_id: 56,
        asset: "USDT",
        token_contract: null,
      },
      safe_settlement: { method: "safe_multisig", dispute_hold: true },
      ...overrides,
    },
  };
}
function client(data: unknown) {
  return {
    rpc: async () => ({ data, error: null }),
  };
}

Deno.test("loads only a valid current signed BNB USDT settlement snapshot", async () => {
  const settlement = await getW3MCanonicalSettlement(client(payload()), dealId);
  assertEquals(settlement.considerationAmount, "1000.00");
  assertEquals(settlement.feeAmount, "75.00");
  assertEquals(settlement.sellerNetAmount, "925.00");
  assertEquals(settlement.currency, "USDT");
});

Deno.test("rejects a fee that is not 7.5 percent of final consideration", async () => {
  const invalid = payload({
    platform_fee: { percent: "7.50", amount: "70.00" },
  });
  await assertRejects(
    () => getW3MCanonicalSettlement(client(invalid), dealId),
    W3MSettlementEvidenceError,
    "do not reconcile",
  );
});

Deno.test("rejects a non-USDT or non-Safe settlement route", async () => {
  const invalid = payload({
    payment: { method: "escrow_contract", chain_id: 56, asset: "USDT", token_contract: null },
  });
  await assertRejects(
    () => getW3MCanonicalSettlement(client(invalid), dealId),
    W3MSettlementEvidenceError,
    "not supported",
  );
});

Deno.test("rejects release policies that differ from the exact signed snapshot", async () => {
  const settlement = await getW3MCanonicalSettlement(client(payload()), dealId);
  let error: unknown;
  try {
    assertW3MSettlementPolicyMatches(settlement, {
      deal_amount: "1000.00",
      fee_percent: 7.5,
      fee_amount: "74.00",
      seller_net_amount: "926.00",
      token_contract: "0x55d398326f99059ff775485246999027b3197955",
      chain_id: 56,
    });
  } catch (caught) {
    error = caught;
  }
  assertEquals(error instanceof W3MSettlementEvidenceError, true);
});
