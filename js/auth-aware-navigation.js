/* Web3Market auth-aware header navigation.
 * Waits for the shared Supabase client before checking the current session.
 */
(function () {
  "use strict";
  var ACCOUNT_PATHS = { buyer: "buyer-dashboard.html", seller: "seller-dashboard.html", admin: "admin-review.html" };
  var DEFAULT_LABEL = "Sign in";
  var ACCOUNT_LABEL = "My Account";
  var refreshTimer = null;

  function getHeaderLinks() {
    return Array.prototype.slice.call(document.querySelectorAll(
      'header a[href="login.html"], header a[href="./login.html"], header a[href$="/login.html"], header a[data-w3m-original-label]'
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
  async function updateNavigation() {
    var client = getClient();
    if (!client || !client.auth) return false;
    try {
      var result = await client.auth.getSession();
      var session = result && result.data && result.data.session;
      var user = session && session.user;
      if (!user) { showSignedOut(); return true; }
      var profileResult = await client.from("profiles").select("role").eq("id", user.id).maybeSingle();
      if (profileResult.error) {
        console.warn("Web3Market header profile lookup failed:", profileResult.error.message || profileResult.error);
        return false;
      }
      if (!profileResult.data) { showSignedOut(); return true; }
      showSignedIn(profileResult.data.role);
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
    console.warn("Web3Market header navigation: Supabase client/session not ready yet.");
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
      } else if (attempts >= 80) {
        window.clearInterval(listenerTimer);
      }
    }, 150);
    window.addEventListener("focus", scheduleUpdate);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) scheduleUpdate();
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
