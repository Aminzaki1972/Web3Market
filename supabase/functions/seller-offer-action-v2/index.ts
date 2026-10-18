import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyOfferEvent } from "../_shared/offer-notifications.ts";

const cors = {
  "Access-Control-Allow-Origin": "https://web3market.xyz",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin"
};
const res = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (req.method !== "POST") return res({ error: "Method not allowed" }, 405);
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return res({ error: "Unauthorized" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userDb = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: authError } = await userDb.auth.getUser();
    if (authError || !user) return res({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const id = String(body.deal_id || "");
    const action = String(body.action || "");
    if (!id || !["accept", "reject"].includes(action)) return res({ error: "Invalid request" }, 400);
    const admin = createClient(url, service);
    const { data: deal, error: readError } = await admin.from("deals")
      .select("id,seller_id,buyer_id,project_id,amount,currency,status,chain_id,safe_address,token_contract,token_symbol")
      .eq("id", id).maybeSingle();
    if (readError) return res({ error: readError.message }, 400);
    if (!deal) return res({ error: "Offer not found" }, 404);
    if (String(deal.seller_id) !== String(user.id)) return res({ error: "You are not the seller for this offer" }, 403);
    if (String(deal.status).toLowerCase() !== "pending") return res({ error: "This offer is no longer pending" }, 409);

    if (action === "reject") {
      const { data: updated, error: updateError } = await admin.from("deals")
        .update({ status: "rejected" }).eq("id", id).eq("seller_id", user.id).eq("status", "pending")
        .select("id,status,amount,currency,project_id,buyer_id,seller_id").single();
      if (updateError) return res({ error: updateError.message }, 400);
      return res({ ok: true, deal: updated });
    }

    const { data: configs, error: configError } = await admin.from("platform_payment_configs")
      .select("chain_id,token_contract,token_symbol").eq("chain_id", 56).eq("enabled", true);
    if (configError) return res({ error: configError.message }, 500);
    if (!configs || configs.length !== 1) return res({ error: "Platform payment configuration is not available or is ambiguous. The offer was not accepted." }, 503);
    const cfg = configs[0];
    if (!/^0x[a-fA-F0-9]{40}$/.test(String(cfg.token_contract))) return res({ error: "Platform token configuration is invalid. The offer was not accepted." }, 503);

    const { data: updated, error: updateError } = await admin.from("deals").update({
      status: "accepted",
      chain_id: 56,
      safe_address: null,
      safe_deployment_status: "not_started",
      safe_deployment_tx_hash: null,
      safe_deployer_wallet: null,
      safe_deployed_at: null,
      token_contract: String(cfg.token_contract),
      token_symbol: String(cfg.token_symbol || "USDT")
    }).eq("id", id).eq("seller_id", user.id).eq("status", "pending")
      .select("id,status,amount,currency,project_id,buyer_id,seller_id,chain_id,safe_address,safe_deployment_status,token_contract,token_symbol,expected_amount,platform_fee,seller_net_amount")
      .single();
    if (updateError) return res({ error: updateError.message }, 400);

    // Notifications and email must never undo an accepted offer or block the Safe/deal workflow.
    let notification = { email_status: "not_attempted" as string };
    try {
      notification = await notifyOfferEvent(admin, updated, "offer_accepted");
    } catch (notificationError) {
      console.error("Offer accepted, but notification delivery failed:", notificationError);
      notification = { email_status: "failed" };
    }

    return res({
      ok: true,
      deal: updated,
      notification,
      safe: { status: "pending", required: true, create_function: "create-safe" },
      payment_config: { chain_id: 56, token_contract: cfg.token_contract, token_symbol: cfg.token_symbol || "USDT" }
    });
  } catch (e) {
    return res({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
