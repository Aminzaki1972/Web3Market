import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const RECIPIENT = "amin.zaki19722@gmail.com";
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://web3market.xyz",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const body = await req.json().catch(() => null);
    const projectId = String(body?.project_id ?? "");
    const eventType = String(body?.event_type ?? "");
    if (!projectId || !["created", "submitted"].includes(eventType)) {
      return json({ error: "project_id and a valid event_type are required" }, 400);
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL");
    if (!supabaseUrl || !anonKey || !serviceKey) throw new Error("Supabase environment configuration is missing");
    if (!resendKey || !fromEmail) return json({ error: "Email provider is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL in Supabase Edge Function secrets." }, 503);

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData?.user) return json({ error: "Unauthorized" }, 401);
    const db = createClient(supabaseUrl, serviceKey);
    const { data: project, error: projectError } = await db.from("projects")
      .select("id,title,owner_id,ai_status,project_status,status,asking_price,price,created_at")
      .eq("id", projectId).maybeSingle();
    if (projectError || !project) return json({ error: "Project not found" }, 404);
    if (project.owner_id !== authData.user.id) return json({ error: "Forbidden" }, 403);
    if (eventType === "submitted" && !project.ai_status) {
      return json({ error: "AI Review has not completed for this listing" }, 409);
    }

    const eventKey = projectId + ":" + eventType;
    const { data: inserted, error: insertError } = await db.from("admin_project_email_events")
      .insert({ project_id: projectId, event_type: eventType, event_key: eventKey, recipient: RECIPIENT, delivery_status: "sending" })
      .select("id,delivery_status").maybeSingle();
    let event = inserted;
    if (insertError) {
      if (insertError.code !== "23505") throw insertError;
      const { data: existing, error: existingError } = await db.from("admin_project_email_events")
        .select("id,delivery_status,attempt_count").eq("event_key", eventKey).maybeSingle();
      if (existingError || !existing) throw existingError || new Error("Could not read notification deduplication record");
      if (existing.delivery_status === "sent" || existing.delivery_status === "sending") {
        return json({ success: true, duplicate: true, delivery_status: existing.delivery_status });
      }
      const { data: retry, error: retryError } = await db.from("admin_project_email_events")
        .update({ delivery_status: "sending", error_message: null, attempt_count: Number(existing.attempt_count || 1) + 1 })
        .eq("id", existing.id).eq("delivery_status", "failed").select("id,delivery_status").maybeSingle();
      if (retryError) throw retryError;
      if (!retry) return json({ success: true, duplicate: true, delivery_status: "sending" });
      event = retry;
    }
    if (!event) return json({ error: "Could not reserve notification event" }, 500);

    const projectTitle = String(project.title || "Untitled project");
    const subject = eventType === "created"
      ? "Web3Market: New project draft created"
      : "Web3Market: Project submitted for AI Review";
    const statusLabel = eventType === "created" ? "New project draft created" : "Submitted for AI Review";
    const projectLink = "https://web3market.xyz/admin-review.html";
    const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033">
      <h2>${escapeHtml(statusLabel)}</h2>
      <p>A project listing event occurred on Web3Market.</p>
      <p><strong>Project:</strong> ${escapeHtml(projectTitle)}</p>
      <p><strong>Project ID:</strong> ${escapeHtml(project.id)}</p>
      <p><strong>Event:</strong> ${escapeHtml(eventType)}</p>
      <p><strong>Current review status:</strong> ${escapeHtml(project.ai_status || "Not reviewed yet")}</p>
      <p><strong>Asking price:</strong> ${escapeHtml(project.asking_price ?? project.price ?? "Not provided")}</p>
      <p><a href="${projectLink}">Open Web3Market Admin Review</a></p>
      <p style="color:#64748b;font-size:12px">This is an automated administrative notification. The listing is not published automatically by this email.</p>
    </div>`;
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromEmail, to: [RECIPIENT], subject, html }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(result?.message || result?.error || `Resend HTTP ${response.status}`));
      const { error: updateError } = await db.from("admin_project_email_events")
        .update({ delivery_status: "sent", provider_message_id: result?.id ?? null, sent_at: new Date().toISOString(), error_message: null })
        .eq("id", event.id);
      if (updateError) throw updateError;
      return json({ success: true, duplicate: false, delivery_status: "sent" });
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error).slice(0, 1000);
      await db.from("admin_project_email_events").update({ delivery_status: "failed", error_message: message }).eq("id", event.id);
      console.error("Admin project email failed", message);
      return json({ error: "Email could not be sent. The listing workflow is unaffected; retry after checking email configuration." }, 502);
    }
  } catch (error) {
    console.error("admin-project-email-notification error", error);
    return json({ error: "Notification service failed" }, 500);
  }
});
