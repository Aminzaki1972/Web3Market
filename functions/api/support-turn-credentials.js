const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

// These are the same public Supabase project settings used by js/supabase.js.
// The publishable key is intended for browser use; authorization and RLS still
// enforce access. Allow the preview endpoint to authenticate without copying
// these public settings into Cloudflare environment variables.
const DEFAULT_SUPABASE_URL = "https://hzhqlexnhtukfljcvnyd.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI";

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function readAal(accessToken) {
  try {
    const part = accessToken.split(".")[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64)).aal || null;
  } catch {
    return null;
  }
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");
  const requestOrigin = new URL(request.url).origin;
  if (!origin || origin !== requestOrigin) return reply({ error: "Request origin is not allowed." }, 403);

  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\\s+(.+)$/i);
  if (!match) return reply({ error: "Please sign in again before starting a call." }, 401);

  const supabaseUrl = env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const supabaseKey = env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY;
  const turnKeyId = env.CLOUDFLARE_TURN_KEY_ID;
  const turnKeyToken = env.CLOUDFLARE_TURN_API_TOKEN;
  if (!supabaseUrl || !supabaseKey) return reply({ error: "Preview authentication settings are missing." }, 503);
  if (!turnKeyId || !turnKeyToken) {
    return reply({ error: "TURN relay is not configured for this preview yet. Configure the Cloudflare TURN key secrets in the Pages Preview environment." }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return reply({ error: "Invalid request body." }, 400); }
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)) {
    return reply({ error: "Select a valid support conversation before calling." }, 400);
  }

  const token = match[1];
  const authHeaders = { "apikey": supabaseKey, "Authorization": "Bearer " + token };
  let userResponse;
  try {
    userResponse = await fetch(supabaseUrl.replace(/\\/$/, "") + "/auth/v1/user", { headers: authHeaders });
  } catch {
    return reply({ error: "Could not verify your Web3Market session. Try again." }, 502);
  }
  if (!userResponse.ok) return reply({ error: "Your session is invalid or expired. Sign in again." }, 401);
  const user = await userResponse.json();
  if (!user?.id) return reply({ error: "Could not verify your Web3Market account." }, 401);

  const profileUrl = supabaseUrl.replace(/\\/$/, "") + "/rest/v1/profiles?id=eq." +
    encodeURIComponent(user.id) + "&select=id,role";
  const profileResponse = await fetch(profileUrl, { headers: { ...authHeaders, "Accept": "application/json" } });
  if (!profileResponse.ok) return reply({ error: "Could not verify support-call permissions." }, 403);
  const profiles = await profileResponse.json();
  const role = String(profiles?.[0]?.role || "").toLowerCase();
  const isAdmin = role === "admin";
  if (isAdmin && readAal(token) !== "aal2") {
    return reply({ error: "Administrator two-factor verification is required before calling." }, 403);
  }
  if (!isAdmin && !["buyer", "seller"].includes(role)) {
    return reply({ error: "This account is not authorized to use support calls." }, 403);
  }

  const conversationUrl = supabaseUrl.replace(/\\/$/, "") + "/rest/v1/support_conversations?id=eq." +
    encodeURIComponent(conversationId) + "&select=id,user_id,status";
  const conversationResponse = await fetch(conversationUrl, { headers: { ...authHeaders, "Accept": "application/json" } });
  if (!conversationResponse.ok) return reply({ error: "Could not verify access to this support conversation." }, 403);
  const conversations = await conversationResponse.json();
  const conversation = conversations?.[0];
  if (!conversation) return reply({ error: "This support conversation is unavailable to your account." }, 403);
  if (String(conversation.status || "").toLowerCase() === "closed") {
    return reply({ error: "Reopen this support conversation before calling." }, 403);
  }
  if (!isAdmin && conversation.user_id !== user.id) {
    return reply({ error: "You can only call from your own support conversation." }, 403);
  }

  let turnResponse;
  try {
    turnResponse = await fetch(
      "https://rtc.live.cloudflare.com/v1/turn/keys/" + encodeURIComponent(turnKeyId) + "/credentials/generate-ice-servers",
      {
        method: "POST",
        headers: { "Authorization": "Bearer " + turnKeyToken, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: 3600 })
      }
    );
  } catch {
    return reply({ error: "Cloudflare TURN service could not be reached. Try again shortly." }, 502);
  }
  if (!turnResponse.ok) {
    return reply({ error: "Cloudflare TURN credential generation failed. Check the preview TURN key ID and token." }, 502);
  }
  const turnData = await turnResponse.json();
  const iceServers = Array.isArray(turnData?.iceServers) ? turnData.iceServers : [];
  if (!iceServers.length) return reply({ error: "Cloudflare TURN returned no ICE servers." }, 502);

  return reply({ iceServers });
}
