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
): Promise<Omit<CheckDealRoomFromSnapshotInput, "stage">> {
  if (!Number.isFinite(Date.parse(now))) throw new Error("W3M fresh context time is invalid.");
  const snapshot = await loadSafeExecutionDatabaseSnapshot(dependencies.database, dealId);
  if (snapshot.blockers.length > 0) {
    throw new Error("W3M Safe execution is blocked: " + snapshot.blockers.join(","));
  }

  const expected = transactionExpectation(snapshot);
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
  };
}
