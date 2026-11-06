// W3M Protocol V1 — fresh server-side Safe handler context composer.
// The supplied readSafeFacts function MUST be backed by
// readCanonicalBnbSafeExecutionFacts; browser-supplied chain facts are never accepted.
// This module performs reads only and deliberately refuses any unresolved DB blocker.

import {
  loadSafeExecutionDatabaseSnapshot,
  type SafeExecutionDatabaseSnapshot,
} from "./safe-execution-snapshot-adapter.ts";
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";
import type { W3MRegistryReadClient } from "./persisted-report-loader.ts";
import type { JsonRpcClient } from "./bnb-revenue-adapter.ts";
import type { SafeLiveExecutionExpectation, SafeLiveExecutionFacts } from "./safe-live-execution-facts.ts";
import type { CheckDealRoomFromSnapshotInput, DealRoomLiveSafeFacts } from "./dealroom-terms-reader.ts";
import { authorizeSafeHandlerPhase } from "./safe-handler-w3m-authorizer.ts";
import type { EthereumDigestRecoveryVerifier } from "./signature-verifier.ts";
import type { W3MSafePhase, W3MPhaseAuthorization } from "./safe-edge-w3m-phase-boundary.ts";
import { verifyCurrentAuditManifest } from "./audit-manifest-binding.ts";

export type SafeExecutionContextDatabase =
  W3MRpcClient & W3MRegistryReadClient & JsonRpcClient;

export interface FreshSafeHandlerContextDependencies {
  database: SafeExecutionContextDatabase;
  readSafeFacts(
    expected: SafeLiveExecutionExpectation,
  ): Promise<SafeLiveExecutionFacts & { readBlockNumber: string; readBlockHash: string }>;
}

const PLATFORM_WALLET = "0x2b15cc63ee3b833f502c065767695fa2b584f8c9";

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("W3M fresh context " + label + " is missing.");
  }
  return value;
}

function unsigned(value: unknown, label: string): string {
  const result = requiredText(value, label);
  if (!/^(0|[1-9][0-9]*)$/.test(result)) {
    throw new Error("W3M fresh context " + label + " is invalid.");
  }
  return result;
}

export interface FreshImmutableAgreementBinding {
  termsVersionId: string;
  termsVersion: string;
  termsHash: string;
  buyerAcceptanceId: string;
  sellerAcceptanceId: string;
  buyerDigest: string;
  sellerDigest: string;
}

/** Derive the coordinator binding only from the strict snapshot adapter.
 * That adapter has already recomputed current canonical terms and recovered
 * each EIP-712 signature against the currently verified party wallet.
 */
export function immutableAgreementBindingFromSnapshot(
  snapshot: SafeExecutionDatabaseSnapshot,
): FreshImmutableAgreementBinding {
  if (!snapshot || snapshot.blockers.length !== 0 || !snapshot.termsVersion ||
      snapshot.agreementAcceptances.length !== 2) {
    throw new Error("Fresh immutable buyer/seller agreement evidence is incomplete.");
  }
  const terms = snapshot.termsVersion;
  const buyer = snapshot.agreementAcceptances.find((row) => row.partyRole === "buyer");
  const seller = snapshot.agreementAcceptances.find((row) => row.partyRole === "seller");
  if (!buyer || !seller || buyer.id === seller.id ||
      buyer.termsVersionId !== terms.id || seller.termsVersionId !== terms.id ||
      buyer.dealId !== terms.dealId || seller.dealId !== terms.dealId ||
      buyer.termsVersion !== terms.termsVersion || seller.termsVersion !== terms.termsVersion ||
      buyer.termsHash.toLowerCase() !== terms.termsHash.toLowerCase() ||
      seller.termsHash.toLowerCase() !== terms.termsHash.toLowerCase() ||
      buyer.typedDataDigest.toLowerCase() === seller.typedDataDigest.toLowerCase()) {
    throw new Error("Fresh immutable agreement records are not bound to one matching terms version.");
  }
  return {
    termsVersionId: terms.id,
    termsVersion: terms.termsVersion,
    termsHash: terms.termsHash,
    buyerAcceptanceId: buyer.id,
    sellerAcceptanceId: seller.id,
    buyerDigest: buyer.typedDataDigest,
    sellerDigest: seller.typedDataDigest,
  };
}

function transactionExpectation(snapshot: SafeExecutionDatabaseSnapshot): SafeLiveExecutionExpectation {
  const tx = snapshot.releaseTransaction;
  const safeAddress = requiredText(snapshot.deal.safe_address, "deal Safe address");
  return {
    safeAddress,
    expectedSafeAddress: requiredText(snapshot.policy.safe_address, "policy Safe address"),
    expectedOwners: [
      requiredText(snapshot.buyerProfile.wallet_address, "buyer wallet"),
      requiredText(snapshot.sellerProfile.wallet_address, "seller wallet"),
      PLATFORM_WALLET,
    ],
    expectedThreshold: 2,
    expectedVersion: "1.4.1",
    expectedChainId: 56,
    expectedNonce: unsigned(tx.safe_nonce, "stored Safe nonce"),
    storedSafeTransactionHash: requiredText(tx.safe_tx_hash, "stored Safe transaction hash"),
    transaction: {
      to: requiredText(tx.to_address, "Safe transaction target"),
      value: unsigned(tx.value_wei, "Safe transaction value"),
      data: requiredText(tx.data, "Safe transaction calldata"),
      operation: Number(tx.operation),
      safeTxGas: unsigned(tx.safe_tx_gas, "Safe transaction gas"),
      baseGas: unsigned(tx.base_gas, "Safe transaction base gas"),
      gasPrice: unsigned(tx.gas_price, "Safe transaction gas price"),
      gasToken: requiredText(tx.gas_token, "Safe transaction gas token"),
      refundReceiver: requiredText(tx.refund_receiver, "Safe transaction refund receiver"),
      nonce: unsigned(tx.safe_nonce, "Safe transaction nonce"),
    },
  };
}

function dealRoomSafeFacts(
  facts: SafeLiveExecutionFacts,
  buyerWallet: string,
  sellerWallet: string,
): DealRoomLiveSafeFacts {
  if (!facts.valid || facts.chainId !== 56 || !facts.safeAddress ||
      !facts.owners.length || facts.threshold !== 2 || facts.version !== "1.4.1" ||
      facts.nonce === null) {
    throw new Error("W3M live Safe facts are invalid: " + facts.issues.join(","));
  }
  return {
    chainId: facts.chainId,
    safeAddress: facts.safeAddress,
    owners: facts.owners,
    threshold: facts.threshold,
    version: facts.version,
    nonce: facts.nonce,
    expectedBuyerWallet: buyerWallet,
    expectedSellerWallet: sellerWallet,
  };
}

export async function loadFreshSafeHandlerContext(
  dependencies: FreshSafeHandlerContextDependencies,
  dealId: string,
  now: string,
  phase: "SIGN" | "EXECUTE" = "EXECUTE",
  actorId?: string,
): Promise<Omit<CheckDealRoomFromSnapshotInput, "stage"> & {
  safeTransactionHash: string;
  agreementBinding: FreshImmutableAgreementBinding;
  databaseSnapshot: SafeExecutionDatabaseSnapshot;
  liveExecutionFacts: SafeLiveExecutionFacts & { readBlockNumber: string; readBlockHash: string };
  verifiedWallet?: string;
  signerRole?: "buyer" | "seller";
  transactionStatus: "awaiting_signatures" | "signed";
}> {
  if (!Number.isFinite(Date.parse(now))) throw new Error("W3M fresh context time is invalid.");
  const snapshot = await loadSafeExecutionDatabaseSnapshot(dependencies.database, dealId, phase);
  if (snapshot.blockers.length > 0) {
    throw new Error("W3M Safe execution is blocked: " + snapshot.blockers.join(","));
  }

  await verifyCurrentAuditManifest(dependencies.database, snapshot.codeAudit);

  const expected = transactionExpectation(snapshot);
  const transactionStatus = snapshot.releaseTransaction.status;
  if (transactionStatus !== "awaiting_signatures" && transactionStatus !== "signed") {
    throw new Error("Safe release transaction is not in a signable status.");
  }
  let verifiedWallet: string | undefined;
  let signerRole: "buyer" | "seller" | undefined;
  if (actorId !== undefined) {
    const isBuyer = actorId === snapshot.deal.buyer_id;
    const isSeller = actorId === snapshot.deal.seller_id;
    if (isBuyer === isSeller) throw new Error("Authenticated actor is not exactly one deal participant.");
    const profile = isBuyer ? snapshot.buyerProfile : snapshot.sellerProfile;
    const wallet = profile.wallet_address;
    const verifiedAt = typeof profile.wallet_verified_at === "string" ? Date.parse(profile.wallet_verified_at) : Number.NaN;
    if (profile.wallet_verified !== true || typeof wallet !== "string" ||
        !/^0x[0-9a-fA-F]{40}$/.test(wallet) || !Number.isFinite(verifiedAt) ||
        verifiedAt > Date.parse(now)) {
      throw new Error("Authenticated participant wallet is not currently verified.");
    }
    verifiedWallet = wallet;
    signerRole = isBuyer ? "buyer" : "seller";
  }
  const facts = await dependencies.readSafeFacts(expected);
  const safeFacts = dealRoomSafeFacts(
    facts,
    requiredText(snapshot.buyerProfile.wallet_address, "buyer wallet"),
    requiredText(snapshot.sellerProfile.wallet_address, "seller wallet"),
  );

  return {
    client: dependencies.database,
    dealId,
    now,
    safeFacts,
    codeAudit: snapshot.codeAudit,
    safeTransactionHash: requiredText(snapshot.releaseTransaction.safe_tx_hash, "fresh Safe transaction hash"),
    agreementBinding: immutableAgreementBindingFromSnapshot(snapshot),
    databaseSnapshot: snapshot,
    liveExecutionFacts: facts,
    verifiedWallet,
    signerRole,
    transactionStatus,
  };
}


/** Full phase-aware composition: fresh DB + canonical BNB facts + persisted report gate. */
export async function authorizeSafeHandlerPhaseFromFreshSources(
  phase: W3MSafePhase,
  dependencies: FreshSafeHandlerContextDependencies,
  dealId: string,
  now: string,
  recoverAndVerify: EthereumDigestRecoveryVerifier,
  safeTransactionHash?: string | null,
): Promise<W3MPhaseAuthorization> {
  return await authorizeSafeHandlerPhase(
    phase,
    () => loadFreshSafeHandlerContext(dependencies, dealId, now, phase === "SIGN" ? "SIGN" : "EXECUTE"),
    recoverAndVerify,
    safeTransactionHash,
  );
}
