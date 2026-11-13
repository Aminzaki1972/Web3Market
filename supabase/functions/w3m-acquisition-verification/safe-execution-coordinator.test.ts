import {
  executeW3MSafeRelease,
  type SafeExecutionFreshSnapshot,
  type SafeExecutionCoordinatorDependencies,
} from "./safe-execution-coordinator.ts";
import type { SafeExecutionGuardInput } from "./safe-execution-guard.ts";

const SAFE = "0x1111111111111111111111111111111111111111";
const MULTISEND = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const SELLER = "0x4444444444444444444444444444444444444444";
const PLATFORM = "0x5555555555555555555555555555555555555555";
const OWNER_A = "0x6666666666666666666666666666666666666666";
const OWNER_B = "0x7777777777777777777777777777777777777777";
const SAFE_HASH = "0x" + "a".repeat(64);
const SELLER_NET = "9250000000000000000";
const FEE = "750000000000000000";
const TOTAL = "10000000000000000000";

function word(value: bigint): string { return value.toString(16).padStart(64, "0"); }
function transfer(recipient: string, amount: bigint): string {
  return "a9059cbb" + recipient.slice(2).toLowerCase().padStart(64, "0") + word(amount);
}
function packedCall(to: string, data: string): string {
  return "00" + to.slice(2).toLowerCase() + word(0n) + word(BigInt(data.length / 2)) + data;
}
function multisend(calls: string[]): string {
  const body = calls.join("");
  const bytes = body.length / 2;
  return "0x8d80ff0a" + word(32n) + word(BigInt(bytes)) +
    body.padEnd(Math.ceil(bytes / 32) * 64, "0");
}

function snapshot(overrides: Partial<SafeExecutionFreshSnapshot> = {}): SafeExecutionFreshSnapshot {
  const data = multisend([
    packedCall(TOKEN, transfer(SELLER, BigInt(SELLER_NET))),
    packedCall(TOKEN, transfer(PLATFORM, BigInt(FEE))),
  ]);
  const guardInput: SafeExecutionGuardInput = {
    settlement: {
      stage: "EXECUTE",
      dealId: "deal-001",
      projectId: "project-001",
      now: "2026-11-06T12:00:00.000Z",
      report: {
        id: "report-001",
        dealId: "deal-001",
        projectId: "project-001",
        status: "PASS",
        reportVersion: 1,
        issuedAt: "2026-11-06T11:00:00.000Z",
        expiresAt: "2026-11-06T13:00:00.000Z",
        evidenceHash: "b".repeat(64),
        reportHash: "c".repeat(64),
        signerKeyId: "key-001",
        signature: "0x" + "8".repeat(130),
      },
      latestReportVersion: 1,
      isSuperseded: false,
      signatureValid: true,
      signerState: "ACTIVE",
      recomputedEvidenceHash: "b".repeat(64),
      currentDealTermsHash: "d".repeat(64),
      reportDealTermsHash: "d".repeat(64),
      paymentConfirmed: true,
      deliveryAccepted: true,
      disputeOpen: false,
      safeConfigurationMatches: true,
      releaseAlreadyFinalized: false,
    },
    transaction: {
      deal_id: "deal-001",
      action: "release_to_seller",
      safe_tx_hash: SAFE_HASH,
      safe_address: SAFE,
      chain_id: 56,
      to_address: MULTISEND,
      data,
      value_wei: "0",
      operation: 1,
    },
    releasePolicy: {
      expectedDealId: "deal-001",
      expectedSafeAddress: SAFE,
      expectedMultiSendCallOnly: MULTISEND,
      expectedTokenAddress: TOKEN,
      sellerWallet: SELLER,
      platformWallet: PLATFORM,
      sellerNetAmount: SELLER_NET,
      platformFeeAmount: FEE,
      dealAmount: TOTAL,
    },
    storedSafeTransactionHash: SAFE_HASH,
    recomputedSafeTransactionHash: SAFE_HASH,
    signatures: {
      safeTransactionHash: SAFE_HASH,
      currentOwners: [OWNER_A, OWNER_B],
      threshold: 2,
      storedSignatures: [
        { walletAddress: OWNER_A, signature: "0x" + "1".repeat(130), signatureStatus: "signed" },
        { walletAddress: OWNER_B, signature: "0x" + "2".repeat(130), signatureStatus: "signed" },
      ],
    },
  };
  return {
    dealId: "deal-001",
    transactionId: "transaction-001",
    reportId: "report-001",
    reportVersion: 1,
    executorRef: "w3m-executor-v1",
    idempotencyKey: "w3m-deal-001-execute-v1",
    agreementBinding: {
      termsVersionId: "81000000-0000-4000-8000-000000000001",
      termsVersion: "3",
      termsHash: "f".repeat(64),
      buyerAcceptanceId: "82000000-0000-4000-8000-000000000002",
      sellerAcceptanceId: "83000000-0000-4000-8000-000000000003",
      buyerDigest: "0x" + "4".repeat(64),
      sellerDigest: "0x" + "5".repeat(64),
    },
    guardInput,
    ...overrides,
  };
}

function deps(overrides: Partial<SafeExecutionCoordinatorDependencies> = {}) {
  const calls: string[] = [];
  const fresh = snapshot();
  let loads = 0;
  const base: SafeExecutionCoordinatorDependencies = {
    loadFresh: async () => { calls.push("load"); loads++; return fresh; },
    claim: async () => {
      calls.push("claim");
      return { attemptId: "attempt-001", state: "CLAIMED", claimed: true, idempotentReplay: false };
    },
    broadcast: async () => { calls.push("broadcast"); return { transactionHash: "0x" + "e".repeat(64) }; },
    recordBroadcast: async () => { calls.push("record"); return { recorded: true, idempotentReplay: false, state: "BROADCAST" as const }; },
    markReconciliationRequired: async () => { calls.push("reconcile"); return { updated: true, idempotentReplay: false, state: "RECONCILIATION_REQUIRED" as const }; },
    verifySignature: async () => true,
  };
  return { dependencies: { ...base, ...overrides }, calls, fresh, getLoads: () => loads };
}

function assert(ok: boolean, message: string) { if (!ok) throw new Error(message); }

Deno.test("EXECUTE performs fresh authorization, atomic claim, reauthorization, then one broadcast and records its hash", async () => {
  const h = deps();
  const result = await executeW3MSafeRelease(h.dependencies);
  assert(result.state === "BROADCAST_RECORDED", JSON.stringify(result));
  assert(h.calls.join(",") === "load,claim,load,broadcast,record", h.calls.join(","));
  assert(h.getLoads() === 2, "must load fresh state twice");
});

Deno.test("initial W3M failure blocks claim and broadcast", async () => {
  const h = deps({
    loadFresh: async () => {
      const value = snapshot();
      value.guardInput.settlement.paymentConfirmed = false;
      return value;
    },
  });
  const result = await executeW3MSafeRelease(h.dependencies);
  assert(result.state === "BLOCKED", JSON.stringify(result));
  assert(!h.calls.includes("claim") && !h.calls.includes("broadcast"), h.calls.join(","));
});

Deno.test("idempotent claim replay never broadcasts and is sent to reconciliation", async () => {
  const h = deps({
    claim: async () => ({
      attemptId: "attempt-existing",
      state: "CLAIMED",
      claimed: true,
      idempotentReplay: true,
    }),
  });
  const result = await executeW3MSafeRelease(h.dependencies);
  assert(result.state === "RECONCILIATION_REQUIRED", JSON.stringify(result));
  assert(!h.calls.includes("broadcast"), h.calls.join(","));
  assert(h.calls.includes("reconcile"), h.calls.join(","));
});

Deno.test("changed report binding after claim blocks broadcast", async () => {
  let loads = 0;
  const h = deps({
    loadFresh: async () => {
      loads++;
      const value = snapshot();
      if (loads === 2) {
        value.reportId = "report-002";
        value.guardInput.settlement.report!.id = "report-002";
      }
      return value;
    },
  });
  const result = await executeW3MSafeRelease(h.dependencies);
  assert(result.state === "RECONCILIATION_REQUIRED", JSON.stringify(result));
  assert(!h.calls.includes("broadcast"), h.calls.join(","));
  assert(h.calls.includes("reconcile"), h.calls.join(","));
});

Deno.test("pre-broadcast fresh-state outage never broadcasts", async () => {
  let loads = 0;
  const h = deps({
    loadFresh: async () => {
      loads++;
      if (loads === 2) throw new Error("database unavailable");
      return snapshot();
    },
  });
  const result = await executeW3MSafeRelease(h.dependencies);
  assert(result.state === "RECONCILIATION_REQUIRED", JSON.stringify(result));
  assert(!h.calls.includes("broadcast"), h.calls.join(","));
});

Deno.test("uncertain broadcast failure is quarantined and never retried", async () => {
  const h = deps({ broadcast: async () => { h.calls.push("broadcast"); throw new Error("timeout"); } });
  const result = await executeW3MSafeRelease(h.dependencies);
  assert(result.state === "RECONCILIATION_REQUIRED", JSON.stringify(result));
  assert(!h.calls.includes("record"), h.calls.join(","));
  assert(h.calls.includes("reconcile"), h.calls.join(","));
});

Deno.test("invalid broadcast hash is not persisted and requires reconciliation", async () => {
  const h = deps({ broadcast: async () => ({ transactionHash: "not-a-hash" }) });
  const result = await executeW3MSafeRelease(h.dependencies);
  assert(result.state === "RECONCILIATION_REQUIRED", JSON.stringify(result));
  assert(!h.calls.includes("record"), h.calls.join(","));
});

Deno.test("broadcast hash persistence failure leaves attempt in reconciliation", async () => {
  const h = deps({ recordBroadcast: async () => { h.calls.push("record"); throw new Error("write failed"); } });
  const result = await executeW3MSafeRelease(h.dependencies);
  assert(result.state === "RECONCILIATION_REQUIRED", JSON.stringify(result));
  assert(h.calls.includes("reconcile"), h.calls.join(","));
});


Deno.test("malformed execution claim response is rejected before broadcast", async () => {
  const h = deps({
    claim: async () => ({
      attemptId: "attempt-001",
      state: "CLAIMED",
      claimed: true,
      idempotentReplay: undefined as unknown as boolean,
    }),
  });
  const result = await executeW3MSafeRelease(h.dependencies);
  assert(result.state === "BLOCKED", JSON.stringify(result));
  assert(!h.calls.includes("broadcast"), h.calls.join(","));
});

Deno.test("broadcast is not reported recorded when persistence RPC response is malformed", async () => {
  const h = deps({
    recordBroadcast: async () => ({
      recorded: false,
      idempotentReplay: false,
      state: "BROADCAST" as const,
    }),
  });
  const result = await executeW3MSafeRelease(h.dependencies);
  assert(result.state === "RECONCILIATION_REQUIRED", JSON.stringify(result));
  assert(h.calls.includes("reconcile"), h.calls.join(","));
});

Deno.test("reconciliation is not reported persisted when its RPC response is malformed", async () => {
  let loads = 0;
  const h = deps({
    loadFresh: async () => {
      loads++;
      const value = snapshot();
      if (loads === 2) value.guardInput.settlement.paymentConfirmed = false;
      return value;
    },
    markReconciliationRequired: async () => ({
      updated: false,
      idempotentReplay: false,
      state: "RECONCILIATION_REQUIRED" as const,
    }),
  });
  const result = await executeW3MSafeRelease(h.dependencies);
  assert(result.state === "RECONCILIATION_REQUIRED", JSON.stringify(result));
  if (result.state === "RECONCILIATION_REQUIRED") {
    assert(result.reconciliationRecorded === false, JSON.stringify(result));
  }
  assert(!h.calls.includes("broadcast"), h.calls.join(","));
});


Deno.test("malformed initial snapshot fails closed without throwing or claiming", async () => {
  const h = deps({
    loadFresh: async () => snapshot({
      guardInput: undefined as unknown as SafeExecutionGuardInput,
    }),
  });
  const result = await executeW3MSafeRelease(h.dependencies);
  assert(result.state === "BLOCKED", JSON.stringify(result));
  assert(!h.calls.includes("claim") && !h.calls.includes("broadcast"), h.calls.join(","));
});

Deno.test("malformed pre-broadcast snapshot enters reconciliation without broadcasting", async () => {
  let loads = 0;
  const h = deps({
    loadFresh: async () => {
      loads++;
      if (loads === 1) return snapshot();
      return snapshot({ guardInput: undefined as unknown as SafeExecutionGuardInput });
    },
  });
  const result = await executeW3MSafeRelease(h.dependencies);
  assert(result.state === "RECONCILIATION_REQUIRED", JSON.stringify(result));
  assert(!h.calls.includes("broadcast"), h.calls.join(","));
  assert(h.calls.includes("reconcile"), h.calls.join(","));
});


Deno.test("changed EIP-712 agreement version or either party acceptance after claim blocks broadcast", async () => {
  let loads = 0;
  const h = deps({
    loadFresh: async () => {
      loads++;
      const value = snapshot();
      if (loads === 2) {
        value.agreementBinding!.sellerAcceptanceId = "84000000-0000-4000-8000-000000000004";
      }
      return value;
    },
  });
  const result = await executeW3MSafeRelease(h.dependencies);
  assert(result.state === "RECONCILIATION_REQUIRED", JSON.stringify(result));
  assert(!h.calls.includes("broadcast"), h.calls.join(","));
  assert(h.calls.includes("reconcile"), h.calls.join(","));
});

Deno.test("missing or malformed immutable agreement binding blocks before execution claim", async () => {
  const h = deps({
    loadFresh: async () => snapshot({
      agreementBinding: undefined as unknown as SafeExecutionFreshSnapshot["agreementBinding"],
    }),
  });
  const result = await executeW3MSafeRelease(h.dependencies);
  assert(result.state === "BLOCKED", JSON.stringify(result));
  assert(!h.calls.includes("claim") && !h.calls.includes("broadcast"), h.calls.join(","));
});

Deno.test("evidence manifest changed by append-first race after claim blocks Safe broadcast", async () => {
  let loads = 0;
  const h = deps({
    loadFresh: async () => {
      loads++;
      const value = snapshot();
      if (loads === 2) {
        // The report identity and signed evidence hash are unchanged, but the
        // freshly rebuilt persisted manifest now includes an appended row.
        value.guardInput.settlement.recomputedEvidenceHash = "e".repeat(64);
      }
      return value;
    },
  });
  const result = await executeW3MSafeRelease(h.dependencies);
  assert(result.state === "RECONCILIATION_REQUIRED", JSON.stringify(result));
  assert(h.calls.join(",") === "load,claim,load,reconcile", h.calls.join(","));
  assert(!h.calls.includes("broadcast"), "changed persisted evidence must never reach Safe broadcast");
});
