/* Web3Market role guard — protects Buyer/Seller pages using the server-backed profile role. */
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

    const { data: userData, error: userError } = await sb.auth.getUser();
    if (userError || !userData?.user) { location.replace("login.html"); return; }

    const user = userData.user;
    // Never authorize from user_metadata: it is user-editable.
    const { data: profile, error: profileError } = await sb.from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile?.role) {
      location.replace("index.html");
      return;
    }

    const role = String(profile.role).toLowerCase();
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
