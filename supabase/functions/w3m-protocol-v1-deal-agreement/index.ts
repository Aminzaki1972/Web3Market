// ISOLATED W3M buyer/seller agreement signing endpoint.
// New function directory; not deployed and does not modify the live Deal Room.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import type { W3MRpcClient } from "../w3m-acquisition-verification/supabase-rpc-adapter.ts";
import {
  acceptDealAgreement,
  prepareDealAgreementAcceptance,
} from "../w3m-acquisition-verification/deal-agreement-service.ts";
import { handleW3MDealAgreementRequest } from "../w3m-acquisition-verification/deal-agreement-request-handler.ts";

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
    return new Response(JSON.stringify({ ok: false, error: "W3M_AGREEMENT_NOT_CONFIGURED" }), {
      status: 503,
      headers: { ...corsHeaders(origin), "content-type": "application/json", "cache-control": "no-store" },
    });
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
  const response = await handleW3MDealAgreementRequest(request, {
    authenticate: async (token) => {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user?.id) return null;
      return data.user.id;
    },
    prepare: async (input) => await prepareDealAgreementAcceptance(database, input),
    accept: async (input) => await acceptDealAgreement(database, input),
  });
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, headers });
});
