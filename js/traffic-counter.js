/* Web3Market — 24-hour public page visit counter */
(function () {
  "use strict";

  var STORAGE_KEY = "web3market-visitor-id-v1";
  var VISIT_KEY = "web3market-last-counted:" + (location.pathname || "/");
  var REFRESH_MS = 5 * 60 * 1000;
  var DEDUPE_MS = 30 * 60 * 1000;

  function normalizedPath() {
    var p = location.pathname || "/";
    if (p === "/index.html") return "/";
    return p.replace(/\/+$/, "") || "/";
  }

  function visitorId() {
    try {
      var id = localStorage.getItem(STORAGE_KEY);
      if (id && id.length >= 16) return id;
      id = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : "wm-" + Date.now() + "-" + Math.random().toString(36).slice(2);
      localStorage.setItem(STORAGE_KEY, id);
      return id;
    } catch (_) {
      return "wm-session-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    }
  }

  function shouldCountNow() {
    try {
      var last = Number(localStorage.getItem(VISIT_KEY) || 0);
      return !last || (Date.now() - last) >= DEDUPE_MS;
    } catch (_) {
      return true;
    }
  }

  function markCounted() {
    try { localStorage.setItem(VISIT_KEY, String(Date.now())); } catch (_) {}
  }

  function getClient() {
    return window.Web3MarketSupabase && window.Web3MarketSupabase.getClient
      ? window.Web3MarketSupabase.getClient()
      : null;
  }

  function renderShell() {
    if (document.getElementById("wm-24h-views")) return;
    var host = document.querySelector(".hero .proof");
    if (!host) return;

    var box = document.createElement("span");
    box.id = "wm-24h-views";
    box.setAttribute("aria-live", "polite");
    box.innerHTML = "👁 <strong>آخر 24 ساعة:</strong> <b data-wm-count>جارٍ التحميل…</b>";

    var style = document.createElement("style");
    style.textContent =
      "#wm-24h-views{display:inline-flex;align-items:center;gap:5px;padding:7px 11px;border:1px solid rgba(158,152,255,.35);border-radius:999px;background:rgba(9,13,37,.62);color:#dbe3f1;font-size:12px;font-weight:700;backdrop-filter:blur(8px)}" +
      "#wm-24h-views strong{color:#fff}#wm-24h-views b{color:#9fdcff}";
    document.head.appendChild(style);
    host.appendChild(box);
  }

  async function updateCount() {
    var client = getClient();
    var el = document.querySelector("#wm-24h-views [data-wm-count]");
    if (!client || !el) return;

    try {
      var result = await client.rpc("get_page_views_last_24h", { p_path: normalizedPath() });
      if (result.error) throw result.error;
      el.textContent = Number(result.data || 0).toLocaleString("en-US");
    } catch (err) {
      console.warn("Web3Market 24h counter unavailable:", err);
      el.textContent = "—";
    }
  }

  async function recordVisit() {
    var client = getClient();
    if (!client || !shouldCountNow()) return;

    try {
      var result = await client.rpc("record_page_view", {
        p_path: normalizedPath(),
        p_visitor_id: visitorId()
      });
      if (result.error) throw result.error;
      markCounted();
    } catch (err) {
      console.warn("Web3Market visit recording unavailable:", err);
    }
  }

  async function start() {
    renderShell();
    await recordVisit();
    await updateCount();
    window.setInterval(updateCount, REFRESH_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();