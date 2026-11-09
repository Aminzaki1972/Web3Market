import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createPublicClient, http, type Address } from "npm:viem@2.37.6";
import { bsc } from "npm:viem@2.37.6/chains";
import { assessSafeConfiguration } from "../../../js/w3m-safe-configuration.js";
import { isW3MBscMainnetChain } from "../_shared/w3m-safe-chain.ts";
import {
  assessW3MSafeAuthenticity,
  W3M_SAFE_AUTHENTICITY_CONSTANTS,
  type W3MSafeAuthenticityExpected,
} from "../_shared/w3m-safe-authenticity.ts";
import { assessSafeVerificationContext } from "../_shared/w3m-safe-verification-context.ts";

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
type SafeAuthenticityRecords = {
  proxyCode: unknown;
  singletonCode: unknown;
  factoryCode: unknown;
  singletonStorage: unknown;
  masterCopy: unknown;
};
type SafePolicyRecords = { owners: unknown; threshold: unknown };

const SAFE_POLICY_ABI = [
  {
    type: "function",
    name: "getOwners",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "owners", type: "address[]" }],
  },
  {
    type: "function",
    name: "getThreshold",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "threshold", type: "uint256" }],
  },
] as const;

export type W3MSafeVerifyDependencies = {
  authenticate: () => Promise<{ userId: string | null; error?: boolean }>;
  loadDeal: (dealId: string) => Promise<{ deal: Deal | null; error?: boolean }>;
  loadOwnerRecords: (deal: Deal) => Promise<{ records: OwnerRecords | null; error?: boolean }>;
  getRpcChainId: () => Promise<number>;
  readSafeAuthenticity: (safeAddress: string) => Promise<SafeAuthenticityRecords>;
  readSafePolicy: (safeAddress: string) => Promise<SafePolicyRecords>;
  expectedAuthenticity?: W3MSafeAuthenticityExpected; // Test-only override; production dependencies never set this.
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
    readSafeAuthenticity: async (safeAddress) => {
      const safe = safeAddress as Address;
      const singleton = W3M_SAFE_AUTHENTICITY_CONSTANTS.singletonAddress as Address;
      const factory = W3M_SAFE_AUTHENTICITY_CONSTANTS.factoryAddress as Address;
      const [proxyCode, singletonCode, factoryCode, singletonStorage, masterCopyResult] = await Promise.all([
        rpc.getBytecode({ address: safe }),
        rpc.getBytecode({ address: singleton }),
        rpc.getBytecode({ address: factory }),
        rpc.getStorageAt({ address: safe, slot: "0x0" }),
        rpc.call({ to: safe, data: "0xa619486e" }),
      ]);
      return {
        proxyCode: proxyCode ?? "0x",
        singletonCode: singletonCode ?? "0x",
        factoryCode: factoryCode ?? "0x",
        singletonStorage: singletonStorage ?? "0x",
        masterCopy: masterCopyResult.data ?? "0x",
      };
    },
    readSafePolicy: async (safeAddress) => {
      const safe = safeAddress as Address;
      const [owners, threshold] = await Promise.all([
        rpc.readContract({ address: safe, abi: SAFE_POLICY_ABI, functionName: "getOwners" }),
        rpc.readContract({ address: safe, abi: SAFE_POLICY_ABI, functionName: "getThreshold" }),
      ]);
      return { owners, threshold };
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

    // Authenticate contract identity before reading owners or threshold.
    const safeAddress = String(deal.safe_address);
    const authenticityRecords = await deps.readSafeAuthenticity(safeAddress);
    const authenticity = assessW3MSafeAuthenticity({
      chainId: rpcChainId,
      safeAddress: deal.safe_address,
      ...authenticityRecords,
    }, deps.expectedAuthenticity);
    if (!authenticity.ok) return fail(authenticity.reason, 503);

    // Only after proxy/singleton/factory authenticity passes, inspect the Safe policy.
    const safePolicyRecords = await deps.readSafePolicy(safeAddress);
    const safePolicy = assessSafeConfiguration({
      owners: safePolicyRecords.owners,
      threshold: safePolicyRecords.threshold,
      code: authenticityRecords.proxyCode,
      expectedOwners: context.expectedOwners,
    });
    if (!safePolicy.ok) return fail(safePolicy.reason, 409);

    return json({
      ok: true,
      verified: true,
      safe_policy_verified: true,
      safe_address: safeAddress,
      chain_id: 56,
      owner_count: safePolicy.ownerCount,
      threshold: safePolicy.threshold,
      authenticity: {
        proxy_runtime_hash: authenticity.proxyRuntimeHash,
        singleton_runtime_hash: authenticity.singletonRuntimeHash,
        factory_runtime_hash: authenticity.factoryRuntimeHash,
        singleton_address: authenticity.singletonAddress,
      },
    });
  } catch (error) {
    console.error("W3M Safe verification failed:", error instanceof Error ? error.name : "unknown");
    return fail("safe_verification_unavailable", 503);
  }
}

if (import.meta.main) Deno.serve((req) => handleW3MSafeVerify(req));
