// ISOLATED W3M Protocol V1 SIGN endpoint.
// New authenticated server-side entrypoint; not deployed and does not replace
// record-safe-release-signature. It only stores a signature after fresh W3M PASS.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  createAllowlistedBnbRpcClient,
  type JsonRpcClient,
} from "../w3m-acquisition-verification/bnb-revenue-adapter.ts";
import type {
  FreshSafeHandlerContextDependencies,
  SafeExecutionContextDatabase,
} from "../w3m-acquisition-verification/fresh-safe-handler-context.ts";
import {
  readCanonicalBnbSafeExecutionFacts,
} from "../w3m-acquisition-verification/bnb-safe-execution-facts-reader.ts";
import {
  loadAndAuthorizeFreshSafeSignContext,
} from "../w3m-acquisition-verification/safe-sign-context-composer.ts";
import {
  createW3MSafeSignRequestHandler,
} from "../w3m-acquisition-verification/safe-sign-request-handler.ts";
import {
  verifyEthereumRawDigestSignature,
} from "../w3m-acquisition-verification/ethereum-signature-adapter.ts";
import {
  persistSafeReleaseSignatureAtomically,
} from "../w3m-acquisition-verification/safe-signature-persistence-adapter.ts";
import type { W3MPhaseAuthorization } from "../w3m-acquisition-verification/safe-edge-w3m-phase-boundary.ts";

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
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json(503, { ok: false, error: "W3M_SIGN_NOT_CONFIGURED" }, origin);
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

  // Supabase client is server-side only. The same object is used for exact
  // report/evidence reads and service-role RPCs; BNB reads use the separate
  // allowlisted JSON-RPC client.
  const database = {
    rpc: (name: string, args: Record<string, unknown>) => supabase.rpc(name, args),
    from: (table: string) => supabase.from(table),
    request: <T>(method: string, params: unknown[]) => bnbRpc.request<T>(method, params),
  } as unknown as SafeExecutionContextDatabase;
  const contextDependencies: FreshSafeHandlerContextDependencies = {
    database,
    readSafeFacts: (expected) => readCanonicalBnbSafeExecutionFacts(bnbRpc, expected),
  };

  const handler = createW3MSafeSignRequestHandler({
    authenticate: async (incoming) => {
      const match = /^Bearer\\s+(.+)$/i.exec(incoming.headers.get("authorization") ?? "");
      if (!match?.[1]?.trim()) return null;
      const { data, error } = await supabase.auth.getUser(match[1].trim());
      if (error || !data.user?.id) return null;
      return { userId: data.user.id };
    },
    loadFreshContext: async ({ actorId, dealId, safeTransactionHash }) =>
      await loadAndAuthorizeFreshSafeSignContext(contextDependencies, {
        actorId,
        dealId,
        safeTransactionHash,
        now: new Date().toISOString(),
      }),
    verifyTypedDataSignature: async ({ safeTransactionHash, signature, expectedWallet }) =>
      await verifyEthereumRawDigestSignature({
        digestHex: safeTransactionHash.slice(2),
        signature,
        expectedAddress: expectedWallet,
      }),
    persistSignatureAtomically: async (input) =>
      await persistSafeReleaseSignatureAtomically(database, {
        actorId: input.actorId,
        dealId: input.dealId,
        safeTransactionHash: input.safeTransactionHash,
        signature: input.signature,
        verifiedWallet: input.verifiedWallet,
        signerRole: input.signerRole,
        authorization: input.authorization as W3MPhaseAuthorization,
      }),
  });
  const response = await handler(request);
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, headers });
});
