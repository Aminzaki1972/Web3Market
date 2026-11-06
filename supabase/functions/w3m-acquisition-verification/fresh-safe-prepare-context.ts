// W3M Protocol V1 — PREPARE gate before Safe transaction construction/rebuild.
// This expects the release policy and its pending release row to have been
// created by the earlier prepare-deal-release phase. It is not the pre-lock
// gate for that earlier phase. It deliberately avoids the stricter EXECUTE
// snapshot, which requires an already-signed Safe transaction. The caller must
// inject canonical-block BNB facts from readCanonicalBnbSafeConfigurationFacts.
import type { JsonRpcClient } from "./bnb-revenue-adapter.ts";
import type { W3MRegistryReadClient } from "./persisted-report-loader.ts";
import {
  evaluateDealRoomTermsSnapshotRow,
  type DealRoomTermsSnapshotRow,
  type DealRoomTermsRpcClient,
  type DealRoomLiveSafeFacts,
} from "./dealroom-terms-reader.ts";
import type { EthereumDigestRecoveryVerifier } from "./signature-verifier.ts";
import type { SafeConfigurationExpectation, SafeConfigurationFacts } from "./safe-live-configuration-facts.ts";
import { parseDealCodeAuditBinding } from "./deal-code-audit-binding.ts";
import { verifyCurrentAuditManifest } from "./audit-manifest-binding.ts";

export type SafePrepareDatabase =
  DealRoomTermsRpcClient & W3MRegistryReadClient & JsonRpcClient;

export interface CanonicalSafePrepareFacts extends SafeConfigurationFacts {
  readBlockNumber: string;
  readBlockHash: string;
}

export interface FreshSafePrepareDependencies {
  database: SafePrepareDatabase;
  readSafeConfiguration(expected: SafeConfigurationExpectation): Promise<CanonicalSafePrepareFacts>;
}

export interface FreshSafePrepareAuthorization {
  authorized: boolean;
  issues: string[];
  phase: "PREPARE";
  dealId: string;
  reportId?: string | null;
  reportVersion?: number | null;
  readBlockNumber?: string;
  readBlockHash?: string;
}

const PLATFORM_WALLET = "0x2b15cc63ee3b833f502c065767695fa2b584f8c9";
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const UINT = /^(0|[1-9][0-9]*)$/;

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

export async function authorizeSafePrepareFromFreshSources(
  dependencies: FreshSafePrepareDependencies,
  dealId: string,
  now: string,
  recoverAndVerify: EthereumDigestRecoveryVerifier,
): Promise<FreshSafePrepareAuthorization> {
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dealId) ||
        !Number.isFinite(Date.parse(now))) {
      return { authorized: false, issues: ["W3M_PREPARE_INPUT_INVALID"], phase: "PREPARE", dealId };
    }
    const result = await dependencies.database.rpc("w3m_read_dealroom_terms_snapshot", {
      p_deal_id: dealId,
    });
    if (result.error || !Array.isArray(result.data) || result.data.length !== 1 || !record(result.data[0])) {
      return { authorized: false, issues: ["W3M_PREPARE_SNAPSHOT_UNAVAILABLE"], phase: "PREPARE", dealId };
    }
    const row = result.data[0] as unknown as DealRoomTermsSnapshotRow;
    if (row.deal_id !== dealId || row.policy_deal_id !== dealId) {
      return { authorized: false, issues: ["W3M_PREPARE_DEAL_POLICY_BINDING_MISMATCH"], phase: "PREPARE", dealId };
    }
    const codeAudit = parseDealCodeAuditBinding(row.code_audit);
    await verifyCurrentAuditManifest(dependencies.database, codeAudit);
    const buyerWallet = required(row.buyer_wallet, "verified buyer wallet");
    const sellerWallet = required(row.seller_wallet, "verified seller wallet");
    const buyerVerifiedAt = required(row.buyer_wallet_verified_at, "buyer wallet verification time");
    const sellerVerifiedAt = required(row.seller_wallet_verified_at, "seller wallet verification time");
    const buyerVerifiedTime = Date.parse(buyerVerifiedAt);
    const sellerVerifiedTime = Date.parse(sellerVerifiedAt);
    const nowTime = Date.parse(now);
    if (row.project_owner_id !== row.seller_id ||
        row.buyer_wallet_verified !== "true" || row.seller_wallet_verified !== "true" ||
        !Number.isFinite(buyerVerifiedTime) || !Number.isFinite(sellerVerifiedTime) ||
        buyerVerifiedTime > nowTime || sellerVerifiedTime > nowTime) {
      return { authorized: false, issues: ["W3M_PREPARE_PROJECT_OR_WALLET_VERIFICATION_INVALID"], phase: "PREPARE", dealId };
    }
    const policySellerWallet = required(row.policy_seller_wallet, "policy seller wallet");
    const platformWallet = required(row.policy_platform_wallet, "policy platform wallet");
    const safeAddress = required(row.deal_safe_address, "deal Safe address");
    const policySafeAddress = required(row.policy_safe_address, "policy Safe address");
    const nonce = required(row.policy_safe_nonce, "locked policy Safe nonce");
    if (!ADDRESS.test(buyerWallet) || !ADDRESS.test(sellerWallet) ||
        buyerWallet.toLowerCase() === sellerWallet.toLowerCase() ||
        !ADDRESS.test(policySellerWallet) || policySellerWallet.toLowerCase() !== sellerWallet.toLowerCase() ||
        !ADDRESS.test(platformWallet) || platformWallet.toLowerCase() !== PLATFORM_WALLET ||
        !ADDRESS.test(safeAddress) || !ADDRESS.test(policySafeAddress) ||
        safeAddress.toLowerCase() !== policySafeAddress.toLowerCase() || !UINT.test(nonce)) {
      return { authorized: false, issues: ["W3M_PREPARE_PARTY_OR_SAFE_BINDING_INVALID"], phase: "PREPARE", dealId };
    }

    const expected: SafeConfigurationExpectation = {
      safeAddress,
      expectedSafeAddress: policySafeAddress,
      expectedOwners: [buyerWallet, sellerWallet, PLATFORM_WALLET],
      expectedThreshold: 2,
      expectedVersion: "1.4.1",
      expectedChainId: 56,
      expectedNonce: nonce,
    };
    const facts = await dependencies.readSafeConfiguration(expected);
    if (!facts || facts.valid !== true || !Array.isArray(facts.issues) || facts.issues.length !== 0 ||
        facts.chainId !== 56 || facts.safeAddress?.toLowerCase() !== safeAddress.toLowerCase() ||
        !sameAddressSet(facts.owners, [buyerWallet, sellerWallet, PLATFORM_WALLET]) ||
        facts.threshold !== 2 || facts.version !== "1.4.1" || facts.nonce !== nonce ||
        !/^0x[0-9a-f]{64}$/i.test(facts.readBlockHash) ||
        !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(facts.readBlockNumber)) {
      return {
        authorized: false,
        issues: ["W3M_PREPARE_SAFE_CONFIGURATION_INVALID", ...(facts?.issues ?? [])],
        phase: "PREPARE",
        dealId,
        readBlockNumber: facts?.readBlockNumber,
        readBlockHash: facts?.readBlockHash,
      };
    }
    const safeFacts: DealRoomLiveSafeFacts = {
      chainId: facts.chainId,
      safeAddress: facts.safeAddress!,
      owners: facts.owners,
      threshold: facts.threshold!,
      version: facts.version!,
      nonce: facts.nonce!,
      expectedBuyerWallet: buyerWallet,
      expectedSellerWallet: sellerWallet,
    };
    const gate = await evaluateDealRoomTermsSnapshotRow({
      client: dependencies.database,
      dealId,
      stage: "PREPARE",
      now,
      codeAudit,
      safeFacts,
    }, row, recoverAndVerify);
    const issues = [
      ...gate.decision.issues.map((issue) => issue.code),
      ...gate.reportVerificationIssues,
    ];
    return {
      authorized: gate.authorized === true && issues.length === 0,
      issues,
      phase: "PREPARE",
      dealId,
      reportId: gate.decision.reportId,
      reportVersion: gate.decision.reportVersion,
      readBlockNumber: facts.readBlockNumber,
      readBlockHash: facts.readBlockHash,
    };
  } catch {
    return { authorized: false, issues: ["W3M_PREPARE_FRESH_AUTHORIZATION_FAILED"], phase: "PREPARE", dealId };
  }
}
