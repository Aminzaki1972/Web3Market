// W3M Protocol V1 — strict server-only adapter for the exact Safe EXECUTE snapshot RPC.
// This adapter does not authorize, sign, broadcast, or finalize a Safe transaction.
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";

export interface SafeExecutionSnapshotPartyAgreement {
  partyRole: "buyer" | "seller";
  partyId: string;
  agreedAt: string | null;
  termsHash: null;
  termsVersion: null;
  signature: null;
}

export interface SafeExecutionSnapshotSigner {
  signerRole: string;
  signerId: string | null;
  walletAddress: string;
  signatureStatus: string;
  signedAt: string | null;
  safeTransactionHash: string;
  signature: string;
}

export interface SafeExecutionDatabaseSnapshot {
  deal: Record<string, unknown>;
  policy: Record<string, unknown>;
  project: Record<string, unknown>;
  buyerProfile: Record<string, unknown>;
  sellerProfile: Record<string, unknown>;
  releaseTransaction: Record<string, unknown>;
  signers: SafeExecutionSnapshotSigner[];
  partyAgreements: SafeExecutionSnapshotPartyAgreement[];
  dispute: Record<string, unknown> | null;
  blockers: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const SIGNATURE = /^0x[0-9a-f]{130}$/i;
const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const MULTISEND_CALL_ONLY = "0x9641d764fc13c8b624c04430c7356c1c7c8102e2";
const PLATFORM_WALLET = "0x2b15cc63ee3b833f502c065767695fa2b584f8c9";
const UINT = /^(0|[1-9][0-9]*)$/;

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Safe execution snapshot " + label + " is missing or malformed.");
  }
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Safe execution snapshot " + label + " is missing.");
  }
  return value;
}
function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
function exactDecimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new Error("Safe execution snapshot " + label + " must be exact decimal text.");
  }
  return value;
}
function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return value;
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error("Safe execution snapshot " + label + " must be an array.");
  return value;
}

export async function loadSafeExecutionDatabaseSnapshot(
  client: W3MRpcClient,
  dealId: string,
): Promise<SafeExecutionDatabaseSnapshot> {
  if (!UUID.test(dealId)) throw new Error("A valid deal UUID is required.");
  const { data, error } = await client.rpc("w3m_read_safe_execution_snapshot", {
    p_deal_id: dealId,
  });
  if (error) throw new Error("Safe execution snapshot RPC failed.");
  if (data === null) throw new Error("Deal was not found.");
  const root = object(data, "response");
  const deal = object(root.deal, "deal");
  const policy = object(root.policy, "policy");
  const project = object(root.project, "project");
  const buyerProfile = object(root.buyer_profile, "buyer profile");
  const sellerProfile = object(root.seller_profile, "seller profile");

  if (text(deal.id, "deal ID") !== dealId ||
      text(policy.deal_id, "policy deal ID") !== dealId ||
      text(project.id, "project ID") !== text(deal.project_id, "deal project ID") ||
      text(buyerProfile.id, "buyer profile ID") !== text(deal.buyer_id, "buyer ID") ||
      text(sellerProfile.id, "seller profile ID") !== text(deal.seller_id, "seller ID")) {
    throw new Error("Safe execution snapshot contains mismatched deal, project, or participant bindings.");
  }

  for (const field of ["amount", "expected_amount"] as const) {
    if (deal[field] !== null) exactDecimal(deal[field], "deal " + field);
  }
  for (const field of ["deal_amount", "fee_percent", "fee_amount", "seller_net_amount"] as const) {
    exactDecimal(policy[field], "policy " + field);
  }
  const policyNonce = text(policy.safe_nonce, "policy Safe nonce");
  if (!UINT.test(policyNonce)) throw new Error("Policy Safe nonce is not an exact unsigned integer.");

  if (deal.chain_id !== "56" || policy.chain_id !== "56" ||
      text(deal.safe_address, "deal Safe address").toLowerCase() !==
        text(policy.safe_address, "policy Safe address").toLowerCase() ||
      text(deal.token_contract, "deal token contract").toLowerCase() !==
        text(policy.token_contract, "policy token contract").toLowerCase()) {
    throw new Error("Safe execution snapshot chain, Safe, or token binding is inconsistent.");
  }

  const txRows = array(root.release_transactions, "release transaction list");
  if (txRows.length !== 1) {
    throw new Error("Safe execution requires exactly one legacy release transaction row; zero or multiple rows are ambiguous.");
  }
  const releaseTransaction = object(txRows[0], "release transaction");
  if (text(releaseTransaction.deal_id, "transaction deal ID") !== dealId ||
      releaseTransaction.action !== "release_to_seller" ||
      releaseTransaction.status !== "signed" ||
      !HASH.test(text(releaseTransaction.safe_tx_hash, "Safe transaction hash")) ||
      releaseTransaction.chain_id !== "56" ||
      text(releaseTransaction.safe_address, "transaction Safe address").toLowerCase() !==
        text(policy.safe_address, "policy Safe address").toLowerCase()) {
    throw new Error("Safe release transaction is not the exact signed BNB release for this deal.");
  }
  exactDecimal(releaseTransaction.value_wei, "Safe transaction native value");
  if (releaseTransaction.value_wei !== "0" ||
      text(releaseTransaction.to_address, "Safe transaction target").toLowerCase() !== MULTISEND_CALL_ONLY ||
      Number(releaseTransaction.operation) !== 1) {
    throw new Error("Safe release transaction must target the approved MultiSendCallOnly contract with zero value and DELEGATECALL.");
  }
  const transactionNonce = text(releaseTransaction.safe_nonce, "transaction Safe nonce");
  if (!UINT.test(transactionNonce) || transactionNonce !== policyNonce) {
    throw new Error("Stored Safe transaction nonce does not match the locked release policy.");
  }
  exactDecimal(releaseTransaction.safe_tx_gas, "Safe transaction gas");
  exactDecimal(releaseTransaction.base_gas, "Safe transaction base gas");
  exactDecimal(releaseTransaction.gas_price, "Safe transaction gas price");
  if (!ADDRESS.test(text(releaseTransaction.to_address, "Safe transaction target")) ||
      typeof releaseTransaction.data !== "string" ||
      !/^0x(?:[0-9a-f]{2})*$/i.test(releaseTransaction.data) ||
      ![0, 1].includes(Number(releaseTransaction.operation))) {
    throw new Error("Safe release transaction calldata or operation is malformed.");
  }

  const safeHash = String(releaseTransaction.safe_tx_hash).toLowerCase();
  const tokenSymbol = text(deal.token_symbol, "deal token symbol");
  if (text(policy.token_symbol, "policy token symbol") !== tokenSymbol ||
      text(releaseTransaction.token_symbol, "transaction token symbol") !== tokenSymbol) {
    throw new Error("Deal, policy, and stored Safe transaction token symbols do not match.");
  }
  const allSignerRows = array(root.signers, "signer list").map((value, index) =>
    object(value, "signer row " + index));
  const signers = allSignerRows.filter((row) => row.signature_status === "signed").map((row, index) => {
    const walletAddress = text(row.wallet_address, "signer wallet");
    const signature = text(row.signature, "signer signature");
    const signerHash = text(row.safe_tx_hash, "signer Safe transaction hash");
    if (!ADDRESS.test(walletAddress) || !SIGNATURE.test(signature) ||
        !HASH.test(signerHash) || signerHash.toLowerCase() !== safeHash) {
      throw new Error("Stored Safe signer row is malformed or bound to another transaction hash.");
    }
    return {
      signerRole: text(row.signer_role, "signer role"),
      signerId: nullableText(row.signer_id),
      walletAddress,
      signatureStatus: text(row.signature_status, "signature status"),
      signedAt: timestamp(row.signed_at),
      safeTransactionHash: signerHash,
      signature,
    };
  });
  for (const signer of signers) {
    const wallet = signer.walletAddress.toLowerCase();
    if (signer.signerRole === "buyer") {
      if (signer.signerId !== deal.buyer_id ||
          wallet !== String(buyerProfile.wallet_address).toLowerCase()) {
        throw new Error("Stored buyer signature is not bound to the deal buyer and verified wallet.");
      }
    } else if (signer.signerRole === "seller") {
      if (signer.signerId !== deal.seller_id ||
          wallet !== String(sellerProfile.wallet_address).toLowerCase()) {
        throw new Error("Stored seller signature is not bound to the deal seller and verified wallet.");
      }
    } else if (signer.signerRole === "platform") {
      if (wallet !== PLATFORM_WALLET) {
        throw new Error("Stored platform signature is not bound to the configured platform wallet.");
      }
    } else {
      throw new Error("Stored Safe signer role is not recognized.");
    }
  }
  const signerWallets = signers.map((row) => row.walletAddress.toLowerCase());
  if (new Set(signerWallets).size !== signerWallets.length) {
    throw new Error("Duplicate stored Safe signer wallets are not allowed.");
  }

  const agreementRows = array(root.party_agreements, "party agreements");
  const agreements: SafeExecutionSnapshotPartyAgreement[] = agreementRows.map((value, index) => {
    const row = object(value, "party agreement " + index);
    if (row.party_role !== "buyer" && row.party_role !== "seller") {
      throw new Error("Party agreement role is invalid.");
    }
    return {
      partyRole: row.party_role,
      partyId: text(row.party_id, "agreement party ID"),
      agreedAt: timestamp(row.agreed_at),
      // The deployed agreement table stores only party identity and a timestamp.
      // No historical terms hash/version or wallet signature exists to verify.
      termsHash: null,
      termsVersion: null,
      signature: null,
    };
  });
  const roles = agreements.map((row) => row.partyRole);
  if (agreements.length !== 2 || new Set(roles).size !== 2 ||
      !agreements.some((row) => row.partyRole === "buyer" && row.partyId === deal.buyer_id && row.agreedAt) ||
      !agreements.some((row) => row.partyRole === "seller" && row.partyId === deal.seller_id && row.agreedAt)) {
    throw new Error("Buyer and seller agreement acknowledgement rows are missing, duplicated, or misbound.");
  }

  const blockers: string[] = [];
  if (root.agreement_binding_supported !== true) {
    blockers.push("IMMUTABLE_AGREEMENT_TERMS_BINDING_UNSUPPORTED");
  }
  if (deal.dispute_status !== "none" || root.dispute !== null) {
    blockers.push("DEAL_DISPUTE_STATE_NOT_CLEAR");
  }
  if (deal.payment_status !== "confirmed" || !HASH.test(String(deal.payment_tx_hash ?? ""))) {
    blockers.push("PAYMENT_STATE_NOT_CONFIRMED");
  }
  if (deal.delivery_status !== "accepted" || !timestamp(deal.buyer_approved_at)) {
    blockers.push("BUYER_DELIVERY_ACCEPTANCE_MISSING");
  }
  if (buyerProfile.wallet_verified !== true || !ADDRESS.test(String(buyerProfile.wallet_address ?? "")) ||
      !timestamp(buyerProfile.wallet_verified_at) ||
      sellerProfile.wallet_verified !== true || !ADDRESS.test(String(sellerProfile.wallet_address ?? "")) ||
      !timestamp(sellerProfile.wallet_verified_at)) {
    blockers.push("PARTICIPANT_WALLET_VERIFICATION_MISSING");
  }
  if (text(policy.seller_wallet, "policy seller wallet").toLowerCase() !==
      String(sellerProfile.wallet_address).toLowerCase()) {
    blockers.push("POLICY_SELLER_WALLET_MISMATCH");
  }
  if (text(policy.platform_wallet, "policy platform wallet").toLowerCase() !== PLATFORM_WALLET) {
    blockers.push("POLICY_PLATFORM_WALLET_MISMATCH");
  }
  if (text(project.owner_id, "project owner ID") !== text(deal.seller_id, "deal seller ID")) {
    blockers.push("PROJECT_OWNER_SELLER_MISMATCH");
  }
  if (signers.length < 2) blockers.push("SAFE_SIGNATURES_BELOW_THRESHOLD");

  return {
    deal,
    policy,
    project,
    buyerProfile,
    sellerProfile,
    releaseTransaction,
    signers,
    partyAgreements: agreements,
    dispute: root.dispute === null ? null : object(root.dispute, "dispute"),
    blockers: [...new Set(blockers)],
  };
}


/** Execution callers must use this wrapper rather than ignoring snapshot blockers. */
export async function loadReadySafeExecutionDatabaseSnapshot(
  client: W3MRpcClient,
  dealId: string,
): Promise<SafeExecutionDatabaseSnapshot> {
  const snapshot = await loadSafeExecutionDatabaseSnapshot(client, dealId);
  if (snapshot.blockers.length > 0) {
    throw new Error("W3M Safe execution snapshot is blocked: " + snapshot.blockers.join(", "));
  }
  return snapshot;
}
