// W3M Protocol V1 — connected-wallet Safe execution package builder.
// This module is pure: it validates fresh server-loaded facts and returns the
// exact Safe transaction fields plus verified owner signatures. It never signs,
// sends RPC writes, broadcasts, or treats a browser response as confirmation.
import {
  evaluateSafeExecutionGuard,
  type SafeExecutionGuardInput,
} from "./safe-execution-guard.ts";
import type { SafeExecutionFreshSnapshot } from "./safe-execution-coordinator.ts";
import type { SafeDigestSignatureVerifier } from "./safe-signature-set-validator.ts";
import type { CanonicalBnbSafeExecutionFacts } from "./bnb-safe-execution-facts-reader.ts";

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const UINT = /^(0|[1-9][0-9]*)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SafeWalletExecutionCall {
  to: string;
  value: string;
  data: string;
  operation: 0 | 1;
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  gasToken: string;
  refundReceiver: string;
  nonce: string;
}

export interface SafeWalletExecutionSignature {
  signerAddress: string;
  signature: string;
}

export interface SafeWalletExecutionPackage {
  protocol: "W3M_PROTOCOL_V1";
  chainId: 56;
  dealId: string;
  transactionId: string;
  reportId: string;
  reportVersion: number;
  agreementTermsVersionId: string;
  agreementTermsVersion: string;
  agreementTermsHash: string;
  buyerAcceptanceId: string;
  sellerAcceptanceId: string;
  buyerAcceptanceDigest: string;
  sellerAcceptanceDigest: string;
  safeAddress: string;
  executorWallet: string;
  safeOwners: string[];
  safeTransactionHash: string;
  safeVersion: string;
  readBlockNumber: string;
  readBlockHash: string;
  issuedAt: string;
  expiresAt: string;
  call: SafeWalletExecutionCall;
  signatures: SafeWalletExecutionSignature[];
  requiredSignatures: number;
}

export interface BuildSafeWalletExecutionPackageInput {
  snapshot: SafeExecutionFreshSnapshot;
  liveFacts: CanonicalBnbSafeExecutionFacts;
  issuedAt: string;
  expiresAt: string;
  verifySignature?: SafeDigestSignatureVerifier;
}

function sameAddress(a: string, b: string): boolean {
  return ADDRESS.test(a || "") && ADDRESS.test(b || "") && a.toLowerCase() === b.toLowerCase();
}
function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(label + " is missing.");
  return value;
}
function uint(value: unknown, label: string): string {
  const result = typeof value === "string" ? value :
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : "";
  if (!UINT.test(result)) throw new Error(label + " is not an exact unsigned integer.");
  return result;
}
function validAgreement(snapshot: SafeExecutionFreshSnapshot): NonNullable<SafeExecutionFreshSnapshot["agreementBinding"]> {
  const a = snapshot.agreementBinding;
  if (!a || !UUID.test(a.termsVersionId) || !/^[1-9][0-9]*$/.test(a.termsVersion) ||
      !/^[0-9a-f]{64}$/i.test(a.termsHash) || !UUID.test(a.buyerAcceptanceId) ||
      !UUID.test(a.sellerAcceptanceId) || a.buyerAcceptanceId === a.sellerAcceptanceId ||
      !HASH.test(a.buyerDigest) || !HASH.test(a.sellerDigest) ||
      a.buyerDigest.toLowerCase() === a.sellerDigest.toLowerCase()) {
    throw new Error("Both immutable buyer and seller agreement acceptances are required.");
  }
  return a;
}

export async function buildSafeWalletExecutionPackage(
  input: BuildSafeWalletExecutionPackageInput,
): Promise<SafeWalletExecutionPackage> {
  const snapshot = input?.snapshot;
  const facts = input?.liveFacts;
  if (!snapshot || !facts) throw new Error("Fresh execution snapshot and canonical Safe facts are required.");
  if (!UUID.test(snapshot.dealId) || !UUID.test(snapshot.transactionId) ||
      !UUID.test(snapshot.reportId) || !Number.isSafeInteger(snapshot.reportVersion) ||
      snapshot.reportVersion < 1) {
    throw new Error("Deal, transaction, report, or report-version binding is invalid.");
  }
  const issuedAtMs = Date.parse(input.issuedAt);
  const expiresAtMs = Date.parse(input.expiresAt);
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs) ||
      expiresAtMs <= issuedAtMs || expiresAtMs - issuedAtMs > 120_000) {
    throw new Error("Package issue or expiry timestamp is invalid or exceeds the two-minute limit.");
  }
  const agreement = validAgreement(snapshot);
  const executorWallet = requiredText(snapshot.executorWallet, "authenticated executor wallet");
  if (!ADDRESS.test(executorWallet) ||
      !facts.owners.some((owner) => sameAddress(owner, executorWallet))) {
    throw new Error("Authenticated executor wallet is not a current Safe owner.");
  }
  const guardInput: SafeExecutionGuardInput = snapshot.guardInput;
  if (!guardInput || guardInput.transaction?.deal_id !== snapshot.dealId ||
      guardInput.settlement?.dealId !== snapshot.dealId ||
      guardInput.settlement?.report?.id !== snapshot.reportId ||
      guardInput.settlement?.report?.reportVersion !== snapshot.reportVersion) {
    throw new Error("W3M report or Safe transaction is not bound to this deal.");
  }

  const decision = await evaluateSafeExecutionGuard(guardInput, input.verifySignature);
  if (!decision.authorized) {
    throw new Error("W3M execution authorization failed: " + decision.issues.join(","));
  }

  const tx = guardInput.transaction as unknown as Record<string, unknown>;
  const safeAddress = requiredText(tx.safe_address, "Safe address");
  const safeHash = requiredText(guardInput.recomputedSafeTransactionHash, "Recomputed Safe transaction hash");
  if (!HASH.test(safeHash) ||
      safeHash.toLowerCase() !== String(guardInput.storedSafeTransactionHash).toLowerCase()) {
    throw new Error("Stored and recomputed Safe transaction hashes do not match.");
  }
  if (facts.valid !== true || facts.chainId !== 56 ||
      !sameAddress(facts.safeAddress ?? "", safeAddress) ||
      !HASH.test(facts.recomputedSafeTransactionHash ?? "") ||
      facts.recomputedSafeTransactionHash!.toLowerCase() !== safeHash.toLowerCase() ||
      !UINT.test(facts.readBlockNumber) || !HASH.test(facts.readBlockHash ?? "") ||
      !facts.version || !Number.isInteger(facts.threshold) || facts.threshold! < 1) {
    throw new Error("Canonical BNB Safe facts are invalid or stale.");
  }

  const signaturesInput = guardInput.signatures;
  if (facts.threshold !== signaturesInput.threshold) throw new Error("Safe threshold changed.");
  const liveOwners = facts.owners.map((v) => v.toLowerCase()).sort();
  const expectedOwners = signaturesInput.currentOwners.map((v) => v.toLowerCase()).sort();
  if (liveOwners.length === 0 || liveOwners.length !== expectedOwners.length ||
      liveOwners.some((v, i) => v !== expectedOwners[i])) {
    throw new Error("Current Safe owner set changed.");
  }

  const call: SafeWalletExecutionCall = {
    to: requiredText(tx.to_address, "Safe call target"),
    value: uint(tx.value_wei, "Safe native value"),
    data: requiredText(tx.data, "Safe calldata"),
    operation: Number(tx.operation) as 0 | 1,
    safeTxGas: uint(tx.safe_tx_gas, "Safe transaction gas"),
    baseGas: uint(tx.base_gas, "Safe base gas"),
    gasPrice: uint(tx.gas_price, "Safe gas price"),
    gasToken: requiredText(tx.gas_token, "Safe gas token"),
    refundReceiver: requiredText(tx.refund_receiver, "Safe refund receiver"),
    nonce: uint(tx.safe_nonce, "Safe nonce"),
  };
  if (!ADDRESS.test(call.to) || !/^0x(?:[0-9a-f]{2})*$/i.test(call.data) ||
      ![0, 1].includes(call.operation) || !ADDRESS.test(call.gasToken) ||
      !ADDRESS.test(call.refundReceiver) || call.value !== "0" ||
      call.nonce !== facts.nonce) {
    throw new Error("Safe transaction fields do not match the current canonical Safe state.");
  }

  const signatures = signaturesInput.storedSignatures
    .filter((row) => row.signatureStatus === "signed")
    .map((row) => ({ signerAddress: row.walletAddress, signature: row.signature }))
    .sort((a, b) => a.signerAddress.toLowerCase().localeCompare(b.signerAddress.toLowerCase()));
  if (signatures.length < facts.threshold ||
      signatures.some((s) => !ADDRESS.test(s.signerAddress) || !/^0x[0-9a-f]{130}$/i.test(s.signature))) {
    throw new Error("Verified Safe signature set is incomplete or malformed.");
  }

  return {
    protocol: "W3M_PROTOCOL_V1",
    chainId: 56,
    dealId: snapshot.dealId,
    transactionId: snapshot.transactionId,
    reportId: snapshot.reportId,
    reportVersion: snapshot.reportVersion,
    agreementTermsVersionId: agreement.termsVersionId,
    agreementTermsVersion: agreement.termsVersion,
    agreementTermsHash: agreement.termsHash,
    buyerAcceptanceId: agreement.buyerAcceptanceId,
    sellerAcceptanceId: agreement.sellerAcceptanceId,
    buyerAcceptanceDigest: agreement.buyerDigest,
    sellerAcceptanceDigest: agreement.sellerDigest,
    safeAddress,
    executorWallet: executorWallet.toLowerCase(),
    safeOwners: facts.owners.map((owner) => owner.toLowerCase()).sort(),
    safeTransactionHash: safeHash,
    safeVersion: facts.version,
    readBlockNumber: facts.readBlockNumber,
    readBlockHash: facts.readBlockHash,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    call,
    signatures,
    requiredSignatures: facts.threshold,
  };
}
