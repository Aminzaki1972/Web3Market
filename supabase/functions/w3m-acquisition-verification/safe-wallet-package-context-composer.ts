// W3M Protocol V1 — trusted package-request context composition.
// Rebuilds the entire EXECUTE guard from one fresh DB snapshot, canonical BNB
// Safe facts, the latest persisted report bundle, and verified EIP-712 consent.
import {
  loadFreshSafeHandlerContext,
  type FreshSafeHandlerContextDependencies,
} from "./fresh-safe-handler-context.ts";
import type { SafeExecutionFreshSnapshot } from "./safe-execution-coordinator.ts";
import type { CanonicalBnbSafeExecutionFacts } from "./bnb-safe-execution-facts-reader.ts";
import { computeDealTermsHash } from "./deal-terms-hash.ts";
import { loadCurrentW3MReportBundle } from "./persisted-report-loader.ts";
import { verifyPersistedW3MReport } from "./persisted-report-guard.ts";
import type { EthereumDigestRecoveryVerifier } from "./signature-verifier.ts";
import type { SettlementGateInput } from "./settlement-gate.ts";
import type { SafeExecutionGuardInput } from "./safe-execution-guard.ts";
import type {
  SafeReleasePolicySnapshot,
  SafeReleaseTransactionRow,
} from "./safe-release-transaction-adapter.ts";

const MULTISEND_CALL_ONLY = "0x9641d764fc13c8b624c04430c7356c1c7c8102e2";
const HASH = /^0x[0-9a-f]{64}$/i;

export interface SafeWalletPackageContextDependencies extends FreshSafeHandlerContextDependencies {}

export interface SafeWalletPackageContext {
  snapshot: SafeExecutionFreshSnapshot;
  liveFacts: CanonicalBnbSafeExecutionFacts;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("W3M package context " + label + " is missing.");
  return value;
}
function exactDecimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new Error("W3M package context " + label + " must be exact PostgreSQL decimal text.");
  }
  return value;
}
export async function loadFreshSafeWalletPackageContext(
  dependencies: SafeWalletPackageContextDependencies,
  actorId: string,
  dealId: string,
  now: string,
  recoverAndVerify?: EthereumDigestRecoveryVerifier,
): Promise<SafeWalletPackageContext> {
  const fresh = await loadFreshSafeHandlerContext(
    dependencies,
    dealId,
    now,
    "EXECUTE",
    actorId,
  );
  const databaseSnapshot = fresh.databaseSnapshot;
  const deal = databaseSnapshot.deal;
  const policy = databaseSnapshot.policy;
  const tx = databaseSnapshot.releaseTransaction;
  const liveFacts = fresh.liveExecutionFacts;

  const dealTerms = await computeDealTermsHash({
    dealId,
    projectId: requiredText(deal.project_id, "project ID"),
    buyerId: requiredText(deal.buyer_id, "buyer ID"),
    sellerId: requiredText(deal.seller_id, "seller ID"),
    amount: exactDecimal(deal.amount, "deal amount"),
    currency: requiredText(deal.currency, "deal currency"),
    expectedAmount: deal.expected_amount === null ? null : exactDecimal(deal.expected_amount, "expected amount"),
    chainId: Number(deal.chain_id),
    safeAddress: requiredText(deal.safe_address, "deal Safe"),
    tokenContract: requiredText(deal.token_contract, "deal token"),
    codeAudit: fresh.codeAudit,
    policy: {
      dealAmount: exactDecimal(policy.deal_amount, "policy deal amount"),
      feePercent: exactDecimal(policy.fee_percent, "policy fee percent"),
      feeAmount: exactDecimal(policy.fee_amount, "policy fee amount"),
      sellerNetAmount: exactDecimal(policy.seller_net_amount, "seller net amount"),
      chainId: Number(policy.chain_id),
      safeAddress: requiredText(policy.safe_address, "policy Safe"),
      tokenContract: requiredText(policy.token_contract, "policy token"),
      sellerWallet: requiredText(policy.seller_wallet, "seller wallet"),
      platformWallet: requiredText(policy.platform_wallet, "platform wallet"),
      safeNonce: requiredText(policy.safe_nonce, "policy Safe nonce"),
      status: policy.status === "locked" ? "locked" : policy.status === "ready" ? "ready" : (() => {
        throw new Error("W3M release policy is not locked or ready.");
      })(),
    },
  });

  const reportBundle = await loadCurrentW3MReportBundle(dependencies.database, dealId);
  const reportVerification = await verifyPersistedW3MReport({
    expectedDealId: dealId,
    expectedProjectId: requiredText(deal.project_id, "project ID"),
    expectedBuyerId: requiredText(deal.buyer_id, "buyer ID"),
    expectedSellerId: requiredText(deal.seller_id, "seller ID"),
    currentDealTermsHash: dealTerms.dealTermsHash,
    latestReportVersion: reportBundle.latestReportVersion,
    now,
    reportRow: reportBundle.reportRow,
    evidenceRows: reportBundle.evidenceRows,
    trustedSignerRegistryRows: reportBundle.trustedSignerRegistryRows,
  }, recoverAndVerify);

  const report = reportVerification.report;
  if (!report || !Number.isSafeInteger(report.reportVersion) || report.reportVersion < 1) {
    throw new Error("Latest persisted W3M PASS report is missing or ambiguous; package issuance blocked.");
  }

  const paymentConfirmed = deal.payment_status === "confirmed" &&
    typeof deal.payment_tx_hash === "string" && HASH.test(deal.payment_tx_hash);
  const deliveryAccepted = deal.delivery_status === "accepted" &&
    typeof deal.buyer_approved_at === "string" && deal.buyer_approved_at.trim().length > 0;
  const disputeOpen = String(deal.dispute_status ?? "").trim().toLowerCase() !== "none";
  const safeConfigurationMatches = liveFacts.valid;
  const releaseAlreadyFinalized = typeof deal.release_tx_hash === "string" && deal.release_tx_hash.trim().length > 0;

  const settlement: SettlementGateInput = {
    stage: "EXECUTE",
    dealId,
    projectId: requiredText(deal.project_id, "project ID"),
    now,
    report,
    latestReportVersion: reportVerification.latestReportVersion,
    isSuperseded: reportVerification.isSuperseded,
    signatureValid: reportVerification.signatureValid,
    signerState: reportVerification.signerState,
    recomputedEvidenceHash: reportVerification.recomputedEvidenceHash,
    currentDealTermsHash: dealTerms.dealTermsHash,
    reportDealTermsHash: reportVerification.reportDealTermsHash,
    paymentConfirmed,
    deliveryAccepted,
    disputeOpen,
    safeConfigurationMatches,
    releaseAlreadyFinalized,
  };

  const releasePolicy: SafeReleasePolicySnapshot = {
    expectedDealId: dealId,
    expectedSafeAddress: requiredText(policy.safe_address, "policy Safe"),
    expectedMultiSendCallOnly: MULTISEND_CALL_ONLY,
    expectedTokenAddress: requiredText(policy.token_contract, "policy token"),
    sellerWallet: requiredText(policy.seller_wallet, "seller wallet"),
    platformWallet: requiredText(policy.platform_wallet, "platform wallet"),
    sellerNetAmount: exactDecimal(policy.seller_net_amount, "seller net amount"),
    platformFeeAmount: exactDecimal(policy.fee_amount, "platform fee"),
    dealAmount: exactDecimal(policy.deal_amount, "policy deal amount"),
  };
  const signatures = {
    safeTransactionHash: requiredText(tx.safe_tx_hash, "stored Safe transaction hash"),
    currentOwners: liveFacts.owners,
    threshold: liveFacts.threshold ?? 0,
    storedSignatures: databaseSnapshot.signers.map((row) => ({
      walletAddress: row.walletAddress,
      signature: row.signature,
      signatureStatus: row.signatureStatus,
    })),
  };
  const guardInput: SafeExecutionGuardInput = {
    settlement,
    transaction: tx as unknown as SafeReleaseTransactionRow,
    releasePolicy,
    storedSafeTransactionHash: requiredText(tx.safe_tx_hash, "stored Safe transaction hash"),
    recomputedSafeTransactionHash: liveFacts.recomputedSafeTransactionHash ?? "",
    signatures,
  };

  const snapshot: SafeExecutionFreshSnapshot = {
    dealId,
    transactionId: requiredText(tx.id, "transaction ID"),
    reportId: report.id,
    reportVersion: report.reportVersion,
    executorRef: actorId,
    executorWallet: requiredText(fresh.verifiedWallet, "authenticated executor wallet"),
    idempotencyKey: [
      "w3m-wallet-package-v1",
      dealId,
      requiredText(tx.safe_tx_hash, "Safe transaction hash").toLowerCase(),
      report.id,
      String(report.reportVersion),
      fresh.agreementBinding.termsVersionId,
    ].join(":"),
    agreementBinding: fresh.agreementBinding,
    guardInput,
  };

  return {
    snapshot,
    liveFacts: {
      ...liveFacts,
      readBlockNumber: fresh.liveExecutionFacts.readBlockNumber,
      readBlockHash: fresh.liveExecutionFacts.readBlockHash,
    },
  };
}
