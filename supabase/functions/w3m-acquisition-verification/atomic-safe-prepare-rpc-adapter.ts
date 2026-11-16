// W3M Protocol V1 — strict server-side atomic PREPARE persistence adapter.
// Inputs must come only from authenticated server context, the cryptographically
// verified persisted-report gate, validated release policy, and canonical BNB reads.
// Never accept this object directly from a browser request.
import type { W3MRpcClient } from "./supabase-rpc-adapter.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const BNB_USDT = "0x55d398326f99059ff775485246999027b3197955";
const PLATFORM_WALLET = "0x2b15cc63ee3b833f502c065767695fa2b584f8c9";

export interface AtomicSafePrepareInput {
  dealId: string;
  /** Derived from the authenticated Supabase user, never from request JSON. */
  actorId: string;
  /** Complete PASS result from persisted evidence + trusted signer verification. */
  authorization: {
    decision: "PASS";
    dealId: string;
    reportId: string;
    reportVersion: number;
    reportHash: string;
    dealTermsHash: string;
    expiresAt: string;
  };
  /** Server-derived policy after the strict Deal Room snapshot check. */
  policy: {
    dealAmount: string;
    feePercent: string;
    feeAmount: string;
    sellerNetAmount: string;
    sellerWallet: string;
    platformWallet: string;
    safeAddress: string;
    tokenContract: string;
    tokenSymbol: "USDT";
    chainId: 56;
  };
  /** Facts read from BNB at one canonical block. */
  safeFacts: {
    chainId: 56;
    threshold: 2;
    nonce: string;
    blockNumber: string;
    blockHash: string;
    safeAddress: string;
    owners: readonly string[];
  };
}

export interface AtomicSafePrepareResult {
  policyId: string;
  transactionId: string;
  status: string;
  idempotentReplay: boolean;
}

function requireString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(label + " is required.");
}
function canonicalDecimal(value: string, label: string): string {
  if (!DECIMAL.test(value)) throw new Error(label + " is not a canonical decimal.");
  return value;
}
function lowerAddress(value: string, label: string): string {
  if (!ADDRESS.test(value)) throw new Error(label + " is not a valid EVM address.");
  return value.toLowerCase();
}
function asObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Atomic PREPARE RPC returned a malformed response.");
  }
  return value as Record<string, unknown>;
}

export async function commitAtomicSafePrepare(
  client: W3MRpcClient,
  input: AtomicSafePrepareInput,
): Promise<AtomicSafePrepareResult> {
  if (!UUID.test(input.dealId) || !UUID.test(input.actorId) ||
      input.authorization.dealId !== input.dealId ||
      input.authorization.decision !== "PASS") {
    throw new Error("Atomic PREPARE requires an authenticated actor and deal-bound PASS.");
  }
  const auth = input.authorization;
  requireString(auth.reportId, "W3M report ID");
  if (!Number.isSafeInteger(auth.reportVersion) || auth.reportVersion < 1 ||
      !SHA256.test(auth.reportHash) || !SHA256.test(auth.dealTermsHash) ||
      !Number.isFinite(Date.parse(auth.expiresAt)) || Date.parse(auth.expiresAt) <= Date.now()) {
    throw new Error("W3M PASS authorization is malformed or expired.");
  }

  const p = input.policy;
  const amount = canonicalDecimal(p.dealAmount, "Deal amount");
  const feePercent = canonicalDecimal(p.feePercent, "Fee percent");
  if (Number(feePercent) !== 7.5) {
    throw new Error("W3M V1 requires the platform's locked 7.5% success fee.");
  }
  const feeAmount = canonicalDecimal(p.feeAmount, "Fee amount");
  const sellerNet = canonicalDecimal(p.sellerNetAmount, "Seller net amount");
  const sellerWallet = lowerAddress(p.sellerWallet, "Seller wallet");
  const platformWallet = lowerAddress(p.platformWallet, "Platform wallet");
  const safeAddress = lowerAddress(p.safeAddress, "Safe address");
  const tokenContract = lowerAddress(p.tokenContract, "Token contract");
  if (p.chainId !== 56 || p.tokenSymbol !== "USDT" ||
      tokenContract !== BNB_USDT || platformWallet !== PLATFORM_WALLET) {
    throw new Error("Atomic PREPARE policy is not the approved BNB USDT policy.");
  }

  const f = input.safeFacts;
  const factsSafe = lowerAddress(f.safeAddress, "Safe facts address");
  if (f.chainId !== 56 || f.threshold !== 2 || factsSafe !== safeAddress ||
      !/^(0|[1-9][0-9]*)$/.test(f.nonce) ||
      !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(f.blockNumber) ||
      !HASH.test(f.blockHash) || f.owners.length !== 3) {
    throw new Error("Canonical BNB Safe facts are malformed.");
  }
  const owners = f.owners.map((owner) => lowerAddress(owner, "Safe owner"));
  if (new Set(owners).size !== 3 ||
      !owners.includes(sellerWallet) || !owners.includes(platformWallet)) {
    throw new Error("Safe owner set does not contain the expected distinct parties.");
  }
  // The buyer wallet is checked against the deal and all three owners inside
  // the SQL transaction. Preserve the complete, normalized owner set here.
  const blockNumber = BigInt(f.blockNumber).toString(10);

  const { data, error } = await client.rpc("w3m_commit_safe_prepare", {
    p_deal_id: input.dealId,
    p_actor_id: input.actorId,
    p_policy: {
      deal_amount: amount,
      fee_percent: feePercent,
      fee_amount: feeAmount,
      seller_net_amount: sellerNet,
      seller_wallet: sellerWallet,
      platform_wallet: platformWallet,
      safe_address: safeAddress,
      token_contract: tokenContract,
      token_symbol: "USDT",
      chain_id: "56",
      status: "locked",
    },
    p_safe_facts: {
      chain_id: "56",
      threshold: "2",
      nonce: f.nonce,
      block_number: blockNumber,
      block_hash: f.blockHash.toLowerCase(),
      safe_address: factsSafe,
      owners,
    },
    p_w3m_authorization: {
      decision: "PASS",
      deal_id: input.dealId,
      report_id: auth.reportId,
      report_version: String(auth.reportVersion),
      report_hash: auth.reportHash,
      deal_terms_hash: auth.dealTermsHash,
      expires_at: auth.expiresAt,
    },
  });
  if (error) throw new Error("Atomic W3M PREPARE persistence failed.");
  const result = asObject(data);
  if (result.committed !== true || typeof result.idempotent_replay !== "boolean" ||
      typeof result.policy_id !== "string" || !UUID.test(result.policy_id) ||
      typeof result.transaction_id !== "string" || !UUID.test(result.transaction_id) ||
      typeof result.status !== "string" ||
      !["awaiting_signatures", "signed", "submitted", "confirmed", "cancelled"].includes(result.status)) {
    throw new Error("Atomic W3M PREPARE RPC response does not match the committed request.");
  }
  return {
    policyId: result.policy_id,
    transactionId: result.transaction_id,
    status: result.status,
    idempotentReplay: result.idempotent_replay,
  };
}
