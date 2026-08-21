/* Web3Market role guard — protects Buyer/Seller pages client-side. */
"use strict";

(function () {
  const path = location.pathname.toLowerCase();
  const requiredRole = path.endsWith("/buyer-dashboard.html") ? "buyer"
    : path.endsWith("/seller-dashboard.html") ? "seller" : null;
  if (!requiredRole) return;

  function client() {
    return window.Web3MarketSupabase?.getClient?.()
      || window.Web3MarketSupabase?.client
      || window.supabaseClient
      || null;
  }

  async function guard() {
    const sb = client();
    if (!sb?.auth) { location.replace("login.html"); return; }

    const { data: sessionData } = await sb.auth.getSession();
    const session = sessionData?.session;
    if (!session?.user) { location.replace("login.html"); return; }

    const user = session.user;
    let role = String(user.user_metadata?.role || "").toLowerCase();

    if (!role) {
      const { data: profile } = await sb.from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      role = String(profile?.role || "").toLowerCase();
    }

    if (role !== requiredRole) {
      location.replace(role === "buyer" ? "buyer-dashboard.html"
        : role === "seller" ? "seller-dashboard.html" : "index.html");
      return;
    }

    document.documentElement.dataset.web3marketRole = role;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", guard, { once: true });
  } else {
    guard();
  }
})();
