// ISOLATED W3M Protocol V1 PREPARE endpoint.
// New server-side entrypoint; not deployed and does not replace the live handler.
// Browser input is limited to deal_id. Service-role credentials never leave this function.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  createAllowlistedBnbRpcClient,
  type JsonRpcClient,
} from "../w3m-acquisition-verification/bnb-revenue-adapter.ts";
import {
  createBnbSafeLiveReadClientAtCurrentBlock,
} from "../w3m-acquisition-verification/bnb-safe-live-read-client.ts";
import {
  readAndVerifySafeConfigurationFacts,
} from "../w3m-acquisition-verification/safe-live-configuration-facts.ts";
import type {
  CanonicalPrelockSafeFacts,
  PrelockPrepareDatabase,
} from "../w3m-acquisition-verification/prelock-safe-prepare-gate.ts";
import type { W3MRpcClient } from "../w3m-acquisition-verification/supabase-rpc-adapter.ts";
import type { SafeConfigurationExpectation } from "../w3m-acquisition-verification/safe-live-configuration-facts.ts";
import {
  verifyEthereumRawDigestSignature,
} from "../w3m-acquisition-verification/ethereum-signature-adapter.ts";
import {
  handleW3MPrelockPrepareRequest,
} from "../w3m-acquisition-verification/prelock-safe-prepare-request-handler.ts";

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
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    return json(503, { ok: false, error: "W3M_PREPARE_NOT_CONFIGURED" }, origin);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const database = supabase as unknown as PrelockPrepareDatabase & W3MRpcClient;

  let bnbRpc: JsonRpcClient;
  try {
    const rpcUrl = Deno.env.get("BSC_RPC_URL") ?? "https://bsc-rpc.publicnode.com";
    bnbRpc = createAllowlistedBnbRpcClient({
      rpcUrl,
      allowedHosts: ["bsc-rpc.publicnode.com"],
    });
  } catch {
    return json(503, { ok: false, error: "W3M_BNB_RPC_NOT_ALLOWED" }, origin);
  }

  const response = await handleW3MPrelockPrepareRequest(request, {
    authenticate: async (token) => {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user?.id) return null;
      return data.user.id;
    },
    buildServerContext: async ({ actorId, dealId }) => {
      // actorId and dealId are the only caller-controlled values that reach this
      // factory. Every amount, wallet, policy, report and Safe fact is reloaded.
      if (!actorId || !dealId) throw new Error("Authenticated PREPARE identity is required.");
      const safeReader = await createBnbSafeLiveReadClientAtCurrentBlock(bnbRpc);
      const blockTag = safeReader.blockTag;
      const before = await bnbRpc.request<unknown>("eth_getBlockByNumber", [blockTag, false]);
      if (!isRecord(before) || typeof before.hash !== "string" ||
          !/^0x[0-9a-f]{64}$/i.test(before.hash) || before.number !== blockTag) {
        throw new Error("Canonical BNB block header is unavailable.");
      }

      const beforeHash = before.hash.toLowerCase();
      const gate = {
        database,
        async readSafeConfiguration(expected: SafeConfigurationExpectation): Promise<CanonicalPrelockSafeFacts> {
          const facts = await readAndVerifySafeConfigurationFacts(safeReader, expected);
          const after = await bnbRpc.request<unknown>("eth_getBlockByNumber", [blockTag, false]);
          if (!isRecord(after) || typeof after.hash !== "string" ||
              !/^0x[0-9a-f]{64}$/i.test(after.hash) ||
              after.number !== blockTag ||
              after.hash.toLowerCase() !== beforeHash) {
            throw new Error("BNB block changed during the Safe configuration read.");
          }
          return {
            ...facts,
            readBlockNumber: blockTag,
            readBlockHash: beforeHash,
          };
        },
      };
      return {
        gate,
        persistence: database,
        recoverAndVerify: verifyEthereumRawDigestSignature,
      };
    },
    now: () => new Date().toISOString(),
  });

  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, headers });
});
