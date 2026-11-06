// ISOLATED W3M Protocol V1 finalization endpoint.
// This is a new function directory. It does not replace or modify the deployed
// finalize-safe-release function. Deploy only after separate approval/review.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  createAllowlistedBnbRpcClient,
} from "../w3m-acquisition-verification/bnb-revenue-adapter.ts";
import {
  finalizeBnbSafeReleaseFromFreshSnapshot,
} from "../w3m-acquisition-verification/bnb-safe-receipt-verifier.ts";
import type { W3MRpcClient } from "../w3m-acquisition-verification/supabase-rpc-adapter.ts";
import { handleW3MSafeFinalizationRequest } from "../w3m-acquisition-verification/safe-finalization-request-handler.ts";

const ALLOWED_ORIGINS = new Set([
  "https://web3market.xyz",
  "https://www.web3market.xyz",
]);
const corsHeaders = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
function json(status: number, body: Record<string, unknown>, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "content-type": "application/json", "cache-control": "no-store" },
  });
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") ?? "";
  if (!ALLOWED_ORIGINS.has(origin)) {
    return new Response(null, { status: 403 });
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const minConfirmationsRaw = Deno.env.get("W3M_BNB_MIN_CONFIRMATIONS");
  const minConfirmations = Number(minConfirmationsRaw);
  if (!supabaseUrl || !serviceRoleKey ||
      !Number.isSafeInteger(minConfirmations) ||
      minConfirmations < 1 || minConfirmations > 1000) {
    return json(503, { ok: false, error: "W3M_FINALIZATION_NOT_CONFIGURED" }, origin);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const database: W3MRpcClient = {
    async rpc(name, args) {
      const result = await supabase.rpc(name, args);
      return { data: result.data, error: result.error };
    },
  };
  let bnbRpc;
  try {
    const rpcUrl = Deno.env.get("BSC_RPC_URL") ?? "https://bsc-rpc.publicnode.com";
    bnbRpc = createAllowlistedBnbRpcClient({
      rpcUrl,
      allowedHosts: ["bsc-rpc.publicnode.com"],
    });
  } catch {
    return json(503, { ok: false, error: "W3M_BNB_RPC_NOT_ALLOWED" }, origin);
  }

  const response = await handleW3MSafeFinalizationRequest(request, {
    authenticate: async (token) => {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user?.id) return null;
      return data.user.id;
    },
    finalize: async ({ attemptId, actorId }) =>
      await finalizeBnbSafeReleaseFromFreshSnapshot(database, bnbRpc, {
        attemptId,
        actorId,
        minConfirmations,
      }),
  });
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, headers });
});
