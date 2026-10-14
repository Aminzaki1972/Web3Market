/* Web3Market auth-aware header navigation.
 * Restores the shared Supabase session before resolving the account role.
 */
(function () {
  "use strict";
  var ACCOUNT_PATHS = { buyer: "buyer-dashboard.html", seller: "seller-dashboard.html", admin: "admin-review.html" };
  var DEFAULT_LABEL = "Sign in";
  var ACCOUNT_LABEL = "My Account";
  var refreshTimer = null;

  function getHeaderLinks() {
    return Array.prototype.slice.call(document.querySelectorAll(
      'header a[href="login.html"], header a[href="./login.html"], header a[href$="/login.html"], #w3mHeaderDrawer a[href="login.html"], #w3mHeaderDrawer a[href="./login.html"], #w3mHeaderDrawer a[href$="/login.html"], header a[data-w3m-original-label], #w3mHeaderDrawer a[data-w3m-original-label]'
    ));
  }
  function getClient() {
    var api = window.Web3MarketSupabase;
    return api && typeof api.getClient === "function" ? api.getClient() :
      (api && api.client) || window.supabaseClient || window.web3marketSupabase || null;
  }
  function showSignedOut() {
    getHeaderLinks().forEach(function (link) {
      link.textContent = link.getAttribute("data-w3m-original-label") || DEFAULT_LABEL;
      link.href = "login.html";
      link.removeAttribute("aria-label");
      link.removeAttribute("data-w3m-account-role");
    });
  }
  function showSignedIn(role) {
    role = String(role || "").trim().toLowerCase();
    var target = ACCOUNT_PATHS[role];
    if (!target) { showSignedOut(); return; }
    getHeaderLinks().forEach(function (link) {
      link.textContent = ACCOUNT_LABEL;
      link.href = target;
      link.setAttribute("aria-label", ACCOUNT_LABEL + " — " + role);
      link.setAttribute("data-w3m-account-role", role);
    });
  }
  async function readRole(client, user) {
    try {
      var result = await client.from("profiles").select("role").eq("id", user.id).maybeSingle();
      if (!result.error && result.data && result.data.role) return String(result.data.role).toLowerCase();
      if (result.error) console.warn("Web3Market profile role query failed:", result.error.message || result.error);
    } catch (e) { console.warn("Web3Market profile role query exception:", e); }

    // Fallback to the same authenticated REST endpoint if the SDK query fails.
    try {
      var sessionResult = await client.auth.getSession();
      var session = sessionResult && sessionResult.data && sessionResult.data.session;
      if (session && session.access_token) {
        var url = "https://hzhqlexnhtukfljcvnyd.supabase.co/rest/v1/profiles?select=role&id=eq." +
          encodeURIComponent(user.id) + "&limit=1";
        var response = await fetch(url, { headers: {
          "apikey": "sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI",
          "Authorization": "Bearer " + session.access_token,
          "Accept": "application/json"
        }, cache: "no-store" });
        if (response.ok) {
          var rows = await response.json();
          if (rows && rows[0] && rows[0].role) return String(rows[0].role).toLowerCase();
        } else {
          console.warn("Web3Market profile REST fallback failed:", response.status);
        }
      }
    } catch (e) { console.warn("Web3Market profile REST fallback exception:", e); }
    return "";
  }
  async function updateNavigation() {
    var client = getClient();
    if (!client || !client.auth) return false;
    try {
      var result = await client.auth.getSession();
      var session = result && result.data && result.data.session;

      // The shared client exposes this recovery helper for sessions that are
      // present in localStorage but have not yet been hydrated into the SDK.
      if (!session && typeof window.Web3MarketSupabaseRestoreSession === "function") {
        try {
          session = await window.Web3MarketSupabaseRestoreSession();
        } catch (restoreError) {
          console.warn("Web3Market session restore helper failed:", restoreError);
        }
      }
      if (!session) {
        var retry = await client.auth.getSession();
        session = retry && retry.data && retry.data.session;
      }

      var user = session && session.user;
      if (!user) { showSignedOut(); return true; }
      var role = await readRole(client, user);
      if (!role) return false;
      showSignedIn(role);
      return true;
    } catch (error) {
      console.warn("Web3Market header auth check unavailable:", error);
      return false;
    }
  }
  async function waitForClientAndUpdate() {
    for (var i = 0; i < 80; i++) {
      if (getClient()) {
        var done = await updateNavigation();
        if (done) return;
      }
      await new Promise(function (resolve) { window.setTimeout(resolve, 150); });
    }
    console.warn("Web3Market header navigation could not verify the current session.");
  }
  function scheduleUpdate() {
    if (refreshTimer) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(waitForClientAndUpdate, 50);
  }
  function start() {
    getHeaderLinks().forEach(function (link) {
      if (!link.hasAttribute("data-w3m-original-label")) {
        link.setAttribute("data-w3m-original-label", (link.textContent || DEFAULT_LABEL).trim());
      }
    });
    waitForClientAndUpdate();
    var attempts = 0;
    var listenerTimer = window.setInterval(function () {
      attempts++;
      var client = getClient();
      if (client && client.auth && typeof client.auth.onAuthStateChange === "function") {
        window.clearInterval(listenerTimer);
        client.auth.onAuthStateChange(function () { scheduleUpdate(); });
      } else if (attempts >= 80) window.clearInterval(listenerTimer);
    }, 150);
    window.addEventListener("focus", scheduleUpdate);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) scheduleUpdate();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
