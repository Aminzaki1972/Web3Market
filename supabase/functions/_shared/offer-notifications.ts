import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type Deal = {
  id: string; project_id: string; buyer_id: string; seller_id: string;
  amount: number | string; currency?: string | null; status: string;
};
type EventType = "offer_created" | "offer_accepted";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({
  "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
}[c] || c));

export async function notifyOfferEvent(db: SupabaseClient, deal: Deal, eventType: EventType) {
  const expectedStatus = eventType === "offer_created" ? "pending" : "accepted";
  if (String(deal.status).toLowerCase() !== expectedStatus) {
    throw new Error("Offer state does not match notification event.");
  }
  const recipientId = eventType === "offer_created" ? deal.seller_id : deal.buyer_id;
  const senderId = eventType === "offer_created" ? deal.buyer_id : deal.seller_id;
  const eventKey = `${eventType}:${deal.id}`;

  const { data: project, error: projectError } = await db.from("projects")
    .select("id,title").eq("id", deal.project_id).maybeSingle();
  if (projectError || !project) throw new Error("Project details unavailable.");

  const { data: recipient, error: recipientError } = await db.from("profiles")
    .select("id,email,display_name").eq("id", recipientId).maybeSingle();
  if (recipientError || !recipient) throw new Error("Notification recipient unavailable.");

  const { data: sender } = await db.from("profiles")
    .select("display_name").eq("id", senderId).maybeSingle();

  const amount = Number(deal.amount || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const currency = String(deal.currency || "USD");
  const projectTitle = String(project.title || "your project");
  const title = eventType === "offer_created" ? "New offer received" : "Your offer was accepted";
  const message = eventType === "offer_created"
    ? `${sender?.display_name || "A buyer"} submitted an offer of ${amount} ${currency} for ${projectTitle}.`
    : `The seller accepted your offer of ${amount} ${currency} for ${projectTitle}.`;

  const { data: prior } = await db.from("marketplace_notification_events")
    .select("event_key,delivery_status").eq("event_key", eventKey).maybeSingle();
  let isNew = false;
  if (!prior) {
    const { error: reserveError } = await db.from("marketplace_notification_events").insert({
      event_key: eventKey, deal_id: deal.id, event_type: eventType,
      recipient_user_id: recipientId, recipient_email: recipient.email || null,
      delivery_status: "sending"
    });
    if (!reserveError) isNew = true;
    else {
      const { data: raced } = await db.from("marketplace_notification_events")
        .select("event_key,delivery_status").eq("event_key", eventKey).maybeSingle();
      if (!raced) throw reserveError;
      if (raced.delivery_status === "sent" || raced.delivery_status === "sending") {
        return { ok: true, duplicate: true, email_status: raced.delivery_status };
      }
      const { error: retryError } = await db.from("marketplace_notification_events")
        .update({ delivery_status: "sending", error_message: null, updated_at: new Date().toISOString() })
        .eq("event_key", eventKey).eq("delivery_status", "failed");
      if (retryError) throw retryError;
    }
  } else {
    if (prior.delivery_status === "sent" || prior.delivery_status === "sending") {
      return { ok: true, duplicate: true, email_status: prior.delivery_status };
    }
    const { error: retryError } = await db.from("marketplace_notification_events")
      .update({ delivery_status: "sending", error_message: null, updated_at: new Date().toISOString() })
      .eq("event_key", eventKey).eq("delivery_status", "failed");
    if (retryError) throw retryError;
  }

  const { data: existingNotification, error: notificationLookupError } = await db.from("marketplace_notifications")
    .select("id").eq("user_id", recipientId).eq("type", eventType)
    .contains("data", { deal_id: deal.id, event_type: eventType }).limit(1).maybeSingle();
  if (notificationLookupError) throw new Error("Could not verify existing in-app notification.");
  if (!existingNotification) {
    const { error: notificationError } = await db.from("marketplace_notifications").insert({
      user_id: recipientId, project_id: deal.project_id, type: eventType,
      title, message, data: { deal_id: deal.id, project_id: deal.project_id, event_type: eventType }
    });
    if (notificationError) {
      await db.from("marketplace_notification_events").update({
        delivery_status: "failed", error_message: "Could not create in-app notification",
        updated_at: new Date().toISOString()
      }).eq("event_key", eventKey);
      throw new Error("Could not create in-app notification.");
    }
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL");
  try {
    if (!recipient.email) throw new Error("Recipient email is missing.");
    if (!resendKey || !fromEmail) throw new Error("Email provider is not configured.");
    const subject = eventType === "offer_created"
      ? `New offer on Web3Market: ${projectTitle}`
      : `Your offer was accepted: ${projectTitle}`;
    const detail = eventType === "offer_created"
      ? "A buyer has submitted a new offer for your listing."
      : "The seller accepted your offer. Open your Deal Room to review the next steps.";
    const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6"><div style="max-width:600px;margin:auto;padding:28px"><h1 style="color:#2563eb">Web3Market</h1><h2>${esc(title)}</h2><p>${esc(detail)}</p><div style="padding:18px;border:1px solid #e2e8f0;border-radius:12px"><strong>Project:</strong> ${esc(projectTitle)}<br><strong>Offer:</strong> ${esc(amount)} ${esc(currency)}<br><strong>From:</strong> ${esc(sender?.display_name || (eventType === "offer_created" ? "Buyer" : "Seller"))}</div><p><a href="https://web3market.xyz/deal-room.html?deal=${encodeURIComponent(deal.id)}" style="display:inline-block;padding:12px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px">Open Deal Room</a></p><p style="font-size:12px;color:#64748b">This automated email relates to an offer on Web3Market. Never share passwords or wallet recovery phrases.</p></div></body></html>`;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": eventKey },
      body: JSON.stringify({ from: fromEmail, to: [recipient.email], subject, html })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(result?.message || result?.error || `Resend HTTP ${response.status}`));
    const { error: updateError } = await db.from("marketplace_notification_events").update({
      delivery_status: "sent", error_message: null, updated_at: new Date().toISOString()
    }).eq("event_key", eventKey);
    if (updateError) throw updateError;
    return { ok: true, duplicate: false, email_status: "sent" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.from("marketplace_notification_events").update({
      delivery_status: "failed", error_message: message.slice(0, 500), updated_at: new Date().toISOString()
    }).eq("event_key", eventKey);
    console.error("Offer notification email failed", message);
    return { ok: true, notification_created: isNew, email_status: "failed" };
  }
}
