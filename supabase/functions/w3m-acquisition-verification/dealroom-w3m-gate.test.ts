import { assertEquals } from "jsr:@std/assert@1";
import { evaluatePersistedW3MSettlementGate } from "./dealroom-w3m-gate.ts";

Deno.test("Deal Room settlement gate fails closed when the persisted report is missing", async () => {
  const result = await evaluatePersistedW3MSettlementGate({
    stage: "PREPARE",
    expectedDealId: "deal-1",
    expectedProjectId: "project-1",
    expectedBuyerId: "buyer-1",
    expectedSellerId: "seller-1",
    currentDealTermsHash: "a".repeat(64),
    latestReportVersion: null,
    now: "2026-11-06T20:00:00.000Z",
    reportRow: null,
    evidenceRows: [],
    trustedSignerRegistryRows: [],
    paymentConfirmed: true,
    deliveryAccepted: true,
    disputeOpen: false,
    safeConfigurationMatches: true,
    releaseAlreadyFinalized: false,
  });
  assertEquals(result.authorized, false);
  assertEquals(result.decision.authorized, false);
  assertEquals(result.decision.issues.some((issue) => issue.code === "PERSISTED_REPORT_INVALID"), true);
  assertEquals(result.reportVerificationIssues.includes("REPORT_ROW_INVALID"), true);
});

Deno.test("Deal Room settlement gate does not let a report PASS override missing payment", async () => {
  const result = await evaluatePersistedW3MSettlementGate({
    stage: "EXECUTE",
    expectedDealId: "deal-1",
    expectedProjectId: "project-1",
    expectedBuyerId: "buyer-1",
    expectedSellerId: "seller-1",
    currentDealTermsHash: "a".repeat(64),
    latestReportVersion: null,
    now: "2026-11-06T20:00:00.000Z",
    reportRow: null,
    evidenceRows: [],
    trustedSignerRegistryRows: [],
    paymentConfirmed: false,
    deliveryAccepted: true,
    disputeOpen: false,
    safeConfigurationMatches: true,
    releaseAlreadyFinalized: false,
  });
  assertEquals(result.authorized, false);
  assertEquals(result.decision.issues.some((issue) => issue.code === "PAYMENT_NOT_CONFIRMED"), true);
});
