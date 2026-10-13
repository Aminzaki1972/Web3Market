/* Web3Market auth-aware header navigation.
 * Uses the shared Supabase client and changes only header sign-in links.
 * If session/profile cannot be verified, it safely leaves the sign-in link in place.
 */
(function () {
  "use strict";

  var ACCOUNT_PATHS = {
    buyer: "buyer-dashboard.html",
    seller: "seller-dashboard.html",
    admin: "admin-review.html"
  };
  var DEFAULT_LABEL = "Sign in";
  var ACCOUNT_LABEL = "My Account";
  var refreshTimer = null;

  function getHeaderLinks() {
    return Array.prototype.slice.call(
      document.querySelectorAll('header a[href="login.html"], header a[href="./login.html"], header a[data-w3m-original-label]')
    );
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
    var target = ACCOUNT_PATHS[String(role || "").toLowerCase()];
    if (!target) {
      showSignedOut();
      return;
    }
    getHeaderLinks().forEach(function (link) {
      link.textContent = ACCOUNT_LABEL;
      link.href = target;
      link.setAttribute("aria-label", ACCOUNT_LABEL + " — " + String(role).toLowerCase());
      link.setAttribute("data-w3m-account-role", String(role).toLowerCase());
    });
  }

  async function updateNavigation() {
    var api = window.Web3MarketSupabase;
    var client = api && typeof api.getClient === "function" ? api.getClient() :
      (api && api.client) || window.supabaseClient || window.web3marketSupabase;

    if (!client || !client.auth) return;
    try {
      var result = await client.auth.getSession();
      var session = result && result.data && result.data.session;
      var user = session && session.user;
      if (!user) {
        showSignedOut();
        return;
      }

      var profileResult = await client
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      if (profileResult.error || !profileResult.data) {
        // Do not guess a role or expose a dashboard link when verification fails.
        showSignedOut();
        return;
      }
      showSignedIn(profileResult.data.role);
    } catch (error) {
      // A temporary network/auth error must not break the rest of the page.
      console.warn("Web3Market header auth check unavailable:", error);
    }
  }

  function start() {
    getHeaderLinks().forEach(function (link) {
      if (!link.hasAttribute("data-w3m-original-label")) {
        link.setAttribute("data-w3m-original-label", (link.textContent || DEFAULT_LABEL).trim());
      }
    });
    updateNavigation();

    // The shared client is loaded before this script on the supported pages.
    var api = window.Web3MarketSupabase;
    var client = api && typeof api.getClient === "function" ? api.getClient() :
      (api && api.client) || window.supabaseClient || window.web3marketSupabase;

    if (client && client.auth && typeof client.auth.onAuthStateChange === "function") {
      client.auth.onAuthStateChange(function () {
        // Defer profile lookup to avoid doing Supabase queries inside the auth callback.
        if (refreshTimer) window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(updateNavigation, 0);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
