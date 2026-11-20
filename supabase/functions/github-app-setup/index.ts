import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createGitHubAppJwt, fetchGitHubInstallation, fetchInstallationRepositories } from "../_shared/github-app.ts";

const APP_ORIGIN = "https://web3market.xyz";
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function redirect(status: string) {
  return new Response(null, { status: 302, headers: { Location: APP_ORIGIN + "/code-audit.html?github_app=" + encodeURIComponent(status), "Cache-Control": "no-store" } });
}

Deno.serve(async (req) => {
  if (req.method !== "GET") return new Response("GET required.", { status: 405 });
  const params = new URL(req.url).searchParams;
  const state = params.get("state") || "";
  const installationId = Number(params.get("installation_id"));
  const setupAction = params.get("setup_action") || "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !Number.isSafeInteger(installationId) || installationId <= 0 || !["install", "update"].includes(setupAction)) return redirect("invalid");
  const url = Deno.env.get("SUPABASE_URL"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const appId = Deno.env.get("W3M_GITHUB_APP_ID"), privateKey = Deno.env.get("W3M_GITHUB_APP_PRIVATE_KEY");
  if (!url || !service || !appId || !privateKey) return redirect("not_configured");
  const sb = createClient(url, service);
  const stateHash = await sha256(state);
  const now = new Date().toISOString();
  const { data: intent, error: consumeError } = await sb.from("w3m_github_app_install_intents")
    .update({ consumed_at: now })
    .eq("state_hash", stateHash)
    .is("consumed_at", null)
    .gt("expires_at", now)
    .select("id,user_id")
    .maybeSingle();
  if (consumeError || !intent) return redirect("expired_or_used");

  try {
    const jwt = await createGitHubAppJwt(appId, privateKey);
    const installation = await fetchGitHubInstallation(jwt, installationId);
    const account = installation?.account;
    const accountId = Number(account?.id);
    const accountLogin = String(account?.login || "");
    const accountType = String(account?.type || "");
    if (!accountId || !accountLogin || !["User", "Organization"].includes(accountType)) throw new Error("GitHub installation account data is invalid.");
    const granted = installation?.permissions || {};
    if (granted.contents !== "write" || granted.pull_requests !== "write") {
      throw new Error("The GitHub App installation does not have the required repository permissions.");
    }
    const repositories = await fetchInstallationRepositories(jwt, installationId);
    if (!repositories.length) throw new Error("No repositories were granted to this GitHub App installation.");
    const { data: existingInstallation, error: existingError } = await sb.from("w3m_github_app_installations")
      .select("user_id")
      .eq("installation_id", installationId)
      .maybeSingle();
    if (existingError) throw new Error("Unable to verify existing GitHub installation ownership.");
    if (existingInstallation && existingInstallation.user_id !== intent.user_id) {
      throw new Error("This GitHub installation is already linked to a different Web3Market user.");
    }
    if (existingInstallation) {
      const { error: updateError } = await sb.from("w3m_github_app_installations")
        .update({ account_id: accountId, account_login: accountLogin, account_type: accountType, updated_at: now })
        .eq("installation_id", installationId)
        .eq("user_id", intent.user_id);
      if (updateError) throw new Error("Unable to refresh GitHub installation ownership.");
    } else {
      const { error: insertError } = await sb.from("w3m_github_app_installations").insert({
        user_id: intent.user_id,
        installation_id: installationId,
        account_id: accountId,
        account_login: accountLogin,
        account_type: accountType,
        updated_at: now,
      });
      if (insertError) {
        const { data: racedInstallation, error: raceReadError } = await sb.from("w3m_github_app_installations")
          .select("user_id")
          .eq("installation_id", installationId)
          .maybeSingle();
        if (raceReadError || !racedInstallation || racedInstallation.user_id !== intent.user_id) {
          throw new Error("This GitHub installation could not be safely linked to this Web3Market user.");
        }
      }
    }
    const { error: clearError } = await sb.from("w3m_github_app_installation_repositories").delete().eq("installation_id", installationId);
    if (clearError) throw new Error("Unable to refresh installed repository permissions.");
    const rows = repositories.map((repo: any) => ({
      installation_id: installationId,
      repository_id: Number(repo.id),
      repository_full_name: String(repo.full_name || "").toLowerCase(),
      is_private: Boolean(repo.private),
    })).filter((repo: any) => Number.isSafeInteger(repo.repository_id) && repo.repository_id > 0 && repo.repository_full_name.includes("/"));
    if (!rows.length) throw new Error("GitHub returned no valid repository records.");
    const { error: repoError } = await sb.from("w3m_github_app_installation_repositories").insert(rows);
    if (repoError) throw new Error("Unable to save selected GitHub repositories.");
    return redirect("connected");
  } catch (error) {
    console.error("GitHub App setup callback failed:", String((error as any)?.message || error).slice(0, 250));
    return redirect("failed");
  }
});
