// ISOLATED W3M Protocol V1 connected-wallet submission-hash endpoint.
// Authenticated persistence only. The browser-reported hash is UNVERIFIED;
// this function never trusts it as proof, never broadcasts, and never finalizes.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import type { W3MRpcClient } from "../w3m-acquisition-verification/supabase-rpc-adapter.ts";
import {
  createW3MSafeWalletSubmissionRequestHandler,
} from "../w3m-acquisition-verification/safe-wallet-submission-request-handler.ts";

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
  if (!ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== "POST") return json(405, { ok: false, error: "POST_REQUIRED" }, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json(503, { ok: false, error: "W3M_WALLET_SUBMIT_NOT_CONFIGURED" }, origin);
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

  const handler = createW3MSafeWalletSubmissionRequestHandler({
    authenticate: async (incoming) => {
      const match = /^Bearer\s+(.+)$/i.exec(incoming.headers.get("authorization") ?? "");
      if (!match?.[1]?.trim()) return null;
      const { data, error } = await supabase.auth.getUser(match[1].trim());
      if (error || !data.user?.id) return null;
      return { userId: data.user.id };
    },
    rpc: database,
  });
  try {
    const response = await handler(request);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
    headers.set("cache-control", "no-store");
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return json(500, { ok: false, error: "W3M_WALLET_SUBMIT_INTERNAL_ERROR" }, origin);
  }
});
