/* Web3Market Trust Badge UI — server decisions only. */
(function () {
  "use strict";
  const CACHE_TTL_MS = 30_000;
  const cache = new Map();
  const active = new Set();
  let refreshGeneration = 0;
  let lastRefreshAt = 0;

  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);

  function client() {
    return window.Web3MarketSupabase?.getClient?.() ||
      window.supabaseClient || window.web3marketSupabase || null;
  }

  async function decision(projectId) {
    const now = Date.now();
    const cached = cache.get(projectId);
    if (cached && cached.expiresAt > now) return cached.promise;

    const request = (async () => {
      const sb = client();
      if (!sb?.functions?.invoke) return null;
      try {
        const { data, error } = await sb.functions.invoke("w3m-trust-badge", {
          body: { project_id: projectId }
        });
        if (error || data?.ok !== true || !data?.badge) return null;
        if (!["code_audit_verified", "premium_verified"].includes(data.badge)) return null;
        if (!Number.isFinite(Number(data.score)) || Number(data.score) < 80 ||
            !/^[0-9a-f]{40}$/i.test(String(data.audited_commit || "")) ||
            String(data.audited_commit).toLowerCase() !== String(data.current_commit || "").toLowerCase()) return null;
        return data;
      } catch (error) {
        console.warn("W3M trust badge verification unavailable:", error);
        return null;
      }
    })();

    const entry = { expiresAt: now + CACHE_TTL_MS, promise: request };
    cache.set(projectId, entry);
    const result = await request;
    // Failures are not cached: a transient outage can recover without a page reload.
    if (!result && cache.get(projectId) === entry) cache.delete(projectId);
    return result;
  }

  function badgeHtml(data, compact) {
    const premium = data.badge === "premium_verified";
    const label = premium ? "Premium Verified" : "Code Audit Verified";
    const cls = premium ? "wm-trust-badge-premium" : "wm-trust-badge-code";
    const score = Math.round(Number(data.score));
    const title = label + " · W3M AI Code Audit · " + score + "/100 · bound to commit " +
      String(data.audited_commit).slice(0, 12) + ". Point-in-time evidence, not a security guarantee.";
    return '<span class="wm-trust-badge ' + cls + '" title="' + esc(title) + '" aria-label="' + esc(title) + '">' +
      '<span aria-hidden="true">✓</span> ' + label + (compact ? "" : " · " + score + "/100") + '</span>';
  }

  function installStyle() {
    if (document.getElementById("wm-trust-badge-style")) return;
    const style = document.createElement("style");
    style.id = "wm-trust-badge-style";
    style.textContent = ".wm-trust-badge{display:inline-flex;align-items:center;gap:5px;margin:5px 6px 5px 0;padding:6px 10px;border:1px solid;border-radius:999px;font-size:12px;font-weight:800;line-height:1.25;white-space:normal}.wm-trust-badge-code{color:#155e75;background:#ecfeff;border-color:#a5f3fc}.wm-trust-badge-premium{color:#854d0e;background:#fffbeb;border-color:#fcd34d}.wm-trust-badge-card{margin-top:14px;padding:12px;border:1px solid #dbe4ee;border-radius:12px;background:#fbfdff}.wm-trust-badge-card p{margin:7px 0 0;color:#667085;font-size:12px;line-height:1.5}.wm-trust-badge-card strong{font-size:13px}";
    document.head.appendChild(style);
  }

  async function decorateProjectPage() {
    const generation = refreshGeneration;
    const id = new URLSearchParams(location.search).get("id");
    if (!id) return;
    const page = document.getElementById("page");
    if (!page) return;
    const heading = Array.from(page.querySelectorAll(".card h2"))
      .find(el => el.textContent.trim() === "Trust & Verification");
    if (!heading) return;
    const card = heading.closest(".card");
    if (!card || card.querySelector("[data-wm-code-audit-badge]")) return;

    const result = await decision(id);
    if (!result || generation !== refreshGeneration || !card.isConnected ||
        card.querySelector("[data-wm-code-audit-badge]")) return;

    const panel = document.createElement("div");
    panel.dataset.wmCodeAuditBadge = "1";
    panel.className = "wm-trust-badge-card";
    panel.innerHTML = "<strong>W3M AI Code Audit</strong><div>" + badgeHtml(result, false) +
      "</div><p>Verified against the current GitHub commit " +
      esc(String(result.audited_commit).slice(0, 12)) +
      ". This is point-in-time audit evidence, not a guarantee of security.</p>";
    card.appendChild(panel);
  }

  async function decorateListingCard(article) {
    const id = article?.getAttribute("data-project-id");
    if (!id || article.dataset.wmTrustBadgeChecked === "1" || active.has(id)) return;
    const generation = refreshGeneration;
    active.add(id);
    try {
      const result = await decision(id);
      if (!result || generation !== refreshGeneration || !article.isConnected) return;
      const seller = article.querySelector(".seller, .listingBody");
      if (!seller || seller.querySelector("[data-wm-trust-badge]")) return;
      const host = document.createElement("div");
      host.dataset.wmTrustBadge = "1";
      host.appendChild(document.createRange().createContextualFragment(badgeHtml(result, true)));
      seller.appendChild(host);
      article.dataset.wmTrustBadgeChecked = "1";
    } finally {
      active.delete(id);
    }
  }

  function decorateListings() {
    document.querySelectorAll(".listingGrid [data-project-id], .wm-sold-grid [data-project-id]")
      .forEach(article => { void decorateListingCard(article); });
  }

  function refreshVisibleBadges() {
    if (document.visibilityState === "hidden" || Date.now() - lastRefreshAt < 5_000) return;
    lastRefreshAt = Date.now();
    refreshGeneration++;
    cache.clear();
    active.clear();

    document.querySelectorAll("[data-wm-code-audit-badge], [data-wm-trust-badge]")
      .forEach(node => node.remove());
    document.querySelectorAll("[data-wm-trust-badge-checked]")
      .forEach(article => { delete article.dataset.wmTrustBadgeChecked; });

    void decorateProjectPage();
    decorateListings();
  }

  function boot() {
    installStyle();
    const page = document.getElementById("page");
    if (page) {
      const observer = new MutationObserver(() => { void decorateProjectPage(); });
      observer.observe(page, { childList: true, subtree: true });
      void decorateProjectPage();
    }
    const listingRoot = document.querySelector(".listingGrid, .wm-sold-grid");
    if (listingRoot) {
      const observer = new MutationObserver(decorateListings);
      observer.observe(listingRoot.parentElement || document.body, {
        childList: true, subtree: true
      });
    }
    // Run once even when a page contains only sold listings.
    decorateListings();
    window.addEventListener("focus", refreshVisibleBadges);
    document.addEventListener("visibilitychange", refreshVisibleBadges);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
