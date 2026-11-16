// W3M Protocol V1 — isolated non-custodial buyer-refund Safe SIGN endpoint.
// Authenticates the participant, reloads immutable refund/deal/decision/terms state,
// recomputes the Safe transaction hash against canonical BNB state, recovers the
// raw-digest signature, then writes through the service-role atomic SIGN RPC.
// It never signs for the user, broadcasts, or moves funds; not deployed.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createAllowlistedBnbRpcClient, type JsonRpcClient } from "../w3m-acquisition-verification/bnb-revenue-adapter.ts";
import { readCanonicalBnbSafeExecutionFacts } from "../w3m-acquisition-verification/bnb-safe-execution-facts-reader.ts";
import { verifyEthereumRawDigestSignature } from "../w3m-acquisition-verification/ethereum-signature-adapter.ts";
import { createBuyerRefundSignRequestHandler } from "../w3m-acquisition-verification/buyer-refund-sign-request-handler.ts";
import { persistBuyerRefundSignatureAtomically } from "../w3m-acquisition-verification/buyer-refund-signature-persistence-adapter.ts";
import type { W3MRpcClient } from "../w3m-acquisition-verification/supabase-rpc-adapter.ts";

const ORIGINS = new Set(["https://web3market.xyz", "https://www.web3market.xyz"]);
const PLATFORM = "0x2b15cc63ee3b833f502c065767695fa2b584f8c9";
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
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
function obj(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(label + " malformed");
  return value as Record<string, unknown>;
}
function addr(value: unknown, label: string): string {
  if (typeof value !== "string" || !ADDRESS.test(value)) throw new Error(label + " malformed");
  return value.toLowerCase();
}
function hash(value: unknown, label: string): string {
  if (typeof value !== "string" || !HASH.test(value)) throw new Error(label + " malformed");
  return value.toLowerCase();
}
function uint(value: unknown, label: string): string {
  const v = typeof value === "number" ? String(value) : value;
  if (typeof v !== "string" || !/^(0|[1-9][0-9]*)$/.test(v)) throw new Error(label + " malformed");
  return v;
}
function owners(value: unknown): string[] {
  if (!Array.isArray(value) || value.length !== 3) throw new Error("Recorded Safe owners malformed");
  const result = value.map((x) => addr(x, "Safe owner"));
  if (new Set(result).size !== 3) throw new Error("Recorded Safe owners are not distinct");
  return result;
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") ?? "";
  if (!ORIGINS.has(origin)) return new Response(null, { status: 403 });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (request.method !== "POST") return json(405, { ok: false, error: "POST_REQUIRED" }, origin);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json(503, { ok: false, error: "W3M_REFUND_SIGN_NOT_CONFIGURED" }, origin);
  let rpc: JsonRpcClient;
  try {
    rpc = createAllowlistedBnbRpcClient({
      rpcUrl: Deno.env.get("BSC_RPC_URL") ?? "https://bsc-rpc.publicnode.com",
      allowedHosts: ["bsc-rpc.publicnode.com"],
    });
  } catch {
    return json(503, { ok: false, error: "W3M_BNB_RPC_NOT_ALLOWED" }, origin);
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const database: W3MRpcClient = {
    async rpc(name, args) {
      const result = await supabase.rpc(name, args);
      return { data: result.data, error: result.error };
    },
  };

  const handler = createBuyerRefundSignRequestHandler({
    authenticate: async (incoming) => {
      const authorization = incoming.headers.get("authorization") ?? "";
      const match = /^Bearer\s+(.+)$/i.exec(authorization);
      if (!match) return null;
      const { data, error } = await supabase.auth.getUser(match[1]);
      return error || !data.user?.id ? null : { userId: data.user.id };
    },
    loadFreshContext: async ({ actorId, dealId, requestId, decisionId, safeTransactionHash }) => {
      if (!UUID.test(actorId) || !UUID.test(dealId) || !UUID.test(requestId) || !UUID.test(decisionId) || !HASH.test(safeTransactionHash)) {
        throw new Error("Refund SIGN request binding malformed");
      }
      const { data: requestData, error: requestError } = await supabase.from("w3m_buyer_refund_requests")
        .select("*").eq("id", requestId).eq("deal_id", dealId).maybeSingle();
      if (requestError || !requestData) throw new Error("Refund request unavailable");
      const refund = obj(requestData, "Refund request");
      if (refund.status !== "awaiting_signatures" || refund.decision_id !== decisionId ||
          hash(refund.safe_tx_hash, "Stored Safe hash") !== safeTransactionHash.toLowerCase()) {
        throw new Error("Refund request is not signable or request binding changed");
      }
      const dealIdFromRow = String(refund.deal_id ?? "");
      const disputeId = String(refund.dispute_id ?? "");
      const [dealQ, txQ, decisionQ, disputeQ, termsQ] = await Promise.all([
        supabase.from("deals").select("id,buyer_id,seller_id,status,dispute_status,payment_status,chain_id,safe_address,token_contract")
          .eq("id", dealIdFromRow).maybeSingle(),
        supabase.from("deal_multisig_transactions").select("id,deal_id,action,status,safe_address,safe_tx_hash,safe_nonce,to_address,data,value_wei,operation,safe_tx_gas,base_gas,gas_price,gas_token,refund_receiver,required_signatures")
          .eq("id", refund.safe_transaction_id).eq("deal_id", dealIdFromRow).maybeSingle(),
        supabase.from("w3m_deal_dispute_decisions").select("id,deal_id,dispute_id,outcome,decision_hash,terms_hash,terms_version_id,terms_version")
          .eq("id", decisionId).eq("deal_id", dealIdFromRow).maybeSingle(),
        supabase.from("deal_disputes").select("id,deal_id,status,resolution")
          .eq("id", disputeId).eq("deal_id", dealIdFromRow).maybeSingle(),
        supabase.from("w3m_deal_terms_versions").select("id,deal_id,terms_hash,terms_version,chain_id,safe_address,buyer_id,seller_id")
          .eq("id", (await supabase.from("w3m_deal_dispute_decisions").select("terms_version_id").eq("id", decisionId).maybeSingle()).data?.terms_version_id ?? "")
          .eq("deal_id", dealIdFromRow).maybeSingle(),
      ]);
      if (dealQ.error || txQ.error || decisionQ.error || disputeQ.error || termsQ.error ||
          !dealQ.data || !txQ.data || !decisionQ.data || !disputeQ.data || !termsQ.data) {
        throw new Error("Fresh refund SIGN records unavailable");
      }
      const deal = obj(dealQ.data, "Deal");
      const tx = obj(txQ.data, "Safe transaction");
      const decision = obj(decisionQ.data, "Decision");
      const dispute = obj(disputeQ.data, "Dispute");
      const terms = obj(termsQ.data, "Signed terms");
      if (deal.id !== dealId || tx.action !== "refund_to_buyer" || tx.status !== "awaiting_signatures" &&
          tx.status !== "signed" || decision.outcome !== "buyer_wins" || decision.dispute_id !== disputeId ||
          decision.deal_id !== dealId || dispute.status !== "resolved" || dispute.resolution !== "buyer_wins" ||
          terms.terms_hash !== refund.terms_hash || decision.terms_hash !== refund.terms_hash ||
          decision.decision_hash !== refund.decision_hash || terms.terms_version !== decision.terms_version ||
          terms.chain_id !== 56 || deal.chain_id !== 56 || deal.status !== "disputed" ||
          deal.dispute_status !== "resolved_buyer" || deal.payment_status !== "confirmed") {
        throw new Error("Refund decision, terms, dispute, or deal state is not signable");
      }
      const [buyerQ, sellerQ] = await Promise.all([
        supabase.from("profiles").select("id,wallet_address,wallet_verified,wallet_verified_at").eq("id", deal.buyer_id).maybeSingle(),
        supabase.from("profiles").select("id,wallet_address,wallet_verified,wallet_verified_at").eq("id", deal.seller_id).maybeSingle(),
      ]);
      if (buyerQ.error || sellerQ.error || !buyerQ.data || !sellerQ.data) throw new Error("Refund participant profiles unavailable");
      const buyer = obj(buyerQ.data, "Buyer profile");
      const seller = obj(sellerQ.data, "Seller profile");
      const buyerWallet = addr(buyer.wallet_address, "Buyer wallet");
      const sellerWallet = addr(seller.wallet_address, "Seller wallet");
      if (buyer.wallet_verified !== true || seller.wallet_verified !== true ||
          !Number.isFinite(Date.parse(String(buyer.wallet_verified_at ?? ""))) ||
          !Number.isFinite(Date.parse(String(seller.wallet_verified_at ?? ""))) ||
          buyer.id !== deal.buyer_id || seller.id !== deal.seller_id ||
          addr(deal.safe_address, "Deal Safe") !== addr(refund.safe_address, "Request Safe") ||
          addr(terms.safe_address, "Terms Safe") !== addr(refund.safe_address, "Request Safe") ||
          addr(deal.token_contract, "Deal token") !== "0x55d398326f99059ff775485246999027b3197955" ||
          addr(refund.token_address, "Request token") !== "0x55d398326f99059ff775485246999027b3197955") {
        throw new Error("Refund participant, Safe, or token binding changed");
      }
      const recordedOwners = owners(refund.safe_owners);
      if (recordedOwners.length !== 3 || ![buyerWallet, sellerWallet, PLATFORM].every((w) => recordedOwners.includes(w)) ||
          new Set([buyerWallet, sellerWallet, PLATFORM]).size !== 3) throw new Error("Refund Safe owner snapshot mismatch");
      const isBuyer = actorId === String(deal.buyer_id);
      const isSeller = actorId === String(deal.seller_id);
      if (isBuyer === isSeller) throw new Error("Only a deal participant may sign the buyer refund");
      const profile = isBuyer ? buyer : seller;
      const verifiedWallet = addr(profile.wallet_address, "Signer wallet");
      const verifiedAt = Date.parse(String(profile.wallet_verified_at));
      if (profile.wallet_verified !== true || !Number.isFinite(verifiedAt) || verifiedAt > Date.now()) {
        throw new Error("Signer wallet verification is not current");
      }
      const safeNonce = uint(refund.safe_nonce, "Refund Safe nonce");
      if (safeNonce !== uint(tx.safe_nonce, "Transaction Safe nonce") ||
          tx.required_signatures !== 2 || addr(tx.safe_address, "Transaction Safe") !== addr(refund.safe_address, "Request Safe") ||
          hash(tx.safe_tx_hash, "Transaction Safe hash") !== hash(refund.safe_tx_hash, "Request Safe hash")) {
        throw new Error("Refund Safe transaction record mismatch");
      }
      const expected = {
        safeAddress: addr(refund.safe_address, "Request Safe"),
        expectedSafeAddress: addr(deal.safe_address, "Deal Safe"),
        expectedOwners: recordedOwners,
        expectedThreshold: 2,
        expectedVersion: "1.4.1",
        expectedChainId: 56,
        expectedNonce: safeNonce,
        storedSafeTransactionHash: hash(refund.safe_tx_hash, "Request Safe hash"),
        transaction: {
          to: addr(tx.to_address, "Safe target"),
          value: uint(tx.value_wei, "Safe value"),
          data: String(tx.data ?? ""),
          operation: Number(tx.operation),
          safeTxGas: uint(tx.safe_tx_gas, "Safe tx gas"),
          baseGas: uint(tx.base_gas, "Safe base gas"),
          gasPrice: uint(tx.gas_price, "Safe gas price"),
          gasToken: addr(tx.gas_token, "Safe gas token"),
          refundReceiver: addr(tx.refund_receiver, "Safe refund receiver"),
          nonce: safeNonce,
        },
      };
      const live = await readCanonicalBnbSafeExecutionFacts(rpc, expected);
      if (!live.valid || live.chainId !== 56 || live.threshold !== 2 ||
          live.version !== "1.4.1" || live.nonce !== safeNonce ||
          live.recomputedSafeTransactionHash?.toLowerCase() !== safeTransactionHash.toLowerCase() ||
          live.owners.map((x) => x.toLowerCase()).sort().join(":") !== recordedOwners.slice().sort().join(":")) {
        throw new Error("Live canonical BNB Safe facts do not authorize refund SIGN: " + live.issues.join(","));
      }
      const { data: signatureRows, error: signatureError } = await supabase.from("w3m_buyer_refund_signatures")
        .select("signer_id,signer_role,wallet_address,safe_tx_hash").eq("request_id", requestId);
      if (signatureError || !Array.isArray(signatureRows) || signatureRows.length > 2) throw new Error("Refund signature registry is unavailable or malformed");
      const alreadySignedByActor = signatureRows.some((row: Record<string, unknown>) =>
        row.signer_id === actorId && String(row.wallet_address ?? "").toLowerCase() === verifiedWallet &&
        String(row.safe_tx_hash ?? "").toLowerCase() === safeTransactionHash.toLowerCase());
      if (signatureRows.length >= 2 && !alreadySignedByActor) throw new Error("Refund Safe already has its required signatures");
      return {
        action: "refund_to_buyer" as const,
        dealId, disputeId, requestId, decisionId,
        decisionHash: String(refund.decision_hash),
        termsHash: String(refund.terms_hash),
        safeTransactionHash: safeTransactionHash.toLowerCase(),
        safeAddress: addr(refund.safe_address, "Request Safe"),
        chainId: 56 as const, safeNonce,
        currentOwners: live.owners,
        threshold: 2,
        verifiedWallet,
        buyerWallet,
        w3mAuthorization: {
          authorized: true as const, phase: "SIGN" as const,
          requestId, safeTransactionHash: safeTransactionHash.toLowerCase(), issues: [] as [],
        },
        signerRole: isBuyer ? "buyer" as const : "seller" as const,
        status: "awaiting_signatures" as const,
      };
    },
    verifySafeDigest: async ({ digest, signature, expectedWallet }) =>
      await verifyEthereumRawDigestSignature({ digestHex: digest, signature, expectedAddress: expectedWallet }),
    persistSignatureAtomically: async (input) =>
      await persistBuyerRefundSignatureAtomically(database, input),
  });
  const response = await handler(request);
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors(origin))) headers.set(key, value);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, headers });
});
