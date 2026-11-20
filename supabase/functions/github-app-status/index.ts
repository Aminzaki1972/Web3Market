import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGINS = new Set(["https://web3market.xyz", "https://www.web3market.xyz"]);
function cors(req: Request) {
  const origin = req.headers.get("Origin") || "";
  let trusted = ORIGINS.has(origin);
  if (!trusted) {
    try {
      const parsed = new URL(origin);
      trusted = parsed.protocol === "https:" && /^(?:[a-z0-9-]+\.)*web3market\.pages\.dev$/i.test(parsed.hostname);
    } catch (_) { trusted = false; }
  }
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    Vary: "Origin",
  };
  if (trusted) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
function json(req: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, { ok: false, error: "POST required." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return json(req, { ok: false, error: "GitHub connection status is unavailable." }, 503);

  const authorization = req.headers.get("Authorization") || "";
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json(req, { ok: false, error: "Sign in to check GitHub connection status." }, 401);

  const sb = createClient(url, service);
  const { data: installation, error: installationError } = await sb
    .from("w3m_github_app_installations")
    .select("installation_id,account_login")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (installationError) {
    console.error("GitHub connection status lookup failed.");
    return json(req, { ok: false, error: "Unable to check GitHub connection status." }, 500);
  }
  if (!installation) return json(req, { ok: true, connected: false, repository_count: 0 });

  const { count, error: repositoryError } = await sb
    .from("w3m_github_app_installation_repositories")
    .select("repository_id", { count: "exact", head: true })
    .eq("installation_id", installation.installation_id);

  if (repositoryError) {
    console.error("GitHub repository status lookup failed.");
    return json(req, { ok: false, error: "Unable to check selected GitHub repositories." }, 500);
  }

  return json(req, {
    ok: true,
    connected: true,
    account_login: installation.account_login,
    repository_count: count || 0,
  });
});
