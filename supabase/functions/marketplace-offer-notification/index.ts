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

    const body = await req.json().catch(() => ({}));
    const dealId = String(body.deal_id || "");
    if (!dealId) return json({ error: "deal_id is required" }, 400);

    const admin = createClient(url, service);
    const { data: deal, error } = await admin.from("deals")
      .select("id,project_id,buyer_id,seller_id,amount,currency,status")
      .eq("id", dealId).maybeSingle();
    if (error) return json({ error: "Could not verify offer." }, 500);
    if (!deal) return json({ error: "Offer not found." }, 404);
    if (String(deal.buyer_id) !== String(user.id)) return json({ error: "Only the offer's buyer may trigger this event." }, 403);
    if (String(deal.status).toLowerCase() !== "pending") return json({ error: "Offer is not pending." }, 409);

    const result = await notifyOfferEvent(admin, deal, "offer_created");
    return json(result);
  } catch (error) {
    console.error("marketplace-offer-notification error", error);
    return json({ error: "Notification service failed." }, 500);
  }
});
