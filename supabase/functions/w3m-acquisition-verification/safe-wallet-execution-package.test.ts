import {
  buildSafeWalletExecutionPackage,
  type BuildSafeWalletExecutionPackageInput,
} from "./safe-wallet-execution-package.ts";
import type { SafeExecutionFreshSnapshot } from "./safe-execution-coordinator.ts";

const SAFE = "0x1111111111111111111111111111111111111111";
const MULTISEND = "0x9641d764fc13c8b624c04430c7356c1c7c8102e2";
const TOKEN = "0x55d398326f99059ff775485246999027b3197955";
const SELLER = "0x4444444444444444444444444444444444444444";
const PLATFORM = "0x2b15cc63ee3b833f502c065767695fa2b584f8c9";
const OWNER_A = "0x6666666666666666666666666666666666666666";
const OWNER_B = "0x7777777777777777777777777777777777777777";
const HASH = "0x" + "a".repeat(64);
const SELLER_NET = 9250000000000000000n;
const FEE = 750000000000000000n;

function word(value: bigint): string { return value.toString(16).padStart(64, "0"); }
function transfer(recipient: string, amount: bigint): string {
  return "a9059cbb" + recipient.slice(2).toLowerCase().padStart(64, "0") + word(amount);
}
function packedCall(to: string, data: string): string {
  return "00" + to.slice(2).toLowerCase() + word(0n) + word(BigInt(data.length / 2)) + data;
}
function multisend(calls: string[]): string {
  const body = calls.join("");
  return "0x8d80ff0a" + word(32n) + word(BigInt(body.length / 2)) +
    body.padEnd(Math.ceil(body.length / 64) * 64, "0");
}
function snapshot(): SafeExecutionFreshSnapshot {
  const data = multisend([
    packedCall(TOKEN, transfer(SELLER, SELLER_NET)),
    packedCall(TOKEN, transfer(PLATFORM, FEE)),
  ]);
  return {
    dealId: "81000000-0000-4000-8000-000000000001",
    transactionId: "82000000-0000-4000-8000-000000000002",
    reportId: "83000000-0000-4000-8000-000000000003",
    reportVersion: 1,
    executorRef: "w3m-executor-v1",
    executorWallet: OWNER_A,
    idempotencyKey: "w3m-deal-001-execute-v1",
    agreementBinding: {
      termsVersionId: "84000000-0000-4000-8000-000000000004",
      termsVersion: "1",
      termsHash: "f".repeat(64),
      buyerAcceptanceId: "85000000-0000-4000-8000-000000000005",
      sellerAcceptanceId: "86000000-0000-4000-8000-000000000006",
      buyerDigest: "0x" + "1".repeat(64),
      sellerDigest: "0x" + "2".repeat(64),
    },
    guardInput: {
      settlement: {
        stage: "EXECUTE",
        dealId: "81000000-0000-4000-8000-000000000001",
        projectId: "87000000-0000-4000-8000-000000000007",
        now: "2026-11-06T12:00:00.000Z",
        report: {
          id: "83000000-0000-4000-8000-000000000003",
          dealId: "81000000-0000-4000-8000-000000000001",
          projectId: "87000000-0000-4000-8000-000000000007",
          status: "PASS",
          reportVersion: 1,
          issuedAt: "2026-11-06T11:00:00.000Z",
          expiresAt: "2026-11-06T13:00:00.000Z",
          evidenceHash: "b".repeat(64),
          reportHash: "c".repeat(64),
          signerKeyId: "trusted-key-1",
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
        deal_id: "81000000-0000-4000-8000-000000000001",
        action: "release_to_seller",
        safe_tx_hash: HASH,
        safe_address: SAFE,
        chain_id: 56,
        to_address: MULTISEND,
        data,
        value_wei: "0",
        operation: 1,
        safe_tx_gas: "0",
        base_gas: "0",
        gas_price: "0",
        gas_token: "0x0000000000000000000000000000000000000000",
        refund_receiver: "0x0000000000000000000000000000000000000000",
        safe_nonce: "7",
      } as unknown as SafeExecutionFreshSnapshot["guardInput"]["transaction"],
      releasePolicy: {
        expectedDealId: "81000000-0000-4000-8000-000000000001",
        expectedSafeAddress: SAFE,
        expectedMultiSendCallOnly: MULTISEND,
        expectedTokenAddress: TOKEN,
        sellerWallet: SELLER,
        platformWallet: PLATFORM,
        sellerNetAmount: SELLER_NET.toString(),
        platformFeeAmount: FEE.toString(),
        dealAmount: "10000000000000000000",
      },
      storedSafeTransactionHash: HASH,
      recomputedSafeTransactionHash: HASH,
      signatures: {
        safeTransactionHash: HASH,
        currentOwners: [OWNER_A, OWNER_B],
        threshold: 2,
        storedSignatures: [
          { walletAddress: OWNER_B, signature: "0x" + "2".repeat(130), signatureStatus: "signed" },
          { walletAddress: OWNER_A, signature: "0x" + "1".repeat(130), signatureStatus: "signed" },
        ],
      },
    },
  };
}
function facts() {
  return {
    valid: true,
    chainId: 56,
    safeAddress: SAFE,
    owners: [OWNER_A, OWNER_B],
    threshold: 2,
    nonce: "7",
    version: "1.3.0",
    recomputedSafeTransactionHash: HASH,
    issues: [],
    readBlockNumber: "90000000",
    readBlockHash: "0x" + "9".repeat(64),
  };
}
function assert(ok: boolean, message: string) { if (!ok) throw new Error(message); }
const input = (): BuildSafeWalletExecutionPackageInput => ({
  snapshot: snapshot(),
  liveFacts: facts(),
  issuedAt: "2026-11-06T12:00:00.000Z",
  expiresAt: "2026-11-06T12:01:30.000Z",
  verifySignature: async () => true,
});

Deno.test("builds exact BNB Safe wallet package with owner-sorted verified signatures", async () => {
  const result = await buildSafeWalletExecutionPackage(input());
  assert(result.chainId === 56, "chain must be BNB");
  assert(result.safeTransactionHash === HASH, "must bind exact Safe hash");
  assert(result.call.nonce === "7", "must bind current nonce");
  assert(result.buyerAcceptanceId === snapshot().agreementBinding?.buyerAcceptanceId, "must bind exact buyer acceptance");
  assert(result.sellerAcceptanceId === snapshot().agreementBinding?.sellerAcceptanceId, "must bind exact seller acceptance");
  assert(result.buyerAcceptanceDigest === snapshot().agreementBinding?.buyerDigest, "must bind buyer EIP-712 digest");
  assert(result.sellerAcceptanceDigest === snapshot().agreementBinding?.sellerDigest, "must bind seller EIP-712 digest");
  assert(result.signatures.length === 2, "must include threshold signatures");
  assert(result.signatures[0].signerAddress.toLowerCase() === OWNER_A.toLowerCase(), "signatures must be owner sorted");
  assert(result.signatures[1].signerAddress.toLowerCase() === OWNER_B.toLowerCase(), "second owner signature missing");
  assert(result.call.to === MULTISEND && result.call.value === "0" && result.call.operation === 1, "Safe release fields must be exact");
});

Deno.test("blocks a stale or non-canonical BNB Safe snapshot", async () => {
  const value = input();
  value.liveFacts = { ...facts(), valid: false, issues: ["SAFE_READ_BLOCK_NOT_CANONICAL"] };
  let blocked = false;
  try { await buildSafeWalletExecutionPackage(value); } catch { blocked = true; }
  assert(blocked, "non-canonical live facts must block package");
});

Deno.test("blocks changed Safe owner set, threshold, or nonce", async () => {
  for (const changed of [
    { ...facts(), owners: [OWNER_A] },
    { ...facts(), threshold: 1 },
    { ...facts(), nonce: "8" },
  ]) {
    const value = input();
    value.liveFacts = changed;
    let blocked = false;
    try { await buildSafeWalletExecutionPackage(value); } catch { blocked = true; }
    assert(blocked, "changed Safe state must block package");
  }
});

Deno.test("blocks missing immutable buyer or seller agreement binding", async () => {
  const value = input();
  value.snapshot.agreementBinding = undefined;
  let blocked = false;
  try { await buildSafeWalletExecutionPackage(value); } catch { blocked = true; }
  assert(blocked, "agreement binding is mandatory");
});

Deno.test("blocks failed signature recovery and changed Safe transaction hash", async () => {
  const invalidSignatures = input();
  invalidSignatures.verifySignature = async () => false;
  let signatureBlocked = false;
  try { await buildSafeWalletExecutionPackage(invalidSignatures); } catch { signatureBlocked = true; }
  assert(signatureBlocked, "invalid signatures must block package");

  const changedHash = input();
  changedHash.liveFacts = { ...facts(), recomputedSafeTransactionHash: "0x" + "b".repeat(64) };
  let hashBlocked = false;
  try { await buildSafeWalletExecutionPackage(changedHash); } catch { hashBlocked = true; }
  assert(hashBlocked, "changed Safe hash must block package");
});


Deno.test("blocks a package when the authenticated participant wallet is not a current Safe owner", async () => {
  const value = input();
  value.snapshot.executorWallet = SELLER;
  let blocked = false;
  try { await buildSafeWalletExecutionPackage(value); } catch { blocked = true; }
  assert(blocked, "non-owner authenticated wallet must not receive a package");
});
