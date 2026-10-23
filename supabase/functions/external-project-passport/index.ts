import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_ORIGINS = new Set([
  "https://web3market.xyz",
  "https://www.web3market.xyz",
]);
function headers(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://web3market.xyz",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function response(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: headers(req) });
}
Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(req) });
  if (req.method !== "POST") return response(req, { error: "POST required" }, 405);
  return response(req, {
    success: false,
    eligible: false,
    code: "MARKETPLACE_LISTING_REQUIRED",
    error: "General external Passport scans have been retired. Official Web3Market Passports are available only for approved marketplace projects.",
    next_step: "Open the AI Project Passport page and search for an approved Web3Market listing or use its stable project ID.",
  }, 410);
});
