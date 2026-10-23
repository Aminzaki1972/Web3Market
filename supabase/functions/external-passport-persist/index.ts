import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "https://web3market.xyz",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

const response = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: HEADERS });

Deno.serve((request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: HEADERS });
  if (request.method !== "POST") return response({ error: "POST required" }, 405);

  // External public research must not create official or persisted W3M Passports.
  // The marketplace-only Passport flow reads an existing approved project record.
  return response({
    success: false,
    eligible: false,
    code: "MARKETPLACE_LISTING_REQUIRED",
    error: "External Passport creation has been retired. Official Passports are available only for approved Web3Market marketplace projects.",
    next_step: "Open the AI Project Passport page with the ID of an approved marketplace project.",
  }, 410);
});
