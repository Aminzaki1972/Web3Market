// W3M Protocol V1 — strict server-only adapter for the exact Safe EXECUTE snapshot RPC.
// This adapter does not authorize, sign, broadcast, or finalize a Safe transaction.
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";
import { canonicalJson } from "./decision-engine.ts";
import { computeDealTermsHash } from "./deal-terms-hash.ts";
import type { DealCodeAuditBinding } from "./deal-code-audit-binding.ts";
import {
  verifyDealTermsAcceptanceSignature,
  type DealAgreementPartyRole,
} from "./deal-agreement-eip712.ts";

export interface SafeExecutionSnapshotPartyAgreement {
  partyRole: "buyer" | "seller";
  partyId: string;
  agreedAt: string | null;
  termsHash: null;
  termsVersion: null;
  signature: null;
}

export interface SafeExecutionSnapshotTermsVersion {
  id: string;
  dealId: string;
  termsVersion: string;
  projectId: string;
  buyerId: string;
  sellerId: string;
  chainId: string;
  safeAddress: string;
  termsHash: string;
  canonicalTerms: Record<string, unknown>;
}

export interface SafeExecutionSnapshotAgreementAcceptance {
  id: string;
  termsVersionId: string;
  dealId: string;
  termsVersion: string;
  partyRole: DealAgreementPartyRole;
  partyId: string;
  walletAddress: string;
  chainId: string;
  safeAddress: string;
  termsHash: string;
  typedDataDigest: string;
  signature: string;
  acceptedAt: string | null;
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
  termsVersion: SafeExecutionSnapshotTermsVersion | null;
  agreementAcceptances: SafeExecutionSnapshotAgreementAcceptance[];
  codeAudit: DealCodeAuditBinding;
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
  phase: "SIGN" | "EXECUTE" = "EXECUTE",
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
  const rawCodeAudit = object(root.code_audit, "current Code Audit manifest binding");
  const auditType = text(rawCodeAudit.auditType, "Code Audit type");
  if (!["code", "smart_contract", "complete"].includes(auditType)) {
    throw new Error("Safe execution snapshot Code Audit type is unsupported.");
  }
  const codeAudit: DealCodeAuditBinding = {
    auditId: text(rawCodeAudit.auditId, "Code Audit ID"),
    repositoryOwner: text(rawCodeAudit.repositoryOwner, "Code Audit repository owner"),
    repositoryName: text(rawCodeAudit.repositoryName, "Code Audit repository name"),
    repositoryUrl: text(rawCodeAudit.repositoryUrl, "Code Audit repository URL"),
    commitSha: text(rawCodeAudit.commitSha, "Code Audit commit SHA"),
    auditType: auditType as DealCodeAuditBinding["auditType"],
    completedAt: text(rawCodeAudit.completedAt, "Code Audit completion timestamp"),
    auditEvidenceHash: text(rawCodeAudit.auditEvidenceHash, "Code Audit manifest hash"),
  };

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
      (phase === "EXECUTE" && releaseTransaction.status !== "signed") ||
      (phase === "SIGN" && releaseTransaction.status !== "awaiting_signatures" && releaseTransaction.status !== "signed") ||
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

  // Legacy timestamp-only acknowledgements are retained for audit context only.
  // They are never used as authorization; immutable EIP-712 rows below are authoritative.
  const legacyAgreementRows = Array.isArray(root.party_agreements) ? root.party_agreements : [];
  const agreements: SafeExecutionSnapshotPartyAgreement[] = legacyAgreementRows.flatMap((value, index) => {
    const row = object(value, "legacy party agreement " + index);
    if (row.party_role !== "buyer" && row.party_role !== "seller") return [];
    return [{
      partyRole: row.party_role,
      partyId: text(row.party_id, "legacy agreement party ID"),
      agreedAt: timestamp(row.agreed_at),
      termsHash: null,
      termsVersion: null,
      signature: null,
    }];
  });

  let termsVersion: SafeExecutionSnapshotTermsVersion | null = null;
  const agreementAcceptances: SafeExecutionSnapshotAgreementAcceptance[] = [];
  const rawVersion = root.terms_version;
  if (rawVersion !== null && rawVersion !== undefined) {
    const row = object(rawVersion, "canonical terms version");
    const termsVersionText = text(row.terms_version, "terms version");
    if (!UINT.test(termsVersionText) || termsVersionText === "0") {
      throw new Error("Safe execution snapshot terms version is not a positive integer.");
    }
    const canonicalTerms = object(row.canonical_terms, "canonical terms");
    const termsHash = text(row.terms_hash, "canonical terms hash");
    if (!/^[0-9a-f]{64}$/.test(termsHash)) {
      throw new Error("Safe execution snapshot terms hash is malformed.");
    }
    termsVersion = {
      id: text(row.id, "terms version ID"),
      dealId: text(row.deal_id, "terms version deal ID"),
      termsVersion: termsVersionText,
      projectId: text(row.project_id, "terms version project ID"),
      buyerId: text(row.buyer_id, "terms version buyer ID"),
      sellerId: text(row.seller_id, "terms version seller ID"),
      chainId: text(row.chain_id, "terms version chain ID"),
      safeAddress: text(row.safe_address, "terms version Safe address"),
      termsHash,
      canonicalTerms,
    };
    if (termsVersion.dealId !== dealId ||
        termsVersion.projectId !== deal.project_id ||
        termsVersion.buyerId !== deal.buyer_id ||
        termsVersion.sellerId !== deal.seller_id ||
        termsVersion.chainId !== "56" ||
        termsVersion.safeAddress.toLowerCase() !== String(policy.safe_address).toLowerCase()) {
      throw new Error("Canonical terms version is bound to another deal, project, party, chain, or Safe.");
    }

    const currentTerms = await computeDealTermsHash({
      dealId,
      projectId: text(deal.project_id, "deal project ID"),
      buyerId: text(deal.buyer_id, "buyer ID"),
      sellerId: text(deal.seller_id, "seller ID"),
      amount: exactDecimal(deal.amount, "deal amount"),
      currency: text(deal.currency, "deal currency"),
      expectedAmount: deal.expected_amount === null ? null : exactDecimal(deal.expected_amount, "expected amount"),
      chainId: Number(deal.chain_id),
      safeAddress: text(deal.safe_address, "deal Safe address"),
      tokenContract: text(deal.token_contract, "deal token contract"),
      codeAudit,
      policy: {
        dealAmount: exactDecimal(policy.deal_amount, "policy deal amount"),
        feePercent: exactDecimal(policy.fee_percent, "policy fee percent"),
        feeAmount: exactDecimal(policy.fee_amount, "policy fee amount"),
        sellerNetAmount: exactDecimal(policy.seller_net_amount, "policy seller net amount"),
        chainId: Number(policy.chain_id),
        safeAddress: text(policy.safe_address, "policy Safe address"),
        tokenContract: text(policy.token_contract, "policy token contract"),
        sellerWallet: text(policy.seller_wallet, "policy seller wallet"),
        platformWallet: text(policy.platform_wallet, "policy platform wallet"),
        safeNonce: policyNonce,
        status: text(policy.status, "policy status") as "locked" | "ready",
      },
    });
    if (currentTerms.dealTermsHash !== termsVersion.termsHash ||
        canonicalJson(currentTerms.canonicalTerms) !== canonicalJson(termsVersion.canonicalTerms)) {
      throw new Error("Persisted agreement terms version does not match the current canonical deal terms.");
    }

    const rawAcceptances = array(root.agreement_acceptances, "immutable agreement acceptances");
    for (const [index, value] of rawAcceptances.entries()) {
      const acceptance = object(value, "agreement acceptance " + index);
      if (acceptance.party_role !== "buyer" && acceptance.party_role !== "seller") {
        throw new Error("Immutable agreement acceptance role is invalid.");
      }
      const accepted: SafeExecutionSnapshotAgreementAcceptance = {
        id: text(acceptance.id, "acceptance ID"),
        termsVersionId: text(acceptance.terms_version_id, "acceptance terms version ID"),
        dealId: text(acceptance.deal_id, "acceptance deal ID"),
        termsVersion: text(acceptance.terms_version, "acceptance terms version"),
        partyRole: acceptance.party_role,
        partyId: text(acceptance.party_id, "acceptance party ID"),
        walletAddress: text(acceptance.wallet_address, "acceptance wallet"),
        chainId: text(acceptance.chain_id, "acceptance chain"),
        safeAddress: text(acceptance.safe_address, "acceptance Safe address"),
        termsHash: text(acceptance.terms_hash, "acceptance terms hash"),
        typedDataDigest: text(acceptance.typed_data_digest, "acceptance typed-data digest"),
        signature: text(acceptance.signature, "acceptance signature"),
        acceptedAt: timestamp(acceptance.accepted_at),
      };
      const expectedPartyId = accepted.partyRole === "buyer" ? text(deal.buyer_id, "buyer ID") : text(deal.seller_id, "seller ID");
      const expectedWallet = accepted.partyRole === "buyer"
        ? text(buyerProfile.wallet_address, "verified buyer wallet")
        : text(sellerProfile.wallet_address, "verified seller wallet");
      if (accepted.dealId !== dealId ||
          accepted.termsVersionId !== termsVersion.id ||
          accepted.termsVersion !== termsVersion.termsVersion ||
          accepted.partyId !== expectedPartyId ||
          accepted.walletAddress.toLowerCase() !== expectedWallet.toLowerCase() ||
          accepted.chainId !== "56" ||
          accepted.safeAddress.toLowerCase() !== termsVersion.safeAddress.toLowerCase() ||
          accepted.termsHash !== termsVersion.termsHash ||
          !HASH.test(accepted.typedDataDigest) ||
          !SIGNATURE.test(accepted.signature) ||
          !accepted.acceptedAt) {
        throw new Error("Immutable agreement acceptance is malformed or bound to different signed terms.");
      }
      const verification = verifyDealTermsAcceptanceSignature({
        acceptance: {
          dealId, projectId: termsVersion.projectId, buyerId: termsVersion.buyerId,
          sellerId: termsVersion.sellerId, safeAddress: termsVersion.safeAddress,
          termsHash: termsVersion.termsHash, termsVersion: termsVersion.termsVersion,
          partyRole: accepted.partyRole,
        },
        signature: accepted.signature,
        expectedWallet,
      });
      if (!verification.valid || verification.digest.toLowerCase() !== accepted.typedDataDigest.toLowerCase()) {
        throw new Error("Immutable agreement EIP-712 signature recovery failed.");
      }
      agreementAcceptances.push(accepted);
    }
  } else if (root.agreement_acceptances !== undefined &&
      array(root.agreement_acceptances, "immutable agreement acceptances").length > 0) {
    throw new Error("Agreement acceptances exist without a canonical terms version.");
  }

  const blockers: string[] = [];
  if (root.agreement_binding_supported !== true || !termsVersion) {
    blockers.push("IMMUTABLE_AGREEMENT_TERMS_BINDING_UNSUPPORTED");
  }
  const acceptedRoles = agreementAcceptances.map((row) => row.partyRole);
  if (agreementAcceptances.length !== 2 || new Set(acceptedRoles).size !== 2 ||
      !agreementAcceptances.some((row) => row.partyRole === "buyer") ||
      !agreementAcceptances.some((row) => row.partyRole === "seller")) {
    blockers.push("IMMUTABLE_AGREEMENT_ACCEPTANCES_INCOMPLETE");
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
  if (phase === "EXECUTE" && signers.length < 2) blockers.push("SAFE_SIGNATURES_BELOW_THRESHOLD");

  return {
    deal,
    policy,
    project,
    buyerProfile,
    sellerProfile,
    releaseTransaction,
    signers,
    partyAgreements: agreements,
    termsVersion,
    agreementAcceptances,
    codeAudit,
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
