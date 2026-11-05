import { decodeSafeMultiSendCalldata } from "./safe-multisend-decoder.ts";
import { validateSafeReleasePayload } from "./safe-payload-validator.ts";
import { validateStoredSafeReleaseTransaction } from "./safe-release-transaction-adapter.ts";
import { evaluateSafeExecutionGuard, type SafeExecutionGuardInput } from "./safe-execution-guard.ts";

const SAFE = "0x1111111111111111111111111111111111111111";
const MULTISEND = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const SELLER = "0x4444444444444444444444444444444444444444";
const PLATFORM = "0x5555555555555555555555555555555555555555";
const SELLER_NET = "9250000000000000000";
const FEE = "750000000000000000";
const TOTAL = "10000000000000000000";

function word(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}
function transfer(recipient: string, amount: bigint): string {
  return "a9059cbb" + recipient.slice(2).toLowerCase().padStart(64, "0") + word(amount);
}
function packedCall(to: string, data: string, operation = 0, value = 0n): string {
  return operation.toString(16).padStart(2, "0") + to.slice(2).toLowerCase() +
    word(value) + word(BigInt(data.length / 2)) + data;
}
function multisend(calls: string[]): string {
  const body = calls.join("");
  const bytes = body.length / 2;
  return "0x8d80ff0a" + word(32n) + word(BigInt(bytes)) +
    body.padEnd(Math.ceil(bytes / 32) * 64, "0");
}
function runPipeline(calldata: string) {
  const decoded = decodeSafeMultiSendCalldata(calldata);
  if (!decoded.valid) return { valid: false, issues: decoded.issues };
  return validateSafeReleasePayload({
    chainId: 56,
    safeAddress: SAFE,
    expectedSafeAddress: SAFE,
    outerTo: MULTISEND,
    expectedMultiSendCallOnly: MULTISEND,
    outerOperation: 1,
    outerValue: "0",
    tokenAddress: TOKEN,
    expectedTokenAddress: TOKEN,
    sellerWallet: SELLER,
    platformWallet: PLATFORM,
    sellerNetAmount: SELLER_NET,
    platformFeeAmount: FEE,
    dealAmount: TOTAL,
    calls: decoded.calls,
  });
}
function assert(ok: boolean, message: string) {
  if (!ok) throw new Error(message);
}

Deno.test("full calldata pipeline accepts exact seller and platform transfers", () => {
  const calldata = multisend([
    packedCall(TOKEN, transfer(SELLER, BigInt(SELLER_NET))),
    packedCall(TOKEN, transfer(PLATFORM, BigInt(FEE))),
  ]);
  const result = runPipeline(calldata);
  assert(result.valid, JSON.stringify(result.issues));
});

Deno.test("full calldata pipeline rejects an attacker-controlled seller recipient", () => {
  const attacker = "0x6666666666666666666666666666666666666666";
  const calldata = multisend([
    packedCall(TOKEN, transfer(attacker, BigInt(SELLER_NET))),
    packedCall(TOKEN, transfer(PLATFORM, BigInt(FEE))),
  ]);
  const result = runPipeline(calldata);
  assert(!result.valid, "attacker recipient was accepted");
  assert(result.issues.includes("EXACT_SELLER_TRANSFER_MISSING_OR_DUPLICATED"), JSON.stringify(result.issues));
});

Deno.test("full calldata pipeline rejects any extra approval call", () => {
  const approve = "095ea7b3" + word(0n) + word(1n);
  const calldata = multisend([
    packedCall(TOKEN, transfer(SELLER, BigInt(SELLER_NET))),
    packedCall(TOKEN, transfer(PLATFORM, BigInt(FEE))),
    packedCall(TOKEN, approve),
  ]);
  const result = runPipeline(calldata);
  assert(!result.valid, "extra approval call was accepted");
});

Deno.test("full calldata pipeline rejects unexpected inner delegatecall", () => {
  const calldata = multisend([
    packedCall(TOKEN, transfer(SELLER, BigInt(SELLER_NET)), 1),
    packedCall(TOKEN, transfer(PLATFORM, BigInt(FEE))),
  ]);
  const result = runPipeline(calldata);
  assert(!result.valid && result.issues.includes("INNER_OPERATION_MUST_BE_CALL"), JSON.stringify(result.issues));
});

Deno.test("full calldata pipeline rejects malformed calldata before semantic validation", () => {
  const result = runPipeline("0x8d80ff0a" + word(64n) + word(0n));
  assert(!result.valid && result.issues.includes("ABI_OFFSET_INVALID"), JSON.stringify(result.issues));
});


function storedRow(data: string, overrides: Record<string, unknown> = {}) {
  return {
    safe_address: SAFE,
    chain_id: 56,
    to_address: MULTISEND,
    data,
    value_wei: "0",
    operation: 1,
    ...overrides,
  };
}
const storedPolicy = {
  expectedSafeAddress: SAFE,
  expectedMultiSendCallOnly: MULTISEND,
  expectedTokenAddress: TOKEN,
  sellerWallet: SELLER,
  platformWallet: PLATFORM,
  sellerNetAmount: SELLER_NET,
  platformFeeAmount: FEE,
  dealAmount: TOTAL,
};

Deno.test("stored Safe row adapter validates exact calldata, chain and release policy", () => {
  const data = multisend([
    packedCall(TOKEN, transfer(SELLER, BigInt(SELLER_NET))),
    packedCall(TOKEN, transfer(PLATFORM, BigInt(FEE))),
  ]);
  const result = validateStoredSafeReleaseTransaction(storedRow(data), storedPolicy);
  assert(result.valid && result.decodedCallCount === 2, JSON.stringify(result));
});

Deno.test("stored Safe row adapter rejects altered seller recipient in persisted calldata", () => {
  const attacker = "0x6666666666666666666666666666666666666666";
  const data = multisend([
    packedCall(TOKEN, transfer(attacker, BigInt(SELLER_NET))),
    packedCall(TOKEN, transfer(PLATFORM, BigInt(FEE))),
  ]);
  const result = validateStoredSafeReleaseTransaction(storedRow(data), storedPolicy);
  assert(!result.valid && result.issues.includes("EXACT_SELLER_TRANSFER_MISSING_OR_DUPLICATED"), JSON.stringify(result));
});

Deno.test("stored Safe row adapter rejects wrong chain before execution", () => {
  const data = multisend([
    packedCall(TOKEN, transfer(SELLER, BigInt(SELLER_NET))),
    packedCall(TOKEN, transfer(PLATFORM, BigInt(FEE))),
  ]);
  const result = validateStoredSafeReleaseTransaction(storedRow(data, { chain_id: 97 }), storedPolicy);
  assert(!result.valid && result.issues.includes("CHAIN_NOT_APPROVED"), JSON.stringify(result));
});

Deno.test("stored Safe row adapter rejects malformed MultiSend selector", () => {
  const result = validateStoredSafeReleaseTransaction(storedRow("0x12345678"), storedPolicy);
  assert(!result.valid && result.issues.includes("MULTISEND_DECODE_CALLDATA_TOO_SHORT_OR_UNALIGNED"), JSON.stringify(result));
});


const SAFE_HASH = "0x" + "a".repeat(64);
const OWNER_A = "0x6666666666666666666666666666666666666666";
const OWNER_B = "0x7777777777777777777777777777777777777777";
const REPORT_HASH = "a".repeat(64);
const EVIDENCE_HASH = "b".repeat(64);
const TERMS_HASH = "c".repeat(64);
function executionInput(overrides: Partial<SafeExecutionGuardInput> = {}) {
  const data = multisend([
    packedCall(TOKEN, transfer(SELLER, BigInt(SELLER_NET))),
    packedCall(TOKEN, transfer(PLATFORM, BigInt(FEE))),
  ]);
  return {
    settlement: {
      stage: "EXECUTE" as const,
      dealId: "deal-guard-001",
      projectId: "project-guard-001",
      now: "2026-11-06T12:00:00.000Z",
      report: {
        id: "report-guard-001",
        dealId: "deal-guard-001",
        projectId: "project-guard-001",
        status: "PASS",
        reportVersion: 1,
        issuedAt: "2026-11-06T11:00:00.000Z",
        expiresAt: "2026-11-06T13:00:00.000Z",
        evidenceHash: EVIDENCE_HASH,
        reportHash: REPORT_HASH,
        signerKeyId: "w3m-test-key",
        signature: "0x" + "8".repeat(130),
      },
      latestReportVersion: 1,
      isSuperseded: false,
      signatureValid: true,
      signerState: "ACTIVE" as const,
      recomputedEvidenceHash: EVIDENCE_HASH,
      currentDealTermsHash: TERMS_HASH,
      reportDealTermsHash: TERMS_HASH,
      paymentConfirmed: true,
      deliveryAccepted: true,
      disputeOpen: false,
      safeConfigurationMatches: true,
      releaseAlreadyFinalized: false,
    },
    transaction: storedRow(data),
    releasePolicy: storedPolicy,
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
    ...overrides,
  };
}
const validTestVerifier = async ({ signature, expectedAddress }: {
  digestHex: string; signature: string; expectedAddress: string;
}) => (signature === "0x" + "1".repeat(130) && expectedAddress === OWNER_A) ||
  (signature === "0x" + "2".repeat(130) && expectedAddress === OWNER_B);

Deno.test("unified execution guard authorizes only when report, payload, hash and signatures all pass", async () => {
  const result = await evaluateSafeExecutionGuard(executionInput(), validTestVerifier);
  assert(result.authorized, JSON.stringify(result));
  assert(result.signatureCount === 2, "both current Safe owners must be recovered");
});

Deno.test("unified execution guard rejects a Safe hash changed after signatures", async () => {
  const result = await evaluateSafeExecutionGuard(
    executionInput({ recomputedSafeTransactionHash: "0x" + "d".repeat(64) }),
    validTestVerifier,
  );
  assert(!result.authorized && result.issues.includes("SAFE_TRANSACTION_HASH_MISMATCH"), JSON.stringify(result.issues));
});

Deno.test("unified execution guard rejects signatures bound to another Safe hash", async () => {
  const base = executionInput();
  const signatures = { ...base.signatures, safeTransactionHash: "0x" + "e".repeat(64) };
  const result = await evaluateSafeExecutionGuard({ ...base, signatures }, validTestVerifier);
  assert(!result.authorized && result.issues.includes("SIGNATURES_NOT_BOUND_TO_STORED_SAFE_HASH"), JSON.stringify(result.issues));
});

Deno.test("unified execution guard rejects payload recipient substitution", async () => {
  const attacker = "0x8888888888888888888888888888888888888888";
  const base = executionInput();
  const badData = multisend([
    packedCall(TOKEN, transfer(attacker, BigInt(SELLER_NET))),
    packedCall(TOKEN, transfer(PLATFORM, BigInt(FEE))),
  ]);
  const result = await evaluateSafeExecutionGuard({
    ...base,
    transaction: storedRow(badData),
  }, validTestVerifier);
  assert(!result.authorized && result.issues.includes("SAFE_RELEASE_PAYLOAD_BLOCKED"), JSON.stringify(result.issues));
});

Deno.test("unified execution guard rejects a blocked settlement report", async () => {
  const base = executionInput();
  const settlement = { ...base.settlement, paymentConfirmed: false };
  const result = await evaluateSafeExecutionGuard({ ...base, settlement }, validTestVerifier);
  assert(!result.authorized && result.issues.includes("SETTLEMENT_GATE_BLOCKED"), JSON.stringify(result.issues));
});

Deno.test("unified execution guard cannot be used at PREPARE stage", async () => {
  const base = executionInput();
  const settlement = { ...base.settlement, stage: "PREPARE" as const };
  const result = await evaluateSafeExecutionGuard({ ...base, settlement }, validTestVerifier);
  assert(!result.authorized && result.issues.includes("EXECUTION_STAGE_REQUIRED"), JSON.stringify(result.issues));
});

Deno.test("unified execution guard rejects a cryptographically invalid signature set", async () => {
  const result = await evaluateSafeExecutionGuard(executionInput(), async () => false);
  assert(!result.authorized && result.issues.includes("SAFE_SIGNATURE_SET_BLOCKED"), JSON.stringify(result.issues));
});
