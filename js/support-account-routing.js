/* Web3Market support-card account routing. */
(function () {
  "use strict";
  var targets = { buyer: "buyer-dashboard.html", seller: "seller-dashboard.html", admin: "admin-review.html" };
  function getClient() {
    var api = window.Web3MarketSupabase;
    return api && typeof api.getClient === "function" ? api.getClient() :
      (api && api.client) || window.supabaseClient || window.web3marketSupabase || null;
  }
  async function resolveDestination() {
    var client = getClient();
    if (!client || !client.auth) return "register.html";
    var result = await client.auth.getSession();
    var session = result && result.data && result.data.session;
    if (!session && typeof window.Web3MarketSupabaseRestoreSession === "function") {
      try { session = await window.Web3MarketSupabaseRestoreSession(); } catch (_) {}
    }
    if (!session || !session.user) return "register.html";
    try {
      var profile = await client.from("profiles").select("role").eq("id", session.user.id).maybeSingle();
      var role = profile && profile.data && String(profile.data.role || "").trim().toLowerCase();
      if (role && targets[role]) return targets[role];
    } catch (_) {}
    return "verification.html";
  }
  document.addEventListener("click", function (event) {
    var link = event.target && event.target.closest ? event.target.closest("[data-support-account-gate]") : null;
    if (!link) return;
    event.preventDefault();
    if (link.dataset.routing === "1") return;
    link.dataset.routing = "1";
    link.setAttribute("aria-busy", "true");
    resolveDestination().then(function (destination) {
      window.location.href = destination;
    }).catch(function () {
      window.location.href = "register.html";
    });
  });
})();