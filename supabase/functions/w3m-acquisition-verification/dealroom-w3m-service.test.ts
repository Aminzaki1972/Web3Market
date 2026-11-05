import { assertEquals } from "jsr:@std/assert@1";
import {
  checkDealRoomWithW3M,
  type DealRoomW3MServiceInput,
} from "./dealroom-w3m-service.ts";
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

Deno.test("Deal Room W3M service computes terms and blocks when no report exists", async () => {
  const input: DealRoomW3MServiceInput = {
    client: client(),
    terms: {
      dealId: "deal-service-1",
      projectId: "project-service-1",
      buyerId: "buyer-service-1",
      sellerId: "seller-service-1",
      amount: "100",
      currency: "USDT",
      expectedAmount: "100",
      chainId: 56,
      safeAddress: "0x2222222222222222222222222222222222222222",
      tokenContract: "0x3333333333333333333333333333333333333333",
      policy: {
        dealAmount: "100",
        feePercent: "7.5",
        feeAmount: "7.5",
        sellerNetAmount: "92.5",
        chainId: 56,
        safeAddress: "0x2222222222222222222222222222222222222222",
        tokenContract: "0x3333333333333333333333333333333333333333",
        sellerWallet: "0x4444444444444444444444444444444444444444",
        platformWallet: "0x2B15cC63eE3b833F502C065767695Fa2B584f8c9",
        safeNonce: "7",
        status: "locked",
      },
    },
    stage: "PREPARE",
    now: "2026-11-06T20:00:00.000Z",
    paymentConfirmed: true,
    deliveryAccepted: true,
    disputeOpen: false,
    safeConfigurationMatches: true,
    releaseAlreadyFinalized: false,
  };
  const result = await checkDealRoomWithW3M(input);
  assertEquals(result.authorized, false);
  assertEquals(result.dealTermsHash.length, 64);
  assertEquals(result.reportVerificationIssues.includes("REPORT_ROW_INVALID"), true);
});
