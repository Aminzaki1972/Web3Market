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
      || window.web3marketSupabase
      || null;
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function guard() {
    let sb = null;
    for (let i = 0; i < 40; i++) {
      sb = client();
      if (sb?.auth) break;
      await sleep(100);
    }
    if (!sb?.auth) {
      location.replace("login.html");
      return;
    }

    let user = null;
    for (let i = 0; i < 5 && !user; i++) {
      const { data, error } = await sb.auth.getUser();
      if (!error && data?.user) user = data.user;
      else await sleep(250);
    }
    if (!user) {
      location.replace("login.html");
      return;
    }

    let profile = null;
    let lastError = null;
    for (let i = 0; i < 5 && !profile; i++) {
      const { data, error } = await sb.from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (!error && data?.role) profile = data;
      else {
        lastError = error;
        await sleep(250);
      }
    }

    if (!profile?.role) {
      console.error("Web3Market role guard: profile unavailable", lastError);
      location.replace("index.html");
      return;
    }

    const role = String(profile.role).trim().toLowerCase();
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
