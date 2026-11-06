// W3M Protocol V1 — pre-lock PREPARE gate for prepare-deal-release.
// This gate runs before release-policy upsert and pending Safe transaction writes.
// The validated policy values come from a service-role-only wrapper around the
// existing database validator, never from the browser. No writes occur here.
import type { JsonRpcClient } from "./bnb-revenue-adapter.ts";
import type { W3MRegistryReadClient } from "./persisted-report-loader.ts";
import type { DealRoomTermsRpcClient, DealRoomTermsSnapshotRow } from "./dealroom-terms-reader.ts";
import { checkDealRoomWithW3M } from "./dealroom-w3m-service.ts";
import type { EthereumDigestRecoveryVerifier } from "./signature-verifier.ts";
import type { SafeConfigurationExpectation, SafeConfigurationFacts } from "./safe-live-configuration-facts.ts";

export type PrelockPrepareDatabase = DealRoomTermsRpcClient & W3MRegistryReadClient & JsonRpcClient;
export interface CanonicalPrelockSafeFacts extends SafeConfigurationFacts {
  readBlockNumber: string;
  readBlockHash: string;
}
export interface PrelockSafePrepareDependencies {
  database: PrelockPrepareDatabase;
  readSafeConfiguration(expected: SafeConfigurationExpectation): Promise<CanonicalPrelockSafeFacts>;
}
export interface PrelockSafePrepareResult {
  authorized: boolean;
  issues: string[];
  phase: "PREPARE";
  dealId: string;
  dealTermsHash?: string;
  safeNonce?: string;
  readBlockNumber?: string;
  readBlockHash?: string;
}
const PLATFORM_WALLET = "0x2b15cc63ee3b833f502c065767695fa2b584f8c9";
const BNB_USDT = "0x55d398326f99059ff775485246999027b3197955";
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function required(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("PREPARE snapshot " + label + " is missing.");
  return value;
}
function sameAddressSet(actual: readonly string[], expected: readonly string[]): boolean {
  if (!Array.isArray(actual) || actual.length !== expected.length ||
      actual.some((value) => typeof value !== "string" || !ADDRESS.test(value))) return false;
  const a = actual.map((value) => value.toLowerCase()).sort();
  const e = expected.map((value) => value.toLowerCase()).sort();
  return new Set(a).size === a.length && a.every((value, index) => value === e[index]);
}

export async function authorizePrelockSafePrepare(
  dependencies: PrelockSafePrepareDependencies,
  dealId: string,
  now: string,
  recoverAndVerify: EthereumDigestRecoveryVerifier,
): Promise<PrelockSafePrepareResult> {
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dealId) ||
        !Number.isFinite(Date.parse(now))) {
      return { authorized: false, issues: ["W3M_PRELOCK_PREPARE_INPUT_INVALID"], phase: "PREPARE", dealId };
    }
    const [snapshotResult, policyResult] = await Promise.all([
      dependencies.database.rpc("w3m_read_dealroom_terms_snapshot", { p_deal_id: dealId }),
      dependencies.database.rpc("w3m_read_validated_release_policy", { p_deal_id: dealId }),
    ]);
    if (snapshotResult.error || !Array.isArray(snapshotResult.data) ||
        snapshotResult.data.length !== 1 || !record(snapshotResult.data[0])) {
      return { authorized: false, issues: ["W3M_PRELOCK_DEAL_SNAPSHOT_UNAVAILABLE"], phase: "PREPARE", dealId };
    }
    if (policyResult.error || !Array.isArray(policyResult.data) ||
        policyResult.data.length !== 1 || !record(policyResult.data[0])) {
      return { authorized: false, issues: ["W3M_PRELOCK_POLICY_VALIDATION_UNAVAILABLE"], phase: "PREPARE", dealId };
    }
    const row = snapshotResult.data[0] as unknown as DealRoomTermsSnapshotRow;
    const validated = policyResult.data[0] as Record<string, unknown>;
    if (row.deal_id !== dealId) {
      return { authorized: false, issues: ["W3M_PRELOCK_DEAL_BINDING_MISMATCH"], phase: "PREPARE", dealId };
    }
    if (validated.valid !== "true") {
      return { authorized: false, issues: ["W3M_RELEASE_POLICY_VALIDATION_FAILED"], phase: "PREPARE", dealId };
    }

    const buyerWallet = required(row.buyer_wallet, "buyer wallet");
    const sellerWallet = required(row.seller_wallet, "seller wallet");
    const buyerVerifiedAt = Date.parse(required(row.buyer_wallet_verified_at, "buyer wallet verification time"));
    const sellerVerifiedAt = Date.parse(required(row.seller_wallet_verified_at, "seller wallet verification time"));
    const nowTime = Date.parse(now);
    const safeAddress = required(row.deal_safe_address, "deal Safe address");
    const tokenContract = required(row.deal_token_contract, "deal token contract");
    const policyDealAmount = required(validated.deal_amount, "validated deal amount");
    const feePercent = required(validated.fee_percent, "validated fee percent");
    const feeAmount = required(validated.fee_amount, "validated fee amount");
    const sellerNetAmount = required(validated.seller_net_amount, "validated seller net amount");
    if (!["funded", "in_progress"].includes(String(row.deal_status ?? "").toLowerCase()) ||
        row.deal_chain_id !== "56" || String(row.currency ?? "").toUpperCase() !== "USDT" ||
        row.project_owner_id !== row.seller_id ||
        row.buyer_wallet_verified !== "true" || row.seller_wallet_verified !== "true" ||
        !Number.isFinite(buyerVerifiedAt) || !Number.isFinite(sellerVerifiedAt) ||
        buyerVerifiedAt > nowTime || sellerVerifiedAt > nowTime ||
        !ADDRESS.test(buyerWallet) || !ADDRESS.test(sellerWallet) ||
        buyerWallet.toLowerCase() === sellerWallet.toLowerCase() ||
        !ADDRESS.test(safeAddress) || !ADDRESS.test(tokenContract) ||
        tokenContract.toLowerCase() !== BNB_USDT ||
        !DECIMAL.test(policyDealAmount) || !DECIMAL.test(feePercent) ||
        !DECIMAL.test(feeAmount) || !DECIMAL.test(sellerNetAmount)) {
      return { authorized: false, issues: ["W3M_PRELOCK_PARTY_OR_TERMS_INVALID"], phase: "PREPARE", dealId };
    }

    const expected: SafeConfigurationExpectation = {
      safeAddress,
      expectedSafeAddress: safeAddress,
      expectedOwners: [buyerWallet, sellerWallet, PLATFORM_WALLET],
      expectedThreshold: 2,
      expectedVersion: "1.4.1",
      expectedChainId: 56,
    };
    const facts = await dependencies.readSafeConfiguration(expected);
    if (!facts || facts.valid !== true || !Array.isArray(facts.issues) || facts.issues.length !== 0 ||
        facts.chainId !== 56 || facts.safeAddress?.toLowerCase() !== safeAddress.toLowerCase() ||
        !sameAddressSet(facts.owners, [buyerWallet, sellerWallet, PLATFORM_WALLET]) ||
        facts.threshold !== 2 || facts.version !== "1.4.1" ||
        typeof facts.nonce !== "string" || !/^(0|[1-9][0-9]*)$/.test(facts.nonce) ||
        !HASH.test(facts.readBlockHash) || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(facts.readBlockNumber)) {
      return {
        authorized: false,
        issues: ["W3M_PRELOCK_SAFE_CONFIGURATION_INVALID", ...(facts?.issues ?? [])],
        phase: "PREPARE",
        dealId,
        readBlockNumber: facts?.readBlockNumber,
        readBlockHash: facts?.readBlockHash,
      };
    }

    const paymentConfirmed = row.payment_status === "confirmed" &&
      typeof row.payment_tx_hash === "string" && HASH.test(row.payment_tx_hash);
    const deliveryAccepted = row.delivery_status === "accepted" &&
      typeof row.buyer_approved_at === "string" && row.buyer_approved_at.trim().length > 0;
    const gate = await checkDealRoomWithW3M({
      client: dependencies.database,
      terms: {
        dealId,
        projectId: required(row.project_id, "project ID"),
        buyerId: required(row.buyer_id, "buyer ID"),
        sellerId: required(row.seller_id, "seller ID"),
        amount: required(row.deal_amount, "deal amount"),
        currency: required(row.currency, "deal currency"),
        expectedAmount: row.expected_amount === null ? null : required(row.expected_amount, "expected amount"),
        chainId: 56,
        safeAddress,
        tokenContract,
        policy: {
          dealAmount: policyDealAmount,
          feePercent,
          feeAmount,
          sellerNetAmount,
          chainId: 56,
          safeAddress,
          tokenContract,
          sellerWallet,
          platformWallet: PLATFORM_WALLET,
          safeNonce: facts.nonce,
          status: "locked",
        },
      },
      stage: "PREPARE",
      now,
      paymentConfirmed,
      deliveryAccepted,
      disputeOpen: String(row.dispute_status ?? "").trim().toLowerCase() !== "none",
      safeConfigurationMatches: true,
      releaseAlreadyFinalized: typeof row.release_tx_hash === "string" && row.release_tx_hash.trim().length > 0,
    }, recoverAndVerify);
    const issues = [
      ...gate.decision.issues.map((issue) => issue.code),
      ...gate.reportVerificationIssues,
    ];
    return {
      authorized: gate.authorized === true && issues.length === 0,
      issues,
      phase: "PREPARE",
      dealId,
      ...(gate.authorized ? { dealTermsHash: gate.dealTermsHash, safeNonce: facts.nonce } : {}),
      readBlockNumber: facts.readBlockNumber,
      readBlockHash: facts.readBlockHash,
    };
  } catch {
    return { authorized: false, issues: ["W3M_PRELOCK_PREPARE_AUTHORIZATION_FAILED"], phase: "PREPARE", dealId };
  }
}
