import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyOfferEvent } from "../_shared/offer-notifications.ts";

const cors = {
  "Access-Control-Allow-Origin": "https://web3market.xyz",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin"
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !service) return json({ error: "Notification service is not configured." }, 503);

    const userDb = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: authError } = await userDb.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    // Never trust role data from client metadata for this privileged operation.
    const { data: profile, error: profileError } = await userDb.from("profiles")
      .select("role").eq("id", user.id).maybeSingle();
    if (profileError) return json({ error: "Could not verify administrator permissions." }, 500);
    if (String(profile?.role || "").toLowerCase() !== "admin") return json({ error: "Administrator access required." }, 403);

    const body = await req.json().catch(() => ({}));
    const eventKey = String(body.event_key || "").trim();
    if (!eventKey || eventKey.length > 200) return json({ error: "A valid event_key is required." }, 400);

    const admin = createClient(url, service);
    const { data: event, error: eventError } = await admin.from("marketplace_notification_events")
      .select("event_key,deal_id,event_type,delivery_status")
      .eq("event_key", eventKey).maybeSingle();
    if (eventError) return json({ error: "Could not look up notification event." }, 500);
    if (!event) return json({ error: "Notification event not found." }, 404);
    if (event.delivery_status === "sent") return json({ ok: true, duplicate: true, email_status: "sent" });
    if (event.delivery_status === "sending") return json({ ok: true, duplicate: true, email_status: "sending" });
    if (event.delivery_status !== "failed") return json({ error: "Only failed notification events can be retried." }, 409);

    const { data: deal, error: dealError } = await admin.from("deals")
      .select("id,project_id,buyer_id,seller_id,amount,currency,status")
      .eq("id", event.deal_id).maybeSingle();
    if (dealError) return json({ error: "Could not verify the related deal." }, 500);
    if (!deal) return json({ error: "Related deal not found." }, 404);

    const expectedStatus = event.event_type === "offer_created" ? "pending"
      : event.event_type === "offer_accepted" ? "accepted" : "";
    if (!expectedStatus || String(deal.status).toLowerCase() !== expectedStatus) {
      return json({ error: "The deal state no longer matches this notification event; no retry was sent." }, 409);
    }

    const result = await notifyOfferEvent(admin, deal, event.event_type);
    return json({ ok: true, result });
  } catch (error) {
    console.error("marketplace-notification-retry error", error);
    return json({ error: "Notification retry failed." }, 500);
  }
});
