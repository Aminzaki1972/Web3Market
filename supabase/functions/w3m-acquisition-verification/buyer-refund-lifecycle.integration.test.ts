// W3M Protocol V1 — local-only orchestration test for the buyer refund lifecycle.
// Every external boundary is mocked. This test does not connect to Supabase or BNB,
// does not sign with a real wallet, and does not broadcast a transaction.
import { handleW3MBuyerRefundRequest } from "./buyer-refund-request-handler.ts";
import { createBuyerRefundSignRequestHandler, type BuyerRefundSignContext } from "./buyer-refund-sign-request-handler.ts";
import { handleBuyerRefundFinalization, type BuyerRefundFinalizationContext } from "./buyer-refund-finalization-handler.ts";
import type { BuyerRefundRequestPersistenceInput } from "./buyer-refund-request-persistence-adapter.ts";
import type { BnbSafeRefundReceiptExpectation, VerifiedBnbSafeRefundReceipt } from "./bnb-safe-refund-receipt-verifier.ts";

const ADMIN = "10000000-0000-4000-8000-000000000001";
const BUYER = "20000000-0000-4000-8000-000000000002";
const SELLER = "30000000-0000-4000-8000-000000000003";
const DEAL = "40000000-0000-4000-8000-000000000004";
const DISPUTE = "50000000-0000-4000-8000-000000000005";
const DECISION = "60000000-0000-4000-8000-000000000006";
const REQUEST = "70000000-0000-4000-8000-000000000007";
const RECEIPT = "80000000-0000-4000-8000-000000000008";
const BUYER_WALLET = "0x1111111111111111111111111111111111111111";
const SELLER_WALLET = "0x2222222222222222222222222222222222222222";
const PLATFORM_WALLET = "0x2b15cc63ee3b833f502c065767695fa2b584f8c9";
const SAFE = "0x3333333333333333333333333333333333333333";
const TOKEN = "0x55d398326f99059ff775485246999027b3197955";
const SAFE_TX_HASH = "0x" + "a".repeat(64);
const BROADCAST_TX_HASH = "0x" + "b".repeat(64);
const DECISION_HASH = "c".repeat(64);
const TERMS_HASH = "d".repeat(64);
const SIG_BUYER = "0x" + "1".repeat(130);
const SIG_SELLER = "0x" + "2".repeat(130);

function post(url: string, body: unknown, token = "valid-session"): Request {
  return new Request(url, { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify(body) });
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("mocked buyer refund lifecycle: request → buyer/seller SIGN → receipt verify → atomic finalize", async () => {
  let requestPersisted = false;
  const signatures: Array<{ role: "buyer" | "seller"; wallet: string; signature: string }> = [];
  let receiptVerified = false;
  let finalized = false;

  const requestInput: BuyerRefundRequestPersistenceInput = {
    dealId: DEAL, actorId: ADMIN, intent: {}, safeTransaction: {}, safeFacts: {},
    fundingFacts: {}, serverAuthorization: {},
  };
  const requestResponse = await handleW3MBuyerRefundRequest(
    post("https://w3m.test/request", { deal_id: DEAL }),
    {
      authenticate: async () => ADMIN,
      isAdmin: async (id) => id === ADMIN,
      prepare: async ({ dealId, actorId }) => {
        assert(dealId === DEAL && actorId === ADMIN, "request context binding changed");
        return requestInput;
      },
      persist: async (input) => {
        assert(input.dealId === DEAL && input.actorId === ADMIN, "request persistence identity changed");
        requestPersisted = true;
        return { created: true, idempotentReplay: false, requestId: REQUEST, safeTransactionId: RECEIPT, safeTransactionHash: SAFE_TX_HASH, status: "awaiting_signatures" };
      },
    },
  );
  assert(requestResponse.status === 200 && requestPersisted, "buyer refund request was not created");

  const expectation: BnbSafeRefundReceiptExpectation = {
    broadcastTxHash: BROADCAST_TX_HASH, safeTxHash: SAFE_TX_HASH, safeAddress: SAFE,
    tokenContract: TOKEN, buyerWallet: BUYER_WALLET, buyerRefundAmount: "9.25",
    originalDealAmount: "10", platformWallet: PLATFORM_WALLET, platformFeeAmount: "0.75",
    minConfirmations: 12, decisionId: DECISION, decisionHash: DECISION_HASH, termsHash: TERMS_HASH,
  };
  const makeSignContext = (role: "buyer" | "seller"): BuyerRefundSignContext => ({
    action: "refund_to_buyer", dealId: DEAL, disputeId: DISPUTE, requestId: REQUEST,
    decisionId: DECISION, decisionHash: DECISION_HASH, termsHash: TERMS_HASH,
    safeTransactionHash: SAFE_TX_HASH, safeAddress: SAFE, chainId: 56, safeNonce: "9",
    currentOwners: [BUYER_WALLET, SELLER_WALLET, PLATFORM_WALLET], threshold: 2,
    verifiedWallet: role === "buyer" ? BUYER_WALLET : SELLER_WALLET,
    buyerWallet: BUYER_WALLET,
    w3mAuthorization: { authorized: true, phase: "SIGN", requestId: REQUEST, safeTransactionHash: SAFE_TX_HASH, issues: [] },
    signerRole: role, status: "awaiting_signatures",
  });
  const signHandler = createBuyerRefundSignRequestHandler({
    authenticate: async (request) => request.headers.get("authorization") === "Bearer valid-session"
      ? { userId: request.headers.get("x-user-id") ?? "" } : null,
    loadFreshContext: async ({ actorId }) => actorId === BUYER ? makeSignContext("buyer")
      : actorId === SELLER ? makeSignContext("seller") : Promise.reject(new Error("not a participant")),
    verifySafeDigest: async ({ digest, signature, expectedWallet }) =>
      digest === SAFE_TX_HASH.slice(2) &&
      ((expectedWallet === BUYER_WALLET && signature === SIG_BUYER) ||
       (expectedWallet === SELLER_WALLET && signature === SIG_SELLER)),
    persistSignatureAtomically: async (input) => {
      signatures.push({ role: input.signerRole, wallet: input.verifiedWallet, signature: input.signature });
      return { recorded: true, idempotentReplay: false, confirmationsCount: signatures.length, requiredSignatures: 2, status: signatures.length === 2 ? "signed" : "awaiting_signatures" };
    },
  });
  const buyerRequest = post("https://w3m.test/sign", { deal_id: DEAL, request_id: REQUEST, decision_id: DECISION, safe_tx_hash: SAFE_TX_HASH, signature: SIG_BUYER });
  const buyerHeaders = new Headers(buyerRequest.headers); buyerHeaders.set("x-user-id", BUYER);
  const buyerSignResponse = await signHandler(new Request(buyerRequest, { headers: buyerHeaders }));
  assert(buyerSignResponse.status === 200 && signatures.length === 1, "buyer signature was not recorded");
  const sellerRequest = post("https://w3m.test/sign", { deal_id: DEAL, request_id: REQUEST, decision_id: DECISION, safe_tx_hash: SAFE_TX_HASH, signature: SIG_SELLER });
  const sellerHeaders = new Headers(sellerRequest.headers); sellerHeaders.set("x-user-id", SELLER);
  const sellerSignResponse = await signHandler(new Request(sellerRequest, { headers: sellerHeaders }));
  assert(sellerSignResponse.status === 200 && Number(signatures.length) === 2, "seller signature was not recorded");
  assert(new Set(signatures.map((row) => row.wallet)).size === 2, "two distinct participant wallets are required");

  const finalizationContext: BuyerRefundFinalizationContext = {
    actorId: ADMIN, dealId: DEAL, requestId: REQUEST, decisionId: DECISION,
    decisionHash: DECISION_HASH, termsHash: TERMS_HASH, safeAddress: SAFE,
    safeTransactionHash: SAFE_TX_HASH, safeNonce: "9", chainId: 56,
    signerCount: 2, signatureWallets: [BUYER_WALLET, SELLER_WALLET],
    currentOwners: [BUYER_WALLET, SELLER_WALLET, PLATFORM_WALLET],
    recordedOwners: [BUYER_WALLET, SELLER_WALLET, PLATFORM_WALLET],
    currentThreshold: 2, requiredSignatures: 2, transactionStatus: "signed",
    expectation,
  };
  const verifiedReceipt: VerifiedBnbSafeRefundReceipt = {
    chainId: 56, transactionHash: BROADCAST_TX_HASH, blockHash: "0x" + "e".repeat(64),
    blockNumber: "123456", blockTimestamp: "2026-11-16T12:00:00.000Z", confirmations: 12,
    safeAddress: SAFE, safeTxHash: SAFE_TX_HASH, tokenContract: TOKEN,
    buyerWallet: BUYER_WALLET, buyerRefundAmount: "9.25", platformWallet: PLATFORM_WALLET,
    platformFeeAmount: "0.75", decisionId: DECISION, decisionHash: DECISION_HASH,
    termsHash: TERMS_HASH, executionSuccess: true,
  };
  const finalizeResponse = await handleBuyerRefundFinalization(
    post("https://w3m.test/finalize", { request_id: REQUEST, broadcast_tx_hash: BROADCAST_TX_HASH }),
    {
      authenticate: async (token) => token === "valid-session" ? ADMIN : null,
      isAdmin: async (id) => id === ADMIN,
      loadFreshContext: async () => finalizationContext,
      verifyReceipt: async (expected) => {
        assert(expected.broadcastTxHash === BROADCAST_TX_HASH && expected.buyerRefundAmount === "9.25", "receipt expectation mismatch");
        receiptVerified = true;
        return verifiedReceipt;
      },
      finalizeAtomically: async (input) => {
        assert(input.serverAuthorization.phase === "FINALIZE_BUYER_REFUND", "missing server finalization authorization");
        finalized = true;
        return { finalized: true, idempotentReplay: false, receiptId: RECEIPT, status: "confirmed" };
      },
    },
  );
  assert(finalizeResponse.status === 200 && receiptVerified && finalized, "atomic finalization boundary did not complete");
  const responseBody = await finalizeResponse.json();
  assert(responseBody.finalized === true && responseBody.status === "confirmed", "finalization response was not confirmed");
});
