import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGINS = new Set(["https://web3market.xyz", "https://www.web3market.xyz"]);
function cors(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Vary": "Origin",
  };
  let allowed = ORIGINS.has(origin);
  try { const parsed = new URL(origin); allowed = allowed || (parsed.protocol === "https:" && /^(?:[a-z0-9-]+\.)*web3market\.pages\.dev$/i.test(parsed.hostname)); } catch (_) { /* deny unknown origins */ }
  if (allowed) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });
const randomToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, x => x.toString(16).padStart(2, "0")).join("");
};
async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, { ok: false, error: "POST required" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) return json(req, { ok: false, error: "Guest report service is not configured." }, 503);
  const db = createClient(url, service);
  try {
    const body = await req.json();
    if (body.action === "exchange") {
      const reportToken = String(body.report_token || "");
      if (!/^[0-9a-f]{64}$/i.test(reportToken)) return json(req, { ok: false, error: "Invalid or expired report link." }, 400);
      const reportHash = await hash(reportToken);
      const { data: access, error } = await db.from("guest_audit_access")
        .select("id,payment_order_id,report_token_expires_at,report_token_used_at,revoked_at")
        .eq("report_token_hash", reportHash).maybeSingle();
      if (error || !access || access.revoked_at || access.report_token_used_at ||
          !access.report_token_expires_at || new Date(access.report_token_expires_at).getTime() <= Date.now()) {
        return json(req, { ok: false, error: "This private report link is invalid, expired, already used, or revoked. Request a new link from support." }, 410);
      }
      const sessionToken = randomToken();
      const now = new Date().toISOString();
      const expires = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
      const { data: claimed, error: claimError } = await db.from("guest_audit_access")
        .update({
          report_token_hash: null,
          report_token_expires_at: null,
          report_token_used_at: now,
          session_token_hash: await hash(sessionToken),
          session_expires_at: expires,
          last_access_at: now,
        })
        .eq("id", access.id).eq("report_token_hash", reportHash).is("report_token_used_at", null)
        .is("revoked_at", null).select("id").maybeSingle();
      if (claimError || !claimed) return json(req, { ok: false, error: "This report link has already been exchanged. Open the report on the device where you first used it, or request a new link." }, 409);
      return json(req, { ok: true, session_token: sessionToken, expires_at: expires }, 200);
    }
    if (body.action !== "report") return json(req, { ok: false, error: "Unsupported action." }, 400);
    const sessionToken = String(body.session_token || "");
    if (!/^[0-9a-f]{64}$/i.test(sessionToken)) return json(req, { ok: false, error: "A valid report session is required." }, 401);
    const { data: access, error: accessError } = await db.from("guest_audit_access")
      .select("id,payment_order_id,email,session_expires_at,revoked_at")
      .eq("session_token_hash", await hash(sessionToken)).maybeSingle();
    if (accessError || !access || access.revoked_at || !access.session_expires_at ||
        new Date(access.session_expires_at).getTime() <= Date.now()) {
      return json(req, { ok: false, error: "Your private report session has expired or been revoked. Request a new report link." }, 401);
    }
    await db.from("guest_audit_access").update({ last_access_at: new Date().toISOString() }).eq("id", access.id);
    const { data: order, error: orderError } = await db.from("audit_payment_orders")
      .select("id,user_id,status,audit_id,repo_url,audit_type,price_usd,created_at,confirmed_at")
      .eq("id", access.payment_order_id).is("user_id", null).eq("status", "confirmed").maybeSingle();
    if (orderError || !order) return json(req, { ok: false, error: "The paid audit order could not be found." }, 404);
    const internalHeaders = { "Authorization": "Bearer " + service, "apikey": Deno.env.get("SUPABASE_ANON_KEY") || service, "Content-Type": "application/json" };
    if (!order.audit_id) {
      await fetch(url + "/functions/v1/w3m-code-audit", { method: "POST", headers: internalHeaders, body: JSON.stringify({ repo_url: order.repo_url, audit_type: order.audit_type, payment_order_id: order.id }) });
      const { data: refreshed } = await db.from("audit_payment_orders").select("id,user_id,status,audit_id,repo_url,audit_type,price_usd,created_at,confirmed_at").eq("id", access.payment_order_id).is("user_id", null).eq("status", "confirmed").maybeSingle();
      if (refreshed) Object.assign(order, refreshed);
    }
    if (!order.audit_id) return json(req, { ok: true, pending: true, email: access.email }, 202);
    const { data: auditState } = await db.from("code_audits").select("status").eq("id", order.audit_id).maybeSingle();
    if (auditState && ["paused", "queued"].includes(String(auditState.status))) {
      await fetch(url + "/functions/v1/w3m-code-audit", { method: "POST", headers: internalHeaders, body: JSON.stringify({ audit_id: order.audit_id }) });
    }
    const { data: audit, error: auditError } = await db.from("code_audits")
      .select("id,status,repo_url,repo_owner,repo_name,commit_sha,engine_version,audit_type,overall_score,risk_level,summary,files_scanned,lines_scanned,coverage_score,security_score,architecture_score,code_quality_score,dependency_score,testing_score,documentation_score,web3_score,scalability_score,ai_fit_score,analysis_progress,current_chunk,total_chunks,error_message,created_at,completed_at")
      .eq("id", order.audit_id).eq("payment_order_id", order.id).maybeSingle();
    if (auditError || !audit) return json(req, { ok: false, error: "The audit report is not available." }, 404);
    const [findings, files] = await Promise.all([
      db.from("code_audit_findings").select("severity,category,title,status,file_path,line_start,line_end,evidence,description,recommendation,confidence").eq("audit_id", audit.id).order("created_at", { ascending: true }),
      db.from("code_audit_files").select("path,language,line_count,selected_tier").eq("audit_id", audit.id).order("path"),
    ]);
    if (findings.error || files.error) return json(req, { ok: false, error: "Unable to load report details." }, 503);
    return json(req, { ok: true, pending: audit.status !== "completed", email: access.email, order, audit, findings: findings.data || [], files: files.data || [] });
  } catch (error) {
    console.error("guest-audit-access", String(error instanceof Error ? error.message : error));
    return json(req, { ok: false, error: "Unable to access this private report." }, 500);
  }
});
