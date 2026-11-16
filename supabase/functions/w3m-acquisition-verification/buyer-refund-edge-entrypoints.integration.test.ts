// W3M Protocol V1 — actual exported Edge Function entrypoint integration tests.
// Supabase Auth/queries/RPC and BNB JSON-RPC are fully mocked. No network, live DB,
// private key, wallet signing, broadcast, or production service is used.
import { createW3MBuyerRefundRequestEndpoint } from "../w3m-protocol-v1-buyer-refund-request/index.ts";
import { createW3MBuyerRefundSignEndpoint } from "../w3m-protocol-v1-buyer-refund-sign/index.ts";
import { createW3MBuyerRefundFinalizeEndpoint } from "../w3m-protocol-v1-buyer-refund-finalize/index.ts";
import { W3M_BNB_USDT, W3M_PLATFORM_WALLET } from "./buyer-refund-request-builder.ts";
import {
  W3M_AGREEMENT_DOCUMENT_ID, W3M_AGREEMENT_DOCUMENT_VERSION,
  W3M_AGREEMENT_DOCUMENT_LOCALE, W3M_AGREEMENT_DOCUMENT_SHA256,
} from "./deal-agreement-document.ts";

const ADMIN = "10000000-0000-4000-8000-000000000001";
const BUYER = "20000000-0000-4000-8000-000000000002";
const SELLER = "30000000-0000-4000-8000-000000000003";
const DEAL = "40000000-0000-4000-8000-000000000004";
const DISPUTE = "50000000-0000-4000-8000-000000000005";
const DECISION = "60000000-0000-4000-8000-000000000006";
const REQUEST = "70000000-0000-4000-8000-000000000007";
const SAFE_TX_ROW = "80000000-0000-4000-8000-000000000008";
const RECEIPT = "90000000-0000-4000-8000-000000000009";
const BUYER_WALLET = "0x1111111111111111111111111111111111111111";
const SELLER_WALLET = "0x2222222222222222222222222222222222222222";
const SAFE = "0x3333333333333333333333333333333333333333";
const MULTISEND = "0x9641d764fc13c8b624c04430c7356c1c7c8102e2";
const ZERO = "0x0000000000000000000000000000000000000000";
const PLATFORM = W3M_PLATFORM_WALLET.toLowerCase();
const TX_HASH = "0x" + "a".repeat(64);
const FUNDING_HASH = "0x" + "b".repeat(64);
const BROADCAST_HASH = "0x" + "c".repeat(64);
const BLOCK_HASH = "0x" + "d".repeat(64);
const TERMS_HASH = "e".repeat(64);
const DECISION_HASH = "f".repeat(64);
const BUYER_DIGEST = "0x" + "1".repeat(64);
const SELLER_DIGEST = "0x" + "2".repeat(64);
const BUYER_SIG = "0x" + "3".repeat(130);

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function request(path: string, body: unknown, token = "test-token", method = "POST") {
  return new Request("https://edge.test/" + path, {
    method,
    headers: { origin: "https://web3market.xyz", authorization: "Bearer " + token, "content-type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}
function makeRpc() {
  const methods: string[] = [];
  return {
    methods,
    client: {
      async request<T>(method: string, _params: unknown[] = []): Promise<T> {
        methods.push(method);
        if (method === "eth_chainId") return "0x38" as T;
        if (method === "eth_blockNumber") return "0x100" as T;
        throw new Error("Unexpected mocked BNB RPC method: " + method);
      },
    },
  };
}

class QueryMock {
  private filters: Array<[string, unknown]> = [];
  private inFilters: Array<[string, unknown[]]> = [];
  constructor(private table: string, private rows: Record<string, Record<string, unknown>[]>) {}
  select(_columns?: string) { return this; }
  eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
  neq(column: string, value: unknown) { this.filters.push(["!" + column, value]); return this; }
  in(column: string, values: unknown[]) { this.inFilters.push([column, values]); return this; }
  private matches(row: Record<string, unknown>) {
    return this.filters.every(([key, value]) => key.startsWith("!")
      ? row[key.slice(1)] !== value : row[key] === value) &&
      this.inFilters.every(([key, values]) => values.includes(row[key]));
  }
  private result() {
    const found = (this.rows[this.table] ?? []).filter((row) => this.matches(row));
    return { data: found, error: null };
  }
  async maybeSingle() {
    const result = this.result();
    return { data: result.data[0] ?? null, error: null };
  }
  then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
    return Promise.resolve(this.result()).then(resolve, reject);
  }
}
function fakeSupabase(input: { userId: string; rows?: Record<string, Record<string, unknown>[]>; rpcData?: Record<string, unknown> }) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const rows = input.rows ?? {};
  return {
    rpcCalls,
    client: {
      auth: {
        async getUser(_token?: string) { return { data: { user: { id: input.userId } }, error: null }; },
      },
      from(table: string) { return new QueryMock(table, rows); },
      async rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args });
        return { data: input.rpcData?.[name] ?? null, error: null };
      },
    },
  };
}
function endpointOverrides(supabase: ReturnType<typeof fakeSupabase>, rpc: ReturnType<typeof makeRpc>) {
  return {
    getEnv: (name: string) => ({
      SUPABASE_URL: "https://supabase.mock",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-test-only",
      BSC_RPC_URL: "https://bsc-rpc.publicnode.com",
    } as Record<string, string>)[name],
    createClient: (() => supabase.client) as never,
    createRpcClient: (() => rpc.client) as never,
  };
}

const buyerProfile = {
  id: BUYER, wallet_address: BUYER_WALLET, wallet_verified: true,
  wallet_verified_at: "2026-11-01T00:00:00.000Z",
};
const sellerProfile = {
  id: SELLER, wallet_address: SELLER_WALLET, wallet_verified: true,
  wallet_verified_at: "2026-11-01T00:00:00.000Z",
};
const dealRow = {
  id: DEAL, project_id: "a0000000-0000-4000-8000-000000000001",
  buyer_id: BUYER, seller_id: SELLER, amount: "10", status: "disputed",
  dispute_status: "resolved_buyer", payment_status: "confirmed",
  payment_tx_hash: FUNDING_HASH, chain_id: 56, safe_address: SAFE,
  token_contract: W3M_BNB_USDT,
};
const disputeRow = { id: DISPUTE, deal_id: DEAL, status: "resolved", resolution: "buyer_wins" };
const decisionRow = {
  id: DECISION, deal_id: DEAL, dispute_id: DISPUTE, outcome: "buyer_wins",
  decision_hash: DECISION_HASH, terms_hash: TERMS_HASH,
  buyer_refund_amount: "9.25", terms_version_id: "a1000000-0000-4000-8000-000000000001",
  terms_version: "1",
};
const canonicalTerms = {
  amount: "10", dealId: DEAL, projectId: dealRow.project_id, buyerId: BUYER, sellerId: SELLER,
  safeAddress: SAFE, tokenContract: W3M_BNB_USDT, chainId: 56,
  agreementDocument: {
    documentId: W3M_AGREEMENT_DOCUMENT_ID, version: W3M_AGREEMENT_DOCUMENT_VERSION,
    locale: W3M_AGREEMENT_DOCUMENT_LOCALE, sha256: W3M_AGREEMENT_DOCUMENT_SHA256,
  },
  releasePolicy: {
    dealAmount: "10", feePercent: "7.5", safeAddress: SAFE, tokenContract: W3M_BNB_USDT,
    sellerWallet: SELLER_WALLET, platformWallet: PLATFORM, chainId: 56,
    status: "locked", feeAmount: "0.75", sellerNetAmount: "9.25",
  },
};
const termsRow = {
  id: decisionRow.terms_version_id, deal_id: DEAL, project_id: dealRow.project_id,
  terms_hash: TERMS_HASH, terms_version: "1", chain_id: 56, safe_address: SAFE,
  buyer_id: BUYER, seller_id: SELLER, canonical_terms: canonicalTerms,
};
const owners = [BUYER_WALLET, SELLER_WALLET, PLATFORM];

Deno.test("REQUEST Edge Function entrypoint executes authenticated orchestration with mocked Supabase and BNB RPC", async () => {
  const supabase = fakeSupabase({
    userId: ADMIN,
    rows: { profiles: [{ id: ADMIN, role: "admin" }] },
    rpcData: {
      w3m_create_buyer_refund_request: {
        created: true, idempotent_replay: false, request_id: REQUEST,
        safe_transaction_id: SAFE_TX_ROW, safe_tx_hash: TX_HASH, status: "awaiting_signatures",
      },
    },
  });
  const rpc = makeRpc();
  const endpoint = createW3MBuyerRefundRequestEndpoint({
    ...endpointOverrides(supabase, rpc),
    readSnapshot: (async () => ({
      deal: dealRow, buyerProfile, sellerProfile, dispute: disputeRow, decision: decisionRow,
      terms: termsRow, acceptances: [{ party_role: "buyer" }, { party_role: "seller" }],
    })) as never,
    canonicalJson: (() => "canonical-terms") as never,
    sha256Hex: (async () => TERMS_HASH) as never,
    verifyAcceptances: (() => ({ buyerDigest: BUYER_DIGEST, sellerDigest: SELLER_DIGEST })) as never,
    verifyFundingReceipt: (async (client: { request<T>(method: string, params: unknown[]): Promise<T> }) => {
      await client.request("eth_chainId", []);
      return {
        transactionHash: FUNDING_HASH, blockHash: BLOCK_HASH, blockNumber: "100",
        amountBaseUnits: "10000000000000000000", confirmations: 20, logIndex: 1,
      };
    }) as never,
    readSafeConfiguration: (async (client: { request<T>(method: string, params: unknown[]): Promise<T> }) => {
      await client.request("eth_chainId", []);
      return { valid: true, chainId: 56, threshold: 2, version: "1.4.1", nonce: "0",
        owners, readBlockNumber: "0x10", readBlockHash: BLOCK_HASH, issues: [] };
    }) as never,
    readUsdtBalance: (async (client: { request<T>(method: string, params: unknown[]): Promise<T> }) => {
      await client.request("eth_chainId", []);
      return { balance: "10", tokenAddress: W3M_BNB_USDT, blockNumber: "16", blockHash: BLOCK_HASH };
    }) as never,
    buildIntent: (() => ({})) as never,
    buildSafeTransaction: (() => ({
      safeTransaction: { to: MULTISEND, value: "0", data: "0x1234", operation: 1,
        safeTxGas: "0", baseGas: "0", gasPrice: "0", gasToken: ZERO, refundReceiver: ZERO, nonce: "0" },
      innerTransfers: [{ amountUnits: "9250000000000000000" }, { amountUnits: "750000000000000000" }],
    })) as never,
    decodeMultiSend: (() => ({
      valid: true,
      calls: [
        { operation: 0, value: "0", to: W3M_BNB_USDT, method: "transfer", recipient: BUYER_WALLET, amount: "9250000000000000000" },
        { operation: 0, value: "0", to: W3M_BNB_USDT, method: "transfer", recipient: PLATFORM, amount: "750000000000000000" },
      ],
    })) as never,
    readSafeTransactionFacts: (async (client: { request<T>(method: string, params: unknown[]): Promise<T> }) => {
      await client.request("eth_chainId", []);
      return { valid: true, chainId: 56, nonce: "0", readBlockNumber: "0x10",
        readBlockHash: BLOCK_HASH, safeTransactionHash: TX_HASH, issues: [] };
    }) as never,
    persistRequest: (async (database: { rpc(name: string, args: Record<string, unknown>): Promise<unknown> }, input: unknown) => {
      const result = await database.rpc("w3m_create_buyer_refund_request", { input });
      assert((result as { error?: unknown }).error === null, "mock request RPC failed");
      return { created: true, idempotentReplay: false, requestId: REQUEST,
        safeTransactionId: SAFE_TX_ROW, safeTransactionHash: TX_HASH, status: "awaiting_signatures" };
    }) as never,
  } as never);
  const response = await endpoint(request("request", { deal_id: DEAL }));
  const body = await response.json();
  assert(response.status === 200 && body.ok === true, "REQUEST entrypoint failed: " + JSON.stringify(body));
  assert(supabase.rpcCalls.some((call) => call.name === "w3m_create_buyer_refund_request"), "REQUEST did not call the atomic Supabase RPC");
  assert(rpc.methods.includes("eth_chainId") && rpc.methods.length >= 4, "REQUEST did not exercise the mocked BNB RPC boundary");
});

Deno.test("SIGN Edge Function entrypoint reloads participant records, checks Safe digest, and persists atomically", async () => {
  const safeTx = {
    id: SAFE_TX_ROW, deal_id: DEAL, action: "refund_to_buyer", status: "awaiting_signatures",
    safe_address: SAFE, safe_tx_hash: TX_HASH, safe_nonce: "7", to_address: MULTISEND,
    data: "0x1234", value_wei: "0", operation: 1, safe_tx_gas: "0", base_gas: "0",
    gas_price: "0", gas_token: ZERO, refund_receiver: ZERO, required_signatures: 2,
  };
  const refund = {
    id: REQUEST, deal_id: DEAL, dispute_id: DISPUTE, decision_id: DECISION,
    safe_transaction_id: SAFE_TX_ROW, status: "awaiting_signatures", safe_tx_hash: TX_HASH,
    decision_hash: DECISION_HASH, terms_hash: TERMS_HASH, safe_address: SAFE,
    token_address: W3M_BNB_USDT, safe_nonce: "7", safe_owners: owners,
  };
  const supabase = fakeSupabase({
    userId: BUYER,
    rows: {
      w3m_buyer_refund_requests: [refund], deals: [dealRow], deal_multisig_transactions: [safeTx],
      w3m_deal_dispute_decisions: [decisionRow], deal_disputes: [disputeRow],
      w3m_deal_terms_versions: [termsRow], profiles: [buyerProfile, sellerProfile],
      w3m_buyer_refund_signatures: [],
    },
  });
  const rpc = makeRpc();
  const endpoint = createW3MBuyerRefundSignEndpoint({
    ...endpointOverrides(supabase, rpc),
    readSafeExecutionFacts: (async (client: { request<T>(method: string, params: unknown[]): Promise<T> }) => {
      await client.request("eth_chainId", []);
      return { valid: true, chainId: 56, threshold: 2, version: "1.4.1", nonce: "7",
        recomputedSafeTransactionHash: TX_HASH, owners, issues: [] };
    }) as never,
    verifyRawDigestSignature: (async () => true) as never,
    persistSignature: (async (database: { rpc(name: string, args: Record<string, unknown>): Promise<unknown> }) => {
      await database.rpc("w3m_record_buyer_refund_signature", {});
      return { recorded: true, idempotentReplay: false, confirmationsCount: 1,
        requiredSignatures: 2, status: "awaiting_signatures" };
    }) as never,
  } as never);
  const response = await endpoint(request("sign", {
    deal_id: DEAL, request_id: REQUEST, decision_id: DECISION,
    safe_tx_hash: TX_HASH, signature: BUYER_SIG,
  }, "buyer-session"));
  const body = await response.json();
  assert(response.status === 200 && body.recorded === true, "SIGN entrypoint failed: " + JSON.stringify(body));
  assert(supabase.rpcCalls.some((call) => call.name === "w3m_record_buyer_refund_signature"), "SIGN did not call atomic signature RPC");
  assert(rpc.methods.includes("eth_chainId"), "SIGN did not exercise mocked BNB RPC boundary");
});

Deno.test("FINALIZE Edge Function entrypoint verifies receipt and commits through atomic RPC", async () => {
  const safeTx = {
    id: SAFE_TX_ROW, deal_id: DEAL, action: "refund_to_buyer", status: "signed",
    tx_hash: BROADCAST_HASH, safe_tx_hash: TX_HASH, safe_address: SAFE, safe_nonce: "7",
    confirmations_count: 2, required_signatures: 2,
  };
  const refund = {
    id: REQUEST, deal_id: DEAL, decision_id: DECISION, safe_transaction_id: SAFE_TX_ROW,
    status: "awaiting_signatures", safe_tx_hash: TX_HASH, decision_hash: DECISION_HASH,
    terms_hash: TERMS_HASH, safe_address: SAFE, token_address: W3M_BNB_USDT,
    safe_nonce: "7", safe_owners: owners, buyer_wallet: BUYER_WALLET,
    chain_id: 56, refund_amount: "9.25", original_deal_amount: "10",
    platform_wallet: PLATFORM, platform_fee_amount: "0.75",
  };
  const supabase = fakeSupabase({
    userId: ADMIN,
    rows: {
      profiles: [{ id: ADMIN, role: "admin" }, buyerProfile, sellerProfile],
      w3m_buyer_refund_requests: [refund], deals: [dealRow], deal_multisig_transactions: [safeTx],
      w3m_buyer_refund_signatures: [
        { signer_id: BUYER, signer_role: "buyer", wallet_address: BUYER_WALLET, safe_tx_hash: TX_HASH },
        { signer_id: SELLER, signer_role: "seller", wallet_address: SELLER_WALLET, safe_tx_hash: TX_HASH },
      ],
    },
  });
  const rpc = makeRpc();
  let safeReadReached = false;
  let receiptVerifyReached = false;
  let atomicFinalizeReached = false;
  const endpoint = createW3MBuyerRefundFinalizeEndpoint({
    ...endpointOverrides(supabase, rpc),
    readSafeConfiguration: (async (client: { request<T>(method: string, params: unknown[]): Promise<T> }) => {
      safeReadReached = true;
      await client.request("eth_chainId", []);
      return { valid: true, chainId: 56, threshold: 2, version: "1.4.1", owners, nonce: "7", issues: [] };
    }) as never,
    verifyReceipt: (async (client: { request<T>(method: string, params: unknown[]): Promise<T> }, expectation: Record<string, unknown>) => {
      receiptVerifyReached = true;
      await client.request("eth_chainId", []);
      return {
        chainId: 56, transactionHash: BROADCAST_HASH, blockHash: BLOCK_HASH,
        blockNumber: "123456", blockTimestamp: "2026-11-17T00:00:00.000Z", confirmations: 12,
        safeAddress: SAFE, safeTxHash: TX_HASH, tokenContract: W3M_BNB_USDT,
        buyerWallet: BUYER_WALLET, buyerRefundAmount: "9.25", platformWallet: PLATFORM,
        platformFeeAmount: "0.75", decisionId: DECISION, decisionHash: DECISION_HASH,
        termsHash: TERMS_HASH, executionSuccess: true,
      };
    }) as never,
    finalizeAtomically: (async (database: { rpc(name: string, args: Record<string, unknown>): Promise<unknown> }) => {
      atomicFinalizeReached = true;
      await database.rpc("w3m_finalize_buyer_refund", {});
      return { finalized: true, idempotentReplay: false, receiptId: RECEIPT, status: "confirmed" };
    }) as never,
  } as never);
  const response = await endpoint(request("finalize", {
    request_id: REQUEST, broadcast_tx_hash: BROADCAST_HASH,
  }, "admin-session"));
  const body = await response.json();
  assert(response.status === 200 && body.finalized === true,
    "FINALIZE entrypoint failed: " + JSON.stringify(body) +
    "; safeRead=" + safeReadReached + "; receiptVerify=" + receiptVerifyReached +
    "; atomicFinalize=" + atomicFinalizeReached + "; rpcMethods=" + rpc.methods.join(","));
  assert(supabase.rpcCalls.some((call) => call.name === "w3m_finalize_buyer_refund"), "FINALIZE did not call atomic finalization RPC");
  assert(rpc.methods.includes("eth_chainId"), "FINALIZE did not exercise mocked BNB RPC boundary");
});


Deno.test("actual refund Edge Function entrypoints reject wrong authority before any atomic write", async () => {
  const requestDb = fakeSupabase({
    userId: ADMIN,
    rows: { profiles: [{ id: ADMIN, role: "user" }] },
  });
  const requestRpc = makeRpc();
  const requestEndpoint = createW3MBuyerRefundRequestEndpoint(endpointOverrides(requestDb, requestRpc) as never);
  const requestResponse = await requestEndpoint(request("request", { deal_id: DEAL }));
  assert(requestResponse.status === 403, "REQUEST accepted a non-admin session");
  assert(requestDb.rpcCalls.length === 0 && requestRpc.methods.length === 0,
    "non-admin REQUEST performed a database or BNB write/read");

  const safeTx = {
    id: SAFE_TX_ROW, deal_id: DEAL, action: "refund_to_buyer", status: "awaiting_signatures",
    safe_address: SAFE, safe_tx_hash: TX_HASH, safe_nonce: "7", to_address: MULTISEND,
    data: "0x1234", value_wei: "0", operation: 1, safe_tx_gas: "0", base_gas: "0",
    gas_price: "0", gas_token: ZERO, refund_receiver: ZERO, required_signatures: 2,
  };
  const refund = {
    id: REQUEST, deal_id: DEAL, dispute_id: DISPUTE, decision_id: DECISION,
    safe_transaction_id: SAFE_TX_ROW, status: "awaiting_signatures", safe_tx_hash: TX_HASH,
    decision_hash: DECISION_HASH, terms_hash: TERMS_HASH, safe_address: SAFE,
    token_address: W3M_BNB_USDT, safe_nonce: "7", safe_owners: owners,
  };
  const signDb = fakeSupabase({
    userId: ADMIN,
    rows: {
      w3m_buyer_refund_requests: [refund], deals: [dealRow], deal_multisig_transactions: [safeTx],
      w3m_deal_dispute_decisions: [decisionRow], deal_disputes: [disputeRow],
      w3m_deal_terms_versions: [termsRow], profiles: [buyerProfile, sellerProfile],
      w3m_buyer_refund_signatures: [],
    },
  });
  const signRpc = makeRpc();
  const signEndpoint = createW3MBuyerRefundSignEndpoint(endpointOverrides(signDb, signRpc) as never);
  const signResponse = await signEndpoint(request("sign", {
    deal_id: DEAL, request_id: REQUEST, decision_id: DECISION,
    safe_tx_hash: TX_HASH, signature: BUYER_SIG,
  }));
  assert(signResponse.status === 409, "SIGN accepted an actor who is not a deal participant");
  assert(signDb.rpcCalls.length === 0 && signRpc.methods.length === 0,
    "non-participant SIGN reached BNB verification or signature persistence");

  const finalizeDb = fakeSupabase({
    userId: ADMIN,
    rows: { profiles: [{ id: ADMIN, role: "user" }] },
  });
  const finalizeRpc = makeRpc();
  const finalizeEndpoint = createW3MBuyerRefundFinalizeEndpoint(endpointOverrides(finalizeDb, finalizeRpc) as never);
  const finalizeResponse = await finalizeEndpoint(request("finalize", {
    request_id: REQUEST, broadcast_tx_hash: BROADCAST_HASH,
  }));
  assert(finalizeResponse.status === 403, "FINALIZE accepted a non-admin session");
  assert(finalizeDb.rpcCalls.length === 0 && finalizeRpc.methods.length === 0,
    "non-admin FINALIZE reached BNB verification or atomic finalization");
});
