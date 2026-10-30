import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { extractBearerToken, readJwtClaims } from "./request-auth.ts";

const cors = {
  "Access-Control-Allow-Origin": "https://web3market.xyz",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);

  try {
    const authorization = req.headers.get("Authorization") || "";
    const token = extractBearerToken(authorization);
    if (!token) return json({ ok: false, error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !serviceKey || !anonKey) {
      return json({ ok: false, error: "Premium approval service is not configured" }, 503);
    }

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return json({ ok: false, error: "Unauthorized" }, 401);

    const claims = readJwtClaims(token);
    if (claims?.aal !== "aal2") {
      return json({ ok: false, error: "Administrator MFA verification (AAL2) is required" }, 403);
    }

    const { data: membership, error: membershipError } = await admin
      .from("admin_users")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) return json({ ok: false, error: "Administrator access required" }, 403);

    const body = await req.json().catch(() => ({}));
    const auditId = String(body?.audit_id || "").trim();
    const reason = String(body?.reason || "").trim();
    if (!validUuid(auditId)) return json({ ok: false, error: "A valid audit_id is required" }, 400);
    if (reason.length < 20 || reason.length > 2000) {
      return json({ ok: false, error: "Approval reason must contain 20–2000 characters" }, 400);
    }

    const { data: audit, error: auditError } = await admin
      .from("code_audits")
      .select("id,project_id,status,overall_score,commit_sha,repo_owner,repo_name,branch")
      .eq("id", auditId)
      .maybeSingle();
    if (auditError) throw auditError;
    if (!audit || audit.status !== "completed" ||
        !Number.isFinite(Number(audit.overall_score)) ||
        Number(audit.overall_score) < 90 || Number(audit.overall_score) > 100 ||
        !/^[0-9a-f]{40}$/i.test(String(audit.commit_sha || ""))) {
      return json({ ok: false, error: "Audit is not eligible for Premium approval" }, 409);
    }

    // Reuse the independent read-only verifier so every persisted file/finding
    // and the GitHub branch HEAD are checked from server-side records.
    const verificationResponse = await fetch(url + "/functions/v1/w3m-trust-badge", {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": anonKey },
      body: JSON.stringify({ project_id: audit.project_id }),
    });
    if (!verificationResponse.ok) {
      return json({ ok: false, error: "Audit evidence could not be independently verified" }, 503);
    }
    const verification = await verificationResponse.json();
    if (verification?.ok !== true ||
        verification?.reason !== "premium_approval_required" ||
        verification?.audit_id !== auditId ||
        Number(verification?.score) !== Number(audit.overall_score) ||
        String(verification?.audited_commit || "").toLowerCase() !== String(audit.commit_sha).toLowerCase()) {
      return json({ ok: false, error: "Audit evidence, repository state, or current commit is not eligible" }, 409);
    }

    // Close the small time-of-check/time-of-use window by checking GitHub HEAD again
    // immediately before recording the approval.
    const owner = String(audit.repo_owner || "");
    const repo = String(audit.repo_name || "");
    const branch = String(audit.branch || "main");
    if (!/^[A-Za-z0-9-]{1,39}$/.test(owner) ||
        !/^[A-Za-z0-9_.-]{1,100}$/.test(repo) ||
        branch.length > 200 || branch.includes("..")) {
      return json({ ok: false, error: "Audit repository reference is invalid" }, 409);
    }
    const githubResponse = await fetch(
      "https://api.github.com/repos/" + encodeURIComponent(owner) + "/" +
      encodeURIComponent(repo) + "/commits/" + encodeURIComponent(branch),
      { headers: { "Accept": "application/vnd.github+json", "User-Agent": "Web3Market-Premium-Approval" } },
    );
    if (!githubResponse.ok) return json({ ok: false, error: "Current GitHub commit could not be confirmed" }, 503);
    const githubHead = await githubResponse.json();
    if (String(githubHead?.sha || "").toLowerCase() !== String(audit.commit_sha).toLowerCase()) {
      return json({ ok: false, error: "Repository changed; run a new audit before approval" }, 409);
    }

    const { data: inserted, error: insertError } = await admin
      .from("code_audit_badge_approvals")
      .insert({
        audit_id: auditId,
        project_id: audit.project_id,
        commit_sha: String(audit.commit_sha).toLowerCase(),
        approved_by: user.id,
        reason,
      })
      .select("id,audit_id,project_id,commit_sha,approved_by,approved_at,event_id,approval_version")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        return json({ ok: false, error: "A Premium approval already exists for this audit and commit" }, 409);
      }
      if (insertError.code === "P0001" || insertError.code === "23514") {
        return json({ ok: false, error: "Approval constraints rejected this audit" }, 409);
      }
      throw insertError;
    }

    return json({
      ok: true,
      approved: true,
      badge: "premium_verified",
      approval: inserted,
      note: "Approval is bound to this audit and commit. A later code change makes it stale.",
    }, 201);
  } catch (error) {
    console.error("w3m-trust-badge-approve failed", error instanceof Error ? error.message : "unknown error");
    return json({ ok: false, error: "Unable to record Premium approval" }, 500);
  }
});
