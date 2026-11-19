import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGINS = new Set(["https://web3market.xyz", "https://www.web3market.xyz"]);
function cors(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const headers: Record<string, string> = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST,OPTIONS", Vary: "Origin" };
  if (ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
function json(req: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors(req), "Content-Type": "application/json" } });
}
function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\\+/g, "-").replace(/\\//g, "_");
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, { ok: false, error: "POST required." }, 405);
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const slug = Deno.env.get("W3M_GITHUB_APP_SLUG") || "web3market-aminzaki1972";
  if (!url || !anon || !service) return json(req, { ok: false, error: "GitHub App installation is not configured on the server." }, 503);
  const authorization = req.headers.get("Authorization") || "";
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return json(req, { ok: false, error: "Sign in before connecting GitHub." }, 401);

  const random = crypto.getRandomValues(new Uint8Array(32));
  const state = base64Url(random);
  const stateHash = await sha256(state);
  const sb = createClient(url, service);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error: insertError } = await sb.from("w3m_github_app_install_intents").insert({ user_id: user.id, state_hash: stateHash, expires_at: expiresAt });
  if (insertError) {
    console.error("GitHub App installation intent creation failed.");
    return json(req, { ok: false, error: "Unable to start GitHub connection." }, 500);
  }
  const installUrl = "https://github.com/apps/" + encodeURIComponent(slug) + "/installations/new?state=" + encodeURIComponent(state);
  return json(req, { ok: true, install_url: installUrl, expires_in_seconds: 600 });
});
