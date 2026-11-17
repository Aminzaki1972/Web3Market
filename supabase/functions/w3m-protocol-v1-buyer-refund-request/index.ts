// W3M Protocol V1 — isolated buyer-win refund request preparation endpoint.
// Read-only BNB verification + one atomic DB request write. Never signs, broadcasts,
// or transfers funds. This candidate is not deployed to Supabase.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import type { JsonRpcClient } from "../w3m-acquisition-verification/bnb-revenue-adapter.ts";
import { createAllowlistedBnbRpcClient } from "../w3m-acquisition-verification/bnb-revenue-adapter.ts";
import { handleW3MBuyerRefundRequest } from "../w3m-acquisition-verification/buyer-refund-request-handler.ts";
import { readBuyerRefundRequestSnapshot } from "../w3m-acquisition-verification/buyer-refund-request-snapshot-adapter.ts";
import { canonicalJson, sha256Hex } from "../w3m-acquisition-verification/decision-engine.ts";
import { verifyBuyerRefundAgreementAcceptances } from "../w3m-acquisition-verification/buyer-refund-agreement-acceptance-verifier.ts";
import type { BuyerRefundAgreementAcceptanceRow } from "../w3m-acquisition-verification/buyer-refund-agreement-acceptance-verifier.ts";
import {
  W3M_AGREEMENT_DOCUMENT_ID,
  W3M_AGREEMENT_DOCUMENT_VERSION,
  W3M_AGREEMENT_DOCUMENT_LOCALE,
  W3M_AGREEMENT_DOCUMENT_SHA256,
} from "../w3m-acquisition-verification/deal-agreement-document.ts";
import {
  buildBuyerRefundRequestIntent,
  W3M_BNB_USDT,
  W3M_PLATFORM_WALLET,
  type BuyerRefundRequestContext,
} from "../w3m-acquisition-verification/buyer-refund-request-builder.ts";
import { buildBuyerRefundSafeTransaction } from "../w3m-acquisition-verification/buyer-refund-safe-transaction-builder.ts";
import { decodeSafeMultiSendCalldata } from "../w3m-acquisition-verification/safe-multisend-decoder.ts";
import { verifyBnbDealPaymentReceipt } from "../w3m-acquisition-verification/bnb-deal-payment-receipt-verifier.ts";
import { readCanonicalBnbSafeConfigurationFacts } from "../w3m-acquisition-verification/bnb-safe-configuration-facts-reader.ts";
import { readCanonicalBnbSafeTransactionFactsAtBlock } from "../w3m-acquisition-verification/bnb-safe-execution-facts-reader.ts";
import { readCanonicalBnbUsdtBalance } from "../w3m-acquisition-verification/bnb-safe-usdt-balance-reader.ts";
import { persistBuyerRefundRequestAtomically } from "../w3m-acquisition-verification/buyer-refund-request-persistence-adapter.ts";
import type { W3MRpcClient } from "../w3m-acquisition-verification/supabase-rpc-adapter.ts";


type W3MRefundRequestEndpointDependencies = {
  getEnv(name: string): string | undefined;
  createClient: typeof createClient;
  createRpcClient: typeof createAllowlistedBnbRpcClient;
  handleRequest: typeof handleW3MBuyerRefundRequest;
  readSnapshot: typeof readBuyerRefundRequestSnapshot;
  canonicalJson: typeof canonicalJson;
  sha256Hex: typeof sha256Hex;
  verifyAcceptances: typeof verifyBuyerRefundAgreementAcceptances;
  buildIntent: typeof buildBuyerRefundRequestIntent;
  buildSafeTransaction: typeof buildBuyerRefundSafeTransaction;
  decodeMultiSend: typeof decodeSafeMultiSendCalldata;
  verifyFundingReceipt: typeof verifyBnbDealPaymentReceipt;
  readSafeConfiguration: typeof readCanonicalBnbSafeConfigurationFacts;
  readSafeTransactionFacts: typeof readCanonicalBnbSafeTransactionFactsAtBlock;
  readUsdtBalance: typeof readCanonicalBnbUsdtBalance;
  persistRequest: typeof persistBuyerRefundRequestAtomically;
};

const ORIGINS = new Set(["https://web3market.xyz", "https://www.web3market.xyz"]);
const PLATFORM = W3M_PLATFORM_WALLET.toLowerCase();
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

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(label + " is malformed");
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(label + " is missing");
  return value;
}
function address(value: unknown, label: string): string {
  const result = text(value, label);
  if (!ADDRESS.test(result)) throw new Error(label + " is malformed");
  return result.toLowerCase();
}
function hash(value: unknown, label: string): string {
  const result = text(value, label);
  if (!HASH.test(result)) throw new Error(label + " is malformed");
  return result.toLowerCase();
}
function decimalUnits(value: string): string {
  if (!/^(0|[1-9][0-9]*)(?:[.][0-9]{1,18})?$/.test(value)) throw new Error("Deal amount is not an exact 18-decimal value");
  const [whole, fraction = ""] = value.split(".");
  return (BigInt(whole) * (10n ** 18n) + BigInt((fraction + "0".repeat(18)).slice(0, 18))).toString();
}
function decimalFromUnits(value: string): string {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("Verified token units are malformed");
  const units = BigInt(value);
  const whole = units / (10n ** 18n);
  const fraction = (units % (10n ** 18n)).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? whole.toString() + "." + fraction : whole.toString();
}
function decimalBlock(hexBlock: string): string {
  if (!/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(hexBlock)) throw new Error("Safe block number is malformed");
  return BigInt(hexBlock).toString();
}
function sameAddressSet(actual: string[], expected: string[]): boolean {
  return actual.map((v) => v.toLowerCase()).sort().join(":") === expected.map((v) => v.toLowerCase()).sort().join(":");
}

export function createW3MBuyerRefundRequestEndpoint(overrides: Partial<W3MRefundRequestEndpointDependencies> = {}) {
  const deps: W3MRefundRequestEndpointDependencies = {
    getEnv: (name) => Deno.env.get(name),
    createClient,
    createRpcClient: createAllowlistedBnbRpcClient,
    handleRequest: handleW3MBuyerRefundRequest,
    readSnapshot: readBuyerRefundRequestSnapshot,
    canonicalJson,
    sha256Hex,
    verifyAcceptances: verifyBuyerRefundAgreementAcceptances,
    buildIntent: buildBuyerRefundRequestIntent,
    buildSafeTransaction: buildBuyerRefundSafeTransaction,
    decodeMultiSend: decodeSafeMultiSendCalldata,
    verifyFundingReceipt: verifyBnbDealPaymentReceipt,
    readSafeConfiguration: readCanonicalBnbSafeConfigurationFacts,
    readSafeTransactionFacts: readCanonicalBnbSafeTransactionFactsAtBlock,
    readUsdtBalance: readCanonicalBnbUsdtBalance,
    persistRequest: persistBuyerRefundRequestAtomically,
    ...overrides,
  };
  return async (request: Request) => {
  const origin = request.headers.get("origin") ?? "";
  if (!ORIGINS.has(origin)) return new Response(null, { status: 403 });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (request.method !== "POST") return json(405, { ok: false, error: "POST_REQUIRED" }, origin);

  const url = deps.getEnv("SUPABASE_URL");
  const serviceKey = deps.getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json(503, { ok: false, error: "W3M_REFUND_REQUEST_NOT_CONFIGURED" }, origin);

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

  const response = await deps.handleRequest(request, {
    authenticate: async (token) => {
      const { data, error } = await supabase.auth.getUser(token);
      return error || !data.user?.id ? null : data.user.id;
    },
    isAdmin: async (actorId) => {
      const { data, error } = await supabase.from("profiles").select("id,role").eq("id", actorId).maybeSingle();
      if (error) throw new Error("Admin lookup failed");
      return data?.id === actorId && String(data.role ?? "").toLowerCase() === "admin";
    },
    prepare: async ({ dealId, actorId }) => {
      const snapshot = await deps.readSnapshot(database, { dealId, actorId });
      const deal = snapshot.deal;
      const dispute = snapshot.dispute;
      const decision = snapshot.decision;
      const terms = snapshot.terms;
      if (!dispute || !decision || !terms ||
          deal.status !== "disputed" || deal.dispute_status !== "resolved_buyer" ||
          deal.payment_status !== "confirmed" || Number(deal.chain_id) !== 56 ||
          dispute.status !== "resolved" || dispute.resolution !== "buyer_wins" ||
          decision.outcome !== "buyer_wins") {
        throw new Error("Deal, dispute, or immutable decision is not eligible for buyer refund");
      }
      const dealIdFromSnapshot = text(deal.id, "Deal ID");
      const buyerId = text(deal.buyer_id, "Buyer ID");
      const sellerId = text(deal.seller_id, "Seller ID");
      const projectId = text(terms.project_id, "Terms project ID");
      if (projectId !== text(deal.project_id, "Deal project ID")) throw new Error("Terms project does not match deal project");
      const termsId = text(terms.id, "Terms ID");
      const termsVersion = String(terms.terms_version ?? "");
      const termsHash = text(terms.terms_hash, "Terms hash");
      const safeAddress = address(deal.safe_address, "Deal Safe");
      const tokenAddress = address(deal.token_contract, "Deal token");
      const buyer = snapshot.buyerProfile;
      const seller = snapshot.sellerProfile;
      const buyerWallet = address(buyer.wallet_address, "Buyer wallet");
      const sellerWallet = address(seller.wallet_address, "Seller wallet");
      if (buyer.wallet_verified !== true || seller.wallet_verified !== true ||
          !Number.isFinite(Date.parse(String(buyer.wallet_verified_at ?? ""))) ||
          !Number.isFinite(Date.parse(String(seller.wallet_verified_at ?? ""))) ||
          buyer.id !== buyerId || seller.id !== sellerId ||
          buyerWallet === sellerWallet || buyerWallet === PLATFORM || sellerWallet === PLATFORM) {
        throw new Error("Current verified buyer and seller wallets are required");
      }
      if (tokenAddress !== W3M_BNB_USDT || address(terms.safe_address, "Terms Safe") !== safeAddress ||
          Number(terms.chain_id) !== 56 || terms.buyer_id !== buyerId || terms.seller_id !== sellerId ||
          terms.deal_id !== dealIdFromSnapshot || termsHash !== String(decision.terms_hash ?? "")) {
        throw new Error("Immutable terms, Safe, chain, or token binding mismatch");
      }
      const canonicalTerms = object(terms.canonical_terms, "Canonical signed terms");
      const dealAmount = text(deal.amount, "Deal amount");
      const signedDocument = object(canonicalTerms.agreementDocument, "Signed agreement document");
      const signedPolicy = object(canonicalTerms.releasePolicy, "Signed release policy");
      if (decimalUnits(text(canonicalTerms.amount, "Signed terms amount")) !== decimalUnits(dealAmount) ||
          text(canonicalTerms.dealId, "Signed terms deal ID") !== dealIdFromSnapshot ||
          text(canonicalTerms.projectId, "Signed terms project ID") !== projectId ||
          text(canonicalTerms.buyerId, "Signed terms buyer ID") !== buyerId ||
          text(canonicalTerms.sellerId, "Signed terms seller ID") !== sellerId ||
          address(canonicalTerms.safeAddress, "Signed terms Safe") !== safeAddress ||
          address(canonicalTerms.tokenContract, "Signed terms token") !== W3M_BNB_USDT ||
          Number(canonicalTerms.chainId) !== 56 ||
          signedDocument.documentId !== W3M_AGREEMENT_DOCUMENT_ID ||
          signedDocument.version !== W3M_AGREEMENT_DOCUMENT_VERSION ||
          signedDocument.locale !== W3M_AGREEMENT_DOCUMENT_LOCALE ||
          signedDocument.sha256 !== W3M_AGREEMENT_DOCUMENT_SHA256 ||
          text(signedPolicy.dealAmount, "Signed policy deal amount") !== text(canonicalTerms.amount, "Signed terms amount") ||
          text(signedPolicy.feePercent, "Signed policy fee percent") !== "7.5" ||
          address(signedPolicy.safeAddress, "Signed policy Safe") !== safeAddress ||
          address(signedPolicy.tokenContract, "Signed policy token") !== W3M_BNB_USDT ||
          address(signedPolicy.sellerWallet, "Signed policy seller wallet") !== sellerWallet ||
          address(signedPolicy.platformWallet, "Signed policy platform wallet") !== PLATFORM ||
          Number(signedPolicy.chainId) !== 56 ||
          !["locked", "ready"].includes(String(signedPolicy.status)) ||
          (BigInt(decimalUnits(text(signedPolicy.feeAmount, "Signed policy fee amount"))) +
            BigInt(decimalUnits(text(signedPolicy.sellerNetAmount, "Signed policy seller net"))) !== BigInt(decimalUnits(dealAmount))) ||
          BigInt(decimalUnits(text(signedPolicy.feeAmount, "Signed policy fee amount"))) !==
            ((BigInt(decimalUnits(dealAmount)) * 75n + 500n) / 1000n)) {
        throw new Error("Canonical signed terms do not match the current deal or pinned agreement");
      }
      const recomputedTermsHash = await deps.sha256Hex(deps.canonicalJson(canonicalTerms));
      if (recomputedTermsHash !== termsHash) throw new Error("Stored canonical terms do not reproduce the signed terms hash");

      const buyerAcceptance = snapshot.acceptances.find((row) => row.party_role === "buyer");
      const sellerAcceptance = snapshot.acceptances.find((row) => row.party_role === "seller");
      if (!buyerAcceptance || !sellerAcceptance || snapshot.acceptances.length !== 2) {
        throw new Error("Exactly one buyer and one seller agreement acceptance are required");
      }
      const acceptance = deps.verifyAcceptances({
        dealId: dealIdFromSnapshot, projectId, buyerId, sellerId,
        termsVersionId: termsId, termsVersion, termsHash, safeAddress,
        agreementDocumentVersion: W3M_AGREEMENT_DOCUMENT_VERSION,
        agreementDocumentHash: W3M_AGREEMENT_DOCUMENT_SHA256,
        buyerWallet, sellerWallet,
        buyerAcceptance: buyerAcceptance as unknown as BuyerRefundAgreementAcceptanceRow,
        sellerAcceptance: sellerAcceptance as unknown as BuyerRefundAgreementAcceptanceRow,
      });

      const fundingTxHash = hash(deal.payment_tx_hash, "Confirmed funding transaction hash");
      const verifiedFunding = await deps.verifyFundingReceipt(rpc, {
        transactionHash: fundingTxHash,
        buyerWallet,
        safeAddress,
        tokenContract: W3M_BNB_USDT,
        expectedAmountBaseUnits: decimalUnits(dealAmount),
        minConfirmations: 3,
      });
      const fundingFacts = {
        chain_id: 56,
        token_address: W3M_BNB_USDT,
        safe_address: safeAddress,
        confirmed: true,
        confirmations: String(verifiedFunding.confirmations),
        amount: decimalFromUnits(verifiedFunding.amountBaseUnits),
        tx_hash: verifiedFunding.transactionHash,
        block_hash: verifiedFunding.blockHash,
        block_number: verifiedFunding.blockNumber,
        log_index: verifiedFunding.logIndex,
      };

      const expectedOwners = [buyerWallet, sellerWallet, PLATFORM];
      const safeConfig = await deps.readSafeConfiguration(rpc, {
        safeAddress,
        expectedSafeAddress: safeAddress,
        expectedOwners,
        expectedThreshold: 2,
        expectedVersion: "1.4.1",
        expectedChainId: 56,
      });
      if (!safeConfig.valid || safeConfig.chainId !== 56 || safeConfig.threshold !== 2 ||
          safeConfig.version !== "1.4.1" || !safeConfig.nonce ||
          !sameAddressSet(safeConfig.owners, expectedOwners)) {
        throw new Error("Canonical Safe configuration is not the required 2-of-3 deployment");
      }
      const safeBlockNumber = decimalBlock(safeConfig.readBlockNumber);
      const safeBalance = await deps.readUsdtBalance(rpc, {
        safeAddress, blockNumber: safeBlockNumber, blockHash: safeConfig.readBlockHash,
      });
      if (safeBalance.blockHash !== safeConfig.readBlockHash ||
          safeBalance.blockNumber !== safeBlockNumber || safeBalance.tokenAddress !== W3M_BNB_USDT) {
        throw new Error("Safe USDT balance is not bound to the canonical Safe configuration block");
      }

      const context: BuyerRefundRequestContext = {
        decision: {
          id: text(decision.id, "Decision ID"), dealId: dealIdFromSnapshot,
          disputeId: text(dispute.id, "Dispute ID"), outcome: "buyer_wins",
          decisionHash: text(decision.decision_hash, "Decision hash").replace(/^0x/i, ""),
          termsHash, buyerRefundAmount: text(decision.buyer_refund_amount, "Buyer refund amount"),
        },
        terms: {
          dealId: dealIdFromSnapshot, termsHash, originalDealAmount: dealAmount,
          chainId: 56, safeAddress, buyerId, sellerId, buyerAccepted: true, sellerAccepted: true,
        },
        deal: {
          id: dealIdFromSnapshot, buyerId, sellerId, status: String(deal.status),
          disputeStatus: String(deal.dispute_status), chainId: 56, safeAddress, tokenAddress,
        },
        buyer: { id: buyerId, wallet: buyerWallet, verified: true },
        seller: { id: sellerId, wallet: sellerWallet, verified: true },
        funding: {
          confirmed: true, chainId: 56, tokenAddress: W3M_BNB_USDT, safeAddress,
          amount: fundingFacts.amount, txHash: fundingFacts.tx_hash,
          blockHash: fundingFacts.block_hash, confirmations: verifiedFunding.confirmations,
        },
        safe: {
          address: safeAddress, chainId: 56, nonce: safeConfig.nonce,
          blockNumber: safeBlockNumber, blockHash: safeConfig.readBlockHash,
          owners: safeConfig.owners, threshold: 2, balance: safeBalance.balance,
        },
      };
      const intent = deps.buildIntent(context);
      const built = deps.buildSafeTransaction(intent, safeConfig.nonce);
      const decoded = deps.decodeMultiSend(built.safeTransaction.data);
      if (!decoded.valid || decoded.calls.length !== 2 ||
          decoded.calls.some((call) => call.operation !== 0 || call.value !== "0" ||
            call.to.toLowerCase() !== W3M_BNB_USDT || call.method !== "transfer") ||
          decoded.calls[0].recipient?.toLowerCase() !== buyerWallet ||
          decoded.calls[0].amount !== built.innerTransfers[0].amountUnits ||
          decoded.calls[1].recipient?.toLowerCase() !== PLATFORM ||
          decoded.calls[1].amount !== built.innerTransfers[1].amountUnits) {
        throw new Error("Decoded MultiSend payload does not match the two approved refund transfers");
      }

      const safeTxFacts = await deps.readSafeTransactionFacts(rpc, {
        safeAddress, expectedSafeAddress: safeAddress, expectedOwners,
        expectedThreshold: 2, expectedVersion: "1.4.1", expectedChainId: 56,
        expectedNonce: safeConfig.nonce,
        transaction: {
          to: built.safeTransaction.to, value: built.safeTransaction.value,
          data: built.safeTransaction.data, operation: built.safeTransaction.operation,
          safeTxGas: built.safeTransaction.safeTxGas, baseGas: built.safeTransaction.baseGas,
          gasPrice: built.safeTransaction.gasPrice, gasToken: built.safeTransaction.gasToken,
          refundReceiver: built.safeTransaction.refundReceiver, nonce: built.safeTransaction.nonce,
        },
      }, { blockNumber: safeBlockNumber, blockHash: safeConfig.readBlockHash });
      if (!safeTxFacts.valid || safeTxFacts.chainId !== 56 ||
          safeTxFacts.nonce !== safeConfig.nonce ||
          safeTxFacts.readBlockNumber.toLowerCase() !== safeConfig.readBlockNumber.toLowerCase() ||
          safeTxFacts.readBlockHash.toLowerCase() !== safeConfig.readBlockHash.toLowerCase() ||
          safeTxFacts.safeTransactionHash.toLowerCase() === "0x" + "0".repeat(64)) {
        throw new Error("Safe transaction hash is not verified at the same canonical Safe block");
      }
      const safeFacts = {
        chain_id: 56, safe_address: safeAddress, nonce: safeConfig.nonce,
        block_number: safeBlockNumber, block_hash: safeConfig.readBlockHash,
        owners: safeConfig.owners.map((owner) => owner.toLowerCase()),
        threshold: 2, balance: safeBalance.balance,
        safe_tx_hash: safeTxFacts.safeTransactionHash.toLowerCase(),
      };
      const safeTransaction = {
        ...built.safeTransaction,
        to: built.safeTransaction.to.toLowerCase(),
      };
      const serverAuthorization = {
        authorized: true,
        phase: "CREATE_REFUND_REQUEST",
        deal_id: dealIdFromSnapshot,
        safe_hash_verified: true,
        safe_block_canonical: true,
        funding_receipt_verified: true,
        funding_block_canonical: true,
        payload_verified: true,
        agreement_acceptances_verified: true,
        buyer_acceptance_digest: acceptance.buyerDigest,
        seller_acceptance_digest: acceptance.sellerDigest,
        safe_tx_hash: safeTxFacts.safeTransactionHash.toLowerCase(),
        safe_block_hash: safeConfig.readBlockHash.toLowerCase(),
        funding_block_hash: verifiedFunding.blockHash.toLowerCase(),
        issues: [],
      };
      return {
        dealId: dealIdFromSnapshot,
        actorId,
        intent: intent as unknown as Record<string, unknown>,
        safeTransaction: safeTransaction as unknown as Record<string, unknown>,
        safeFacts,
        fundingFacts,
        serverAuthorization,
      };
    },
    persist: async (input) => await deps.persistRequest(database, input),
  });

  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors(origin))) headers.set(key, value);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, headers });
  };
}

if (import.meta.main) Deno.serve(createW3MBuyerRefundRequestEndpoint());
