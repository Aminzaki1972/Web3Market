import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyOfferEvent } from "../_shared/offer-notifications.ts";

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") return new Response(JSON.stringify({error:"Method not allowed"}), {status:405,headers:{"Content-Type":"application/json"}});
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) throw new Error("Unauthorized");
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const adminKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(url, anon, {global:{headers:{Authorization:auth}}});
    const {data:{user},error:ue}=await userClient.auth.getUser();
    if(ue||!user) throw new Error("Unauthorized");
    const body=await req.json();
    const dealId=String(body.deal_id||"");
    const action=String(body.action||"");
    if(!dealId || !["accept","reject"].includes(action)) throw new Error("Invalid request");
    const admin=createClient(url,adminKey);
    const {data:deal,error:de}=await admin.from("deals").select("id,seller_id,buyer_id,project_id,amount,currency,status").eq("id",dealId).maybeSingle();
    if(de) throw de;
    if(!deal) throw new Error("Offer not found");
    if(String(deal.seller_id)!==String(user.id)) throw new Error("You are not the seller for this offer");
    if(String(deal.status).toLowerCase()!=="pending") throw new Error("This offer is no longer pending");
    const next=action==="accept"?"accepted":"rejected";
    const {data:updated,error:up}=await admin.from("deals").update({status:next,updated_at:new Date().toISOString()}).eq("id",dealId).eq("seller_id",user.id).eq("status","pending").select("id,status,amount,currency,project_id,buyer_id,seller_id").single();
    if(up) throw up;
    let notification = { email_status: "not_attempted" as string };
    if (action === "accept") {
      try { notification = await notifyOfferEvent(admin, updated, "offer_accepted"); }
      catch (notificationError) {
        console.error("Offer accepted, but notification delivery failed:", notificationError);
        notification = { email_status: "failed" };
      }
    }
    return new Response(JSON.stringify({ok:true,deal:updated,notification}),{status:200,headers:{"Content-Type":"application/json"}});
  } catch(e) {
    return new Response(JSON.stringify({error:e instanceof Error?e.message:String(e)}),{status:400,headers:{"Content-Type":"application/json"}});
  }
});
