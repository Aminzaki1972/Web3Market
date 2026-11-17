// W3M Protocol V1 — authenticated admin-only dispute decision endpoint.
// Isolated implementation only; not deployed and not connected to the live Deal Room.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { W3MDisputeDecisionRpcClient } from "../w3m-acquisition-verification/dispute-decision-service.ts";
import { persistW3MDisputeDecision } from "../w3m-acquisition-verification/dispute-decision-service.ts";
import { handleW3MDisputeDecisionRequest } from "../w3m-acquisition-verification/dispute-decision-request-handler.ts";

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

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") ?? "";
  if (!ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ ok: false, error: "W3M_DISPUTE_DECISION_NOT_CONFIGURED" }), {
      status: 503,
      headers: { ...corsHeaders(origin), "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const database: W3MDisputeDecisionRpcClient = {
    async rpc(name, args) {
      const result = await supabase.rpc(name, args);
      return { data: result.data, error: result.error };
    },
  };

  const response = await handleW3MDisputeDecisionRequest(request, {
    authenticate: async (token) => {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user?.id) return null;
      return data.user.id;
    },
    isAdmin: async (actorId) => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, role")
        .eq("id", actorId)
        .maybeSingle();
      if (error) throw new Error("Administrator profile could not be checked.");
      return data?.id === actorId && String(data?.role ?? "").toLowerCase() === "admin";
    },
    decide: async ({ command, actorId }) => {
      const result = await persistW3MDisputeDecision(database, { command, actorId });
      return {
        decisionId: result.decisionId,
        decisionHash: result.decisionHash,
        outcome: result.outcome,
        state: result.dealDisputeStatus,
        buyerRefundAmount: result.buyerRefundAmount,
      };
    },
  });

  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, headers });
});
