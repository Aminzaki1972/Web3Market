// W3M Protocol V1 — server-side immutable deal agreement signing service.
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";
import { computeDealTermsHash } from "./deal-terms-hash.ts";
import {
  buildDealTermsAcceptanceTypedData,
  computeDealTermsAcceptanceDigest,
  verifyDealTermsAcceptanceSignature,
  type DealAgreementPartyRole,
  type Eip712DealAgreementTypedData,
} from "./deal-agreement-eip712.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label + " is missing or malformed.");
  }
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(label + " is missing.");
  return value;
}
function decimal(value: unknown, label: string): string {
  const result = text(value, label);
  if (!DECIMAL.test(result)) throw new Error(label + " must be exact decimal text.");
  return result;
}
function verifiedWallet(profile: Record<string, unknown>, label: string): string {
  const wallet = text(profile.wallet_address, label + " wallet");
  if (profile.wallet_verified !== true || !ADDRESS.test(wallet) ||
      typeof profile.wallet_verified_at !== "string" ||
      !Number.isFinite(Date.parse(profile.wallet_verified_at))) {
    throw new Error(label + " must have a currently verified wallet.");
  }
  return wallet.toLowerCase();
}

export interface DealAgreementSigningContext {
  dealId: string;
  projectId: string;
  buyerId: string;
  sellerId: string;
  buyerWallet: string;
  sellerWallet: string;
  safeAddress: string;
  termsHash: string;
  canonicalTerms: Record<string, unknown>;
}
export interface PreparedDealAgreement {
  dealId: string;
  partyRole: DealAgreementPartyRole;
  partyId: string;
  walletAddress: string;
  termsHash: string;
  termsVersion: string;
  termsVersionId: string;
  typedData: Eip712DealAgreementTypedData;
}
export interface AcceptedDealAgreement {
  acceptanceId: string;
  dealId: string;
  partyRole: DealAgreementPartyRole;
  termsVersion: string;
  idempotentReplay: boolean;
}

async function loadSigningContext(client: W3MRpcClient, dealId: string): Promise<DealAgreementSigningContext> {
  if (!UUID.test(dealId)) throw new Error("A valid deal UUID is required.");
  const { data, error } = await client.rpc("w3m_read_deal_agreement_signing_snapshot", {
    p_deal_id: dealId,
  });
  if (error) throw new Error("Deal agreement signing snapshot could not be loaded.");
  const root = object(data, "Deal agreement signing snapshot");
  const deal = object(root.deal, "Deal");
  const policy = object(root.policy, "Release policy");
  const project = object(root.project, "Project");
  const buyer = object(root.buyer_profile, "Buyer profile");
  const seller = object(root.seller_profile, "Seller profile");
  const dealIdValue = text(deal.id, "Deal ID");
  const projectId = text(deal.project_id, "Project ID");
  const buyerId = text(deal.buyer_id, "Buyer ID");
  const sellerId = text(deal.seller_id, "Seller ID");
  if (dealIdValue !== dealId || text(policy.deal_id, "Policy deal ID") !== dealId ||
      text(project.id, "Project profile ID") !== projectId ||
      text(buyer.id, "Buyer profile ID") !== buyerId ||
      text(seller.id, "Seller profile ID") !== sellerId ||
      text(project.owner_id, "Current project owner") !== sellerId) {
    throw new Error("Deal agreement snapshot contains mismatched project or participant ownership.");
  }
  if (text(deal.chain_id, "Deal chain") !== "56" ||
      text(policy.chain_id, "Policy chain") !== "56" ||
      text(deal.safe_address, "Deal Safe").toLowerCase() !== text(policy.safe_address, "Policy Safe").toLowerCase() ||
      text(deal.token_contract, "Deal token").toLowerCase() !== text(policy.token_contract, "Policy token").toLowerCase()) {
    throw new Error("Deal agreement is not bound to one consistent BNB Chain Safe and token.");
  }
  const buyerWallet = verifiedWallet(buyer, "Buyer");
  const sellerWallet = verifiedWallet(seller, "Seller");
  if (text(policy.seller_wallet, "Policy seller wallet").toLowerCase() !== sellerWallet) {
    throw new Error("Locked release policy seller wallet differs from the currently verified seller wallet.");
  }
  const safeAddress = text(policy.safe_address, "Policy Safe");
  const terms = await computeDealTermsHash({
    dealId,
    projectId,
    buyerId,
    sellerId,
    amount: decimal(deal.amount, "Deal amount"),
    currency: text(deal.currency, "Deal currency"),
    expectedAmount: deal.expected_amount === null ? null : decimal(deal.expected_amount, "Expected amount"),
    chainId: Number(deal.chain_id),
    safeAddress: text(deal.safe_address, "Deal Safe"),
    tokenContract: text(deal.token_contract, "Deal token"),
    policy: {
      dealAmount: decimal(policy.deal_amount, "Policy deal amount"),
      feePercent: decimal(policy.fee_percent, "Policy fee percent"),
      feeAmount: decimal(policy.fee_amount, "Policy fee amount"),
      sellerNetAmount: decimal(policy.seller_net_amount, "Seller net amount"),
      chainId: Number(policy.chain_id),
      safeAddress: text(policy.safe_address, "Policy Safe"),
      tokenContract: text(policy.token_contract, "Policy token"),
      sellerWallet: text(policy.seller_wallet, "Policy seller wallet"),
      platformWallet: text(policy.platform_wallet, "Policy platform wallet"),
      safeNonce: text(policy.safe_nonce, "Policy Safe nonce"),
      status: text(policy.status, "Policy status") as "locked" | "ready",
    },
  });
  return {
    dealId, projectId, buyerId, sellerId, buyerWallet, sellerWallet,
    safeAddress, termsHash: terms.dealTermsHash, canonicalTerms: terms.canonicalTerms,
  };
}

async function registerVersion(client: W3MRpcClient, context: DealAgreementSigningContext) {
  const { data, error } = await client.rpc("w3m_register_deal_terms_version", {
    p_deal_id: context.dealId,
    p_terms_hash: context.termsHash,
    p_canonical_terms: context.canonicalTerms,
  });
  if (error) throw new Error("Canonical deal terms could not be registered.");
  const result = object(data, "Terms version registration");
  const termsVersion = String(result.terms_version ?? "");
  const termsVersionId = text(result.terms_version_id, "Terms version ID");
  if (!/^[1-9][0-9]*$/.test(termsVersion) || !UUID.test(termsVersionId) ||
      result.deal_id !== context.dealId || result.terms_hash !== context.termsHash ||
      typeof result.idempotent_replay !== "boolean") {
    throw new Error("Terms version registration returned a mismatched response.");
  }
  return { termsVersion, termsVersionId };
}

function roleForActor(context: DealAgreementSigningContext, actorId: string) {
  if (actorId === context.buyerId) return { partyRole: "buyer" as const, partyId: context.buyerId, walletAddress: context.buyerWallet };
  if (actorId === context.sellerId) return { partyRole: "seller" as const, partyId: context.sellerId, walletAddress: context.sellerWallet };
  throw new Error("Only the buyer or seller may sign this acquisition agreement.");
}

export async function prepareDealAgreementAcceptance(
  client: W3MRpcClient,
  input: { dealId: string; actorId: string },
): Promise<PreparedDealAgreement> {
  const context = await loadSigningContext(client, input.dealId);
  const party = roleForActor(context, input.actorId);
  const version = await registerVersion(client, context);
  const acceptance = {
    dealId: context.dealId, projectId: context.projectId,
    buyerId: context.buyerId, sellerId: context.sellerId,
    safeAddress: context.safeAddress, termsHash: context.termsHash,
    termsVersion: version.termsVersion, partyRole: party.partyRole,
  };
  return {
    dealId: context.dealId, ...party, termsHash: context.termsHash,
    termsVersion: version.termsVersion, termsVersionId: version.termsVersionId,
    typedData: buildDealTermsAcceptanceTypedData(acceptance),
  };
}

export async function acceptDealAgreement(
  client: W3MRpcClient,
  input: { dealId: string; actorId: string; signature: string },
): Promise<AcceptedDealAgreement> {
  const context = await loadSigningContext(client, input.dealId);
  const party = roleForActor(context, input.actorId);
  const version = await registerVersion(client, context);
  const acceptance = {
    dealId: context.dealId, projectId: context.projectId,
    buyerId: context.buyerId, sellerId: context.sellerId,
    safeAddress: context.safeAddress, termsHash: context.termsHash,
    termsVersion: version.termsVersion, partyRole: party.partyRole,
  };
  const verification = verifyDealTermsAcceptanceSignature({
    acceptance, signature: input.signature, expectedWallet: party.walletAddress,
  });
  if (!verification.valid) throw new Error("Wallet signature does not match the current verified party wallet and exact deal terms.");
  const { data, error } = await client.rpc("w3m_insert_deal_agreement_acceptance", {
    p_deal_id: context.dealId,
    p_terms_version: version.termsVersion,
    p_party_role: party.partyRole,
    p_party_id: party.partyId,
    p_wallet_address: party.walletAddress,
    p_terms_hash: context.termsHash,
    p_canonical_terms: context.canonicalTerms,
    p_typed_data_digest: verification.digest,
    p_signature: input.signature,
  });
  if (error) throw new Error("Immutable deal agreement acceptance could not be persisted.");
  const result = object(data, "Agreement acceptance");
  if (result.accepted !== true || typeof result.acceptance_id !== "string" ||
      result.deal_id !== undefined && result.deal_id !== context.dealId ||
      String(result.terms_version) !== version.termsVersion ||
      result.party_role !== party.partyRole ||
      typeof result.idempotent_replay !== "boolean") {
    throw new Error("Agreement acceptance RPC returned a mismatched acknowledgement.");
  }
  return {
    acceptanceId: result.acceptance_id,
    dealId: context.dealId,
    partyRole: party.partyRole,
    termsVersion: version.termsVersion,
    idempotentReplay: result.idempotent_replay,
  };
}

export function dealAgreementDigestForPreparedAcceptance(prepared: PreparedDealAgreement): string {
  return computeDealTermsAcceptanceDigest({
    dealId: prepared.dealId,
    projectId: prepared.typedData.message.projectId,
    buyerId: prepared.typedData.message.buyerId,
    sellerId: prepared.typedData.message.sellerId,
    safeAddress: prepared.typedData.message.safeAddress,
    termsHash: prepared.termsHash,
    termsVersion: prepared.termsVersion,
    partyRole: prepared.partyRole,
  });
}
