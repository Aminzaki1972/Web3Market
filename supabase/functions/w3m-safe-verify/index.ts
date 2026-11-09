import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createPublicClient, http, getAddress } from "npm:viem@2.37.6";
import { bsc } from "npm:viem@2.37.6/chains";
import { assessSafeConfiguration } from "../../../js/w3m-safe-configuration.js";

const PLATFORM_WALLET = "0x2B15cC63eE3b833F502C065767695Fa2B584f8c9";
const BSC_CHAIN_ID = 56;
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
const isAddress = (value: unknown): value is string =>
  typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value) && !/^0x0{40}$/i.test(value);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return fail("method_not_allowed", 405);

  try {
    const authorization = req.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) return fail("authentication_required", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return fail("server_configuration_unavailable", 503);

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) return fail("invalid_session", 401);

    const body = await req.json().catch(() => ({}));
    const dealId = String(body?.deal_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dealId)) {
      return fail("invalid_deal_id", 400);
    }

    const db = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: deal, error: dealError } = await db.from("deals")
      .select("id,buyer_id,seller_id,chain_id,safe_address")
      .eq("id", dealId).maybeSingle();
    if (dealError) return fail("deal_lookup_failed", 503);
    if (!deal) return fail("deal_not_found", 404);
    if (user.id !== deal.buyer_id && user.id !== deal.seller_id) return fail("not_a_deal_participant", 403);

    if (Number(deal.chain_id) !== BSC_CHAIN_ID) return fail("deal_chain_mismatch");
    if (!isAddress(deal.safe_address)) return fail("safe_address_missing_or_invalid");

    const [{ data: buyer, error: buyerError }, { data: seller, error: sellerError }, { data: policy, error: policyError }] =
      await Promise.all([
        db.from("profiles").select("wallet_address,wallet_verified").eq("id", deal.buyer_id).maybeSingle(),
        db.from("profiles").select("wallet_address,wallet_verified").eq("id", deal.seller_id).maybeSingle(),
        db.from("deal_release_policies").select("seller_wallet,platform_wallet,safe_address,chain_id")
          .eq("deal_id", dealId).maybeSingle(),
      ]);
    if (buyerError || sellerError || policyError || !buyer || !seller || !policy) {
      return fail("expected_owner_records_unavailable", 503);
    }
    if (buyer.wallet_verified !== true || seller.wallet_verified !== true ||
        !isAddress(buyer.wallet_address) || !isAddress(seller.wallet_address) ||
        !isAddress(policy.seller_wallet) || !isAddress(policy.platform_wallet)) {
      return fail("verified_owner_identity_missing");
    }
    if (String(seller.wallet_address).toLowerCase() !== String(policy.seller_wallet).toLowerCase()) {
      return fail("seller_wallet_policy_mismatch");
    }
    if (String(policy.platform_wallet).toLowerCase() !== PLATFORM_WALLET.toLowerCase()) {
      return fail("platform_wallet_policy_mismatch");
    }
    if (!isAddress(policy.safe_address) ||
        String(policy.safe_address).toLowerCase() !== String(deal.safe_address).toLowerCase() ||
        Number(policy.chain_id) !== BSC_CHAIN_ID) {
      return fail("release_policy_safe_mismatch");
    }

    const rpcUrl = Deno.env.get("BSC_RPC_URL") || Deno.env.get("SAFE_BSC_RPC_URL");
    if (!rpcUrl) return fail("bsc_rpc_unavailable", 503);
    const client = createPublicClient({ chain: bsc, transport: http(rpcUrl) });
    const safeAddress = getAddress(deal.safe_address);
    const [code, owners, threshold, nonce] = await Promise.all([
      client.getBytecode({ address: safeAddress }),
      client.readContract({ address: safeAddress, abi: SAFE_ABI, functionName: "getOwners" }),
      client.readContract({ address: safeAddress, abi: SAFE_ABI, functionName: "getThreshold" }),
      client.readContract({ address: safeAddress, abi: SAFE_ABI, functionName: "nonce" }),
    ]);
    const assessment = assessSafeConfiguration({
      owners: [...owners],
      threshold,
      code: code || "0x",
      expectedOwners: [buyer.wallet_address, seller.wallet_address, policy.platform_wallet],
    });
    if (!assessment.ok) {
      return json({
        ok: false, verified: false, safe_policy_verified: false, reason: assessment.reason,
        owner_count: assessment.ownerCount, threshold: assessment.threshold,
        contract_exists: Boolean(code && code !== "0x"),
      }, 409);
    }
    return json({
      ok: true, verified: true, safe_policy_verified: true, reason: "valid",
      owner_count: assessment.ownerCount, threshold: assessment.threshold,
      nonce: nonce.toString(), contract_exists: true, chain_id: BSC_CHAIN_ID,
    });
  } catch (error) {
    console.error("W3M Safe verification failed:", error instanceof Error ? error.name : "unknown");
    return fail("safe_verification_unavailable", 503);
  }
});
