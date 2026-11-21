// W3M Protocol V1 — isolated buyer-refund finalization endpoint.
// Server-side only: reloads immutable request state, validates current participants
// and Safe configuration, verifies the canonical BNB receipt, then atomically finalizes.
// It never signs or broadcasts a transaction and is not deployed to production.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import type { JsonRpcClient } from "../w3m-acquisition-verification/bnb-revenue-adapter.ts";
import { createAllowlistedBnbRpcClient } from "../w3m-acquisition-verification/bnb-revenue-adapter.ts";
import { readCanonicalBnbSafeConfigurationFacts } from "../w3m-acquisition-verification/bnb-safe-configuration-facts-reader.ts";
import { verifyBnbSafeBuyerRefundReceipt } from "../w3m-acquisition-verification/bnb-safe-refund-receipt-verifier.ts";
import { handleBuyerRefundFinalization } from "../w3m-acquisition-verification/buyer-refund-finalization-handler.ts";
import type { BuyerRefundFinalizationContext } from "../w3m-acquisition-verification/buyer-refund-finalization-handler.ts";
import { finalizeBuyerRefundAtomically } from "../w3m-acquisition-verification/buyer-refund-finalization-persistence-adapter.ts";
import type { W3MRpcClient } from "../w3m-acquisition-verification/supabase-rpc-adapter.ts";
import { authenticateVerifiedAdminAal2 } from "../w3m-acquisition-verification/verified-admin-aal2.ts";
import { parseW3MRefundAmount } from "../w3m-acquisition-verification/buyer-refund-amount-validator.ts";


type W3MRefundFinalizeEndpointDependencies = {
  getEnv(name: string): string | undefined;
  createClient: typeof createClient;
  createRpcClient: typeof createAllowlistedBnbRpcClient;
  readSafeConfiguration: typeof readCanonicalBnbSafeConfigurationFacts;
  verifyReceipt: typeof verifyBnbSafeBuyerRefundReceipt;
  handleFinalization: typeof handleBuyerRefundFinalization;
  finalizeAtomically: typeof finalizeBuyerRefundAtomically;
};

const ORIGINS = new Set(["https://web3market.xyz", "https://www.web3market.xyz"]);
const PLATFORM = "0x2b15cc63ee3b833f502c065767695fa2b584f8c9";
const USDT = "0x55d398326f99059ff775485246999027b3197955";
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const cors = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
const json = (status: number, body: Record<string, unknown>, origin: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
function required(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(label + " missing");
  return value;
}
function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(label + " malformed");
  return value as Record<string, unknown>;
}
function addr(value: unknown, label: string): string {
  const v = required(value, label);
  if (!ADDRESS.test(v)) throw new Error(label + " malformed");
  return v.toLowerCase();
}
function txHash(value: unknown, label: string): string {
  const v = required(value, label);
  if (!HASH.test(v)) throw new Error(label + " malformed");
  return v.toLowerCase();
}
const amount = parseW3MRefundAmount;
function ownerList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length !== 3) throw new Error("Safe owner snapshot malformed");
  const result = value.map((v) => addr(v, "Safe owner"));
  if (new Set(result).size !== 3) throw new Error("Safe owners are not distinct");
  return result;
}

export function createW3MBuyerRefundFinalizeEndpoint(overrides: Partial<W3MRefundFinalizeEndpointDependencies> = {}) {
  const deps: W3MRefundFinalizeEndpointDependencies = {
    getEnv: (name) => Deno.env.get(name),
    createClient,
    createRpcClient: createAllowlistedBnbRpcClient,
    readSafeConfiguration: readCanonicalBnbSafeConfigurationFacts,
    verifyReceipt: verifyBnbSafeBuyerRefundReceipt,
    handleFinalization: handleBuyerRefundFinalization,
    finalizeAtomically: finalizeBuyerRefundAtomically,
    ...overrides,
  };
  return async (request: Request) => {
  const origin = request.headers.get("origin") ?? "";
  if (!ORIGINS.has(origin)) return new Response(null, { status: 403 });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (request.method !== "POST") return json(405, { ok: false, error: "POST_REQUIRED" }, origin);

  const url = deps.getEnv("SUPABASE_URL");
  const serviceKey = deps.getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json(503, { ok: false, error: "W3M_REFUND_FINALIZE_NOT_CONFIGURED" }, origin);

  let rpc: JsonRpcClient;
  try {
    rpc = deps.createRpcClient({
      rpcUrl: deps.getEnv("BSC_RPC_URL") ?? "https://bsc-rpc.publicnode.com",
      allowedHosts: ["bsc-rpc.publicnode.com"],
    });
  } catch {
    return json(503, { ok: false, error: "W3M_BNB_RPC_NOT_ALLOWED" }, origin);
  }

  const supabase = deps.createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const database: W3MRpcClient = {
    async rpc(name, args) {
      const result = await supabase.rpc(name, args);
      return { data: result.data, error: result.error };
    },
  };
  const response = await deps.handleFinalization(request, {
    authenticate: async (token) => await authenticateVerifiedAdminAal2(supabase, token),
    isAdmin: async (actorId) => {
      const { data, error } = await supabase.from("profiles").select("id,role").eq("id", actorId).maybeSingle();
      if (error) throw new Error("Admin lookup failed");
      return data?.id === actorId && String(data.role ?? "").toLowerCase() === "admin";
    },
    loadFreshContext: async ({ actorId, requestId, broadcastTxHash }): Promise<BuyerRefundFinalizationContext> => {
      if (!UUID.test(actorId) || !UUID.test(requestId) || !HASH.test(broadcastTxHash)) throw new Error("Invalid request binding");
      const { data: requestRow, error: requestError } = await supabase
        .from("w3m_buyer_refund_requests").select("*").eq("id", requestId).maybeSingle();
      if (requestError || !requestRow) throw new Error("Refund request lookup failed");
      const refund = asObject(requestRow, "Refund request");
      const dealId = required(refund.deal_id, "Deal ID");
      const decisionId = required(refund.decision_id, "Decision ID");
      const safeTxId = required(refund.safe_transaction_id, "Safe transaction ID");
      if (!UUID.test(dealId) || !UUID.test(decisionId) || !UUID.test(safeTxId) ||
          refund.status !== "awaiting_signatures") throw new Error("Refund request state invalid");

      const [dealQ, safeTxQ, signaturesQ] = await Promise.all([
        supabase.from("deals")
          .select("id,buyer_id,seller_id,status,dispute_status,payment_status,chain_id,safe_address,token_contract")
          .eq("id", dealId).maybeSingle(),
        supabase.from("deal_multisig_transactions")
          .select("id,deal_id,action,status,tx_hash,safe_tx_hash,safe_address,safe_nonce,confirmations_count,required_signatures")
          .eq("id", safeTxId).eq("deal_id", dealId).maybeSingle(),
        supabase.from("w3m_buyer_refund_signatures")
          .select("signer_id,signer_role,wallet_address,safe_tx_hash").eq("request_id", requestId),
      ]);
      if (dealQ.error || safeTxQ.error || signaturesQ.error) throw new Error("Refund database context lookup failed");
      const deal = asObject(dealQ.data, "Deal");
      const tx = asObject(safeTxQ.data, "Safe transaction");
      if (deal.id !== dealId || tx.id !== safeTxId || tx.deal_id !== dealId || tx.action !== "refund_to_buyer") {
        throw new Error("Refund deal/transaction binding mismatch");
      }

      const buyerId = required(deal.buyer_id, "Buyer ID");
      const sellerId = required(deal.seller_id, "Seller ID");
      const { data: profiles, error: profilesError } = await supabase.from("profiles")
        .select("id,wallet_address,wallet_verified,wallet_verified_at").in("id", [buyerId, sellerId]);
      if (profilesError || !Array.isArray(profiles) || profiles.length !== 2) throw new Error("Participant profiles missing");
      const buyer = asObject(profiles.find((p: Record<string, unknown>) => p.id === buyerId), "Buyer profile");
      const seller = asObject(profiles.find((p: Record<string, unknown>) => p.id === sellerId), "Seller profile");
      const buyerWallet = addr(buyer.wallet_address, "Buyer wallet");
      const sellerWallet = addr(seller.wallet_address, "Seller wallet");
      if (buyer.wallet_verified !== true || seller.wallet_verified !== true ||
          !Number.isFinite(Date.parse(String(buyer.wallet_verified_at ?? ""))) ||
          !Number.isFinite(Date.parse(String(seller.wallet_verified_at ?? ""))) ||
          buyerWallet !== addr(refund.buyer_wallet, "Request buyer wallet")) throw new Error("Verified participant wallet binding changed");

      const recordedOwners = ownerList(refund.safe_owners);
      if (![buyerWallet, sellerWallet, PLATFORM].every((w) => recordedOwners.includes(w)) ||
          new Set([buyerWallet, sellerWallet, PLATFORM]).size !== 3) throw new Error("Stored Safe owners do not match current participants");

      const signatureRows = signaturesQ.data;
      if (!Array.isArray(signatureRows) || signatureRows.length !== 2) throw new Error("Two refund signatures required");
      const signatureWallets = signatureRows.map((raw: Record<string, unknown>) => {
        const wallet = addr(raw.wallet_address, "Signer wallet");
        if (txHash(raw.safe_tx_hash, "Signer Safe hash") !== txHash(refund.safe_tx_hash, "Refund Safe hash") ||
            !recordedOwners.includes(wallet)) throw new Error("Signer not bound to refund Safe");
        if (raw.signer_role === "buyer" && (raw.signer_id !== buyerId || wallet !== buyerWallet)) throw new Error("Buyer signer mismatch");
        if (raw.signer_role === "seller" && (raw.signer_id !== sellerId || wallet !== sellerWallet)) throw new Error("Seller signer mismatch");
        if (raw.signer_role === "platform" && wallet !== PLATFORM) throw new Error("Platform signer mismatch");
        if (!["buyer", "seller", "platform"].includes(String(raw.signer_role))) throw new Error("Unknown signer role");
        return wallet;
      });
      if (new Set(signatureWallets).size !== 2) throw new Error("Duplicate refund signer wallets");

      const safeAddress = addr(refund.safe_address, "Refund Safe");
      const tokenAddress = addr(refund.token_address, "Refund token");
      if (safeAddress !== addr(deal.safe_address, "Deal Safe") ||
          tokenAddress !== USDT || tokenAddress !== addr(deal.token_contract, "Deal token") ||
          deal.chain_id !== 56 || refund.chain_id !== 56 ||
          addr(tx.safe_address, "Transaction Safe") !== safeAddress ||
          txHash(tx.safe_tx_hash, "Transaction Safe hash") !== txHash(refund.safe_tx_hash, "Request Safe hash") ||
          String(tx.safe_nonce) !== String(refund.safe_nonce) ||
          tx.required_signatures !== 2 || tx.confirmations_count !== 2 ||
          !["signed", "submitted"].includes(String(tx.status)) ||
          (tx.tx_hash && txHash(tx.tx_hash, "Recorded broadcast hash") !== broadcastTxHash)) {
        throw new Error("Refund Safe transaction does not match request");
      }

      const live = await deps.readSafeConfiguration(rpc, {
        safeAddress, expectedSafeAddress: safeAddress, expectedOwners: recordedOwners,
        expectedThreshold: 2, expectedVersion: "1.4.1", expectedChainId: 56,
      });
      if (!live.valid || live.chainId !== 56 || live.threshold !== 2 || live.version !== "1.4.1" || live.owners.length !== 3) {
        throw new Error("Live canonical Safe configuration mismatch");
      }
      const expectation = {
        broadcastTxHash,
        safeTxHash: txHash(refund.safe_tx_hash, "Safe transaction hash"),
        safeAddress, tokenContract: tokenAddress, buyerWallet,
        buyerRefundAmount: amount(refund.refund_amount, "Refund amount"),
        originalDealAmount: amount(refund.original_deal_amount, "Original deal amount"),
        platformWallet: addr(refund.platform_wallet, "Platform wallet"),
        platformFeeAmount: amount(refund.platform_fee_amount, "Platform fee"),
        minConfirmations: 6, decisionId,
        decisionHash: required(refund.decision_hash, "Decision hash"),
        termsHash: required(refund.terms_hash, "Terms hash"),
      };
      if (expectation.platformWallet !== PLATFORM || deal.status !== "disputed" ||
          deal.dispute_status !== "resolved_buyer" || deal.payment_status !== "confirmed") {
        throw new Error("Deal is not ready for buyer refund finalization");
      }
      return {
        actorId, dealId, requestId, decisionId,
        decisionHash: expectation.decisionHash.replace(/^0x/i, ""),
        termsHash: expectation.termsHash, safeAddress,
        safeTransactionHash: expectation.safeTxHash,
        safeNonce: String(refund.safe_nonce), chainId: 56,
        signerCount: signatureRows.length, signatureWallets,
        currentOwners: live.owners, recordedOwners,
        currentThreshold: live.threshold, requiredSignatures: 2,
        transactionStatus: tx.status as "signed" | "submitted", expectation,
      };
    },
    verifyReceipt: async (expectation) => await deps.verifyReceipt(rpc, expectation),
    finalizeAtomically: async (input) => await deps.finalizeAtomically(database, input),
  });

  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors(origin))) headers.set(key, value);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, headers });
  };
}

if (import.meta.main) Deno.serve(createW3MBuyerRefundFinalizeEndpoint());
