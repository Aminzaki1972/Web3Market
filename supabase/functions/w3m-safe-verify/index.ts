import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createPublicClient, http, getAddress } from "npm:viem@2.37.6";
import { bsc } from "npm:viem@2.37.6/chains";
import { assessSafeConfiguration } from "../_shared/w3m-safe-configuration.js";
import { isW3MBscMainnetChain, W3M_BSC_MAINNET_CHAIN_ID } from "../_shared/w3m-safe-chain.ts";
import { assessSafeVerificationContext } from "../_shared/w3m-safe-verification-context.ts";

const BSC_CHAIN_ID = W3M_BSC_MAINNET_CHAIN_ID;
const SAFE_ABI = [
  { type: "function", name: "getOwners", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { type: "function", name: "getThreshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "nonce", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;
const cors = {
  "Access-Control-Allow-Origin": "https://web3market.xyz",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (reason: string, status = 409) => json({
  ok: false, verified: false, safe_policy_verified: false, reason,
}, status);

type Deal = {
  id: string; buyer_id: string; seller_id: string; chain_id: unknown; safe_address: unknown;
};
type OwnerRecords = {
  buyer: { wallet_address: unknown; wallet_verified: unknown };
  seller: { wallet_address: unknown; wallet_verified: unknown };
  policy: { seller_wallet: unknown; platform_wallet: unknown; safe_address: unknown; chain_id: unknown };
};
type SafeRead = { code: string | undefined; owners: string[]; threshold: bigint; nonce: bigint };
export type W3MSafeVerifyDependencies = {
  authenticate: () => Promise<{ userId: string | null; error?: boolean }>;
  loadDeal: (dealId: string) => Promise<{ deal: Deal | null; error?: boolean }>;
  loadOwnerRecords: (deal: Deal) => Promise<{ records: OwnerRecords | null; error?: boolean }>;
  getRpcChainId: () => Promise<number>;
  readSafe: (address: string) => Promise<SafeRead>;
};

function createDefaultDependencies(authorization: string): W3MSafeVerifyDependencies | null {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const rpcUrl = Deno.env.get("BSC_RPC_URL") || Deno.env.get("SAFE_BSC_RPC_URL");
  if (!supabaseUrl || !anonKey || !serviceKey || !rpcUrl) return null;

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rpc = createPublicClient({ chain: bsc, transport: http(rpcUrl) });
  return {
    authenticate: async () => {
      const { data: { user }, error } = await authClient.auth.getUser();
      return { userId: user?.id ?? null, error: Boolean(error) };
    },
    loadDeal: async (dealId) => {
      const { data, error } = await db.from("deals")
        .select("id,buyer_id,seller_id,chain_id,safe_address")
        .eq("id", dealId).maybeSingle();
      return { deal: data as Deal | null, error: Boolean(error) };
    },
    loadOwnerRecords: async (deal) => {
      const [{ data: buyer, error: buyerError }, { data: seller, error: sellerError }, { data: policy, error: policyError }] =
        await Promise.all([
          db.from("profiles").select("wallet_address,wallet_verified").eq("id", deal.buyer_id).maybeSingle(),
          db.from("profiles").select("wallet_address,wallet_verified").eq("id", deal.seller_id).maybeSingle(),
          db.from("deal_release_policies").select("seller_wallet,platform_wallet,safe_address,chain_id")
            .eq("deal_id", deal.id).maybeSingle(),
        ]);
      if (buyerError || sellerError || policyError || !buyer || !seller || !policy) {
        return { records: null, error: true };
      }
      return { records: { buyer, seller, policy } as OwnerRecords };
    },
    getRpcChainId: () => rpc.getChainId(),
    readSafe: async (address) => {
      const safeAddress = getAddress(address);
      const [code, owners, threshold, nonce] = await Promise.all([
        rpc.getBytecode({ address: safeAddress }),
        rpc.readContract({ address: safeAddress, abi: SAFE_ABI, functionName: "getOwners" }),
        rpc.readContract({ address: safeAddress, abi: SAFE_ABI, functionName: "getThreshold" }),
        rpc.readContract({ address: safeAddress, abi: SAFE_ABI, functionName: "nonce" }),
      ]);
      return { code, owners: [...owners], threshold, nonce };
    },
  };
}

export async function handleW3MSafeVerify(
  req: Request,
  injected?: W3MSafeVerifyDependencies,
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return fail("method_not_allowed", 405);

  try {
    const authorization = req.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) return fail("authentication_required", 401);

    const body = await req.json().catch(() => null);
    const dealId = String(body?.deal_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dealId)) {
      return fail("invalid_deal_id", 400);
    }

    const deps = injected ?? createDefaultDependencies(authorization);
    if (!deps) return fail("server_configuration_unavailable", 503);

    const auth = await deps.authenticate();
    if (auth.error || !auth.userId) return fail("invalid_session", 401);

    const dealResult = await deps.loadDeal(dealId);
    if (dealResult.error) return fail("deal_lookup_failed", 503);
    const deal = dealResult.deal;
    if (!deal) return fail("deal_not_found", 404);
    if (auth.userId !== deal.buyer_id && auth.userId !== deal.seller_id) {
      return fail("not_a_deal_participant", 403);
    }

    const ownerResult = await deps.loadOwnerRecords(deal);
    if (ownerResult.error || !ownerResult.records) return fail("expected_owner_records_unavailable", 503);
    const { buyer, seller, policy } = ownerResult.records;
    const context = assessSafeVerificationContext({ deal, buyer, seller, policy });
    if (!context.ok) return fail(context.reason);

    const rpcChainId = await deps.getRpcChainId();
    if (!isW3MBscMainnetChain(rpcChainId)) return fail("bsc_rpc_chain_mismatch", 503);

    // Fail closed until the SafeProxy runtime hash is reproducibly derived, independently
    // verified against BNB Chain, and pinned in this source. A non-empty bytecode check
    // is not proof that this address is an authentic SafeProxy deployment.
    return fail("SAFE_AUTHENTICITY_UNVERIFIED", 503);

    const safe = await deps.readSafe(String(deal.safe_address));
    const assessment = assessSafeConfiguration({
      owners: safe.owners,
      threshold: safe.threshold,
      code: safe.code || "0x",
      expectedOwners: [...context.expectedOwners],
    });
    if (!assessment.ok) {
      return json({
        ok: false, verified: false, safe_policy_verified: false, reason: assessment.reason,
        owner_count: assessment.ownerCount, threshold: assessment.threshold,
        contract_exists: Boolean(safe.code && safe.code !== "0x"),
      }, 409);
    }
    return json({
      ok: true, verified: true, safe_policy_verified: true, reason: "valid",
      owner_count: assessment.ownerCount, threshold: assessment.threshold,
      nonce: safe.nonce.toString(), contract_exists: true, chain_id: BSC_CHAIN_ID,
    });
  } catch (error) {
    console.error("W3M Safe verification failed:", error instanceof Error ? error.name : "unknown");
    return fail("safe_verification_unavailable", 503);
  }
}

if (import.meta.main) Deno.serve((req) => handleW3MSafeVerify(req));
