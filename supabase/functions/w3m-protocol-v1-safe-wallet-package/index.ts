// ISOLATED W3M Protocol V1 connected-wallet package endpoint.
// Authenticated, one-use, read-only chain composition. Not deployed.
// This endpoint prepares a package only; the connected owner wallet submits
// Safe.execTransaction and pays gas. No server-held private key or broadcast.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  createAllowlistedBnbRpcClient,
  type JsonRpcClient,
} from "../w3m-acquisition-verification/bnb-revenue-adapter.ts";
import type {
  SafeExecutionContextDatabase,
  FreshSafeHandlerContextDependencies,
} from "../w3m-acquisition-verification/fresh-safe-handler-context.ts";
import {
  readCanonicalBnbSafeExecutionFacts,
} from "../w3m-acquisition-verification/bnb-safe-execution-facts-reader.ts";
import {
  loadFreshSafeWalletPackageContext,
} from "../w3m-acquisition-verification/safe-wallet-package-context-composer.ts";
import {
  createW3MSafeWalletPackageRequestHandler,
} from "../w3m-acquisition-verification/safe-wallet-package-request-handler.ts";
import {
  verifyEthereumRawDigestSignature,
} from "../w3m-acquisition-verification/ethereum-signature-adapter.ts";
import type { SafeExecutionFreshSnapshot } from "../w3m-acquisition-verification/safe-execution-coordinator.ts";
import type { CanonicalBnbSafeExecutionFacts } from "../w3m-acquisition-verification/bnb-safe-execution-facts-reader.ts";
import { extractW3MBearerToken } from "../w3m-acquisition-verification/bearer-token.ts";

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
    return json(503, { ok: false, error: "W3M_WALLET_PACKAGE_NOT_CONFIGURED" }, origin);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let bnbRpc: JsonRpcClient;
  try {
    bnbRpc = createAllowlistedBnbRpcClient({
      rpcUrl: Deno.env.get("BSC_RPC_URL") ?? "https://bsc-rpc.publicnode.com",
      allowedHosts: ["bsc-rpc.publicnode.com"],
    });
  } catch {
    return json(503, { ok: false, error: "W3M_BNB_RPC_NOT_ALLOWED" }, origin);
  }

  const database = {
    rpc: (name: string, args: Record<string, unknown>) => supabase.rpc(name, args),
    from: (table: string) => supabase.from(table),
    request: <T>(method: string, params: unknown[]) => bnbRpc.request<T>(method, params),
  } as unknown as SafeExecutionContextDatabase;
  const contextDependencies: FreshSafeHandlerContextDependencies = {
    database,
    readSafeFacts: (expected) => readCanonicalBnbSafeExecutionFacts(bnbRpc, expected),
  };
  const factsBySnapshot = new WeakMap<SafeExecutionFreshSnapshot, CanonicalBnbSafeExecutionFacts>();

  const handler = createW3MSafeWalletPackageRequestHandler({
    authenticate: async (incoming) => {
      const token = extractW3MBearerToken(incoming.headers.get("authorization"));
      if (!token) return null;
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user?.id) return null;
      return { userId: data.user.id };
    },
    loadFresh: async (actorId, dealId) => {
      const context = await loadFreshSafeWalletPackageContext(
        contextDependencies,
        actorId,
        dealId,
        new Date().toISOString(),
        verifyEthereumRawDigestSignature,
      );
      factsBySnapshot.set(context.snapshot, context.liveFacts);
      return context.snapshot;
    },
    loadLiveFacts: async (snapshot) => {
      const facts = factsBySnapshot.get(snapshot);
      if (!facts) throw new Error("Canonical Safe facts are not bound to this exact fresh snapshot.");
      return facts;
    },
    rpc: database,
    verifySignature: verifyEthereumRawDigestSignature,
  });

  try {
    const response = await handler(request);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
    headers.set("cache-control", "no-store");
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return json(500, { ok: false, error: "W3M_WALLET_PACKAGE_INTERNAL_ERROR" }, origin);
  }
});
