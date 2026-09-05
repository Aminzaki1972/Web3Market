"use strict";

/* Web3Market Trust / Verification UI layer.
   Read-only presentation layer: existing verification data only. */
(function () {
    let client = null;
    let observerStarted = false;
    let marketplaceRunning = false;
    let projectRunning = false;
    let projectCache = null;

    function getClient() {
        if (client?.from) return client;
        client = window.Web3MarketSupabase?.getClient?.() || window.supabaseClient || window.web3marketSupabase || null;
        return client;
    }

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>\"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
    }

    function normalize(value) { return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " "); }
    function scoreLabel(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return "Not verified";
        return `${Math.max(0, Math.min(100, Math.round(n)))}/100`;
    }
    function level(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return "pending";
        if (n >= 80) return "strong";
        if (n >= 60) return "moderate";
        if (n >= 40) return "developing";
        return "limited";
    }

    function injectStyles() {
        if (document.getElementById("wm-trust-score-ui-style")) return;
        const style = document.createElement("style");
        style.id = "wm-trust-score-ui-style";
        style.textContent = `.wm-trust-badge{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;padding:9px 11px;border:1px solid #e2e6ee;border-radius:11px;background:#f8f9fc;font-size:11px;font-weight:800}.wm-trust-badge strong{font-size:14px}.wm-trust-badge.strong{border-color:#b9e2c9;background:#f0fbf4;color:#16733b}.wm-trust-badge.moderate{border-color:#e8d59b;background:#fffaf0;color:#8a6400}.wm-trust-badge.developing{border-color:#cbdcf1;background:#f4f9ff;color:#28669c}.wm-trust-badge.limited{border-color:#e4c6c6;background:#fff7f7;color:#a33a3a}.wm-trust-badge.pending{color:#667085}.wm-trust-details{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:0 0 18px;padding:16px 18px;border:1px solid #d9d6ff;border-radius:15px;background:linear-gradient(135deg,#f5f3ff,#fff)}.wm-trust-details .wm-score{font-size:38px;font-weight:900;line-height:1;color:#5149db}.wm-trust-details .wm-caption{font-size:11px;font-weight:900;letter-spacing:.6px;color:#6b7280}.wm-trust-details .wm-copy{max-width:600px}.wm-trust-details p{margin:5px 0 0;color:#6b7280;font-size:12px;line-height:1.5}@media(max-width:620px){.wm-trust-details .wm-score{font-size:32px}}`;
        document.head.appendChild(style);
    }

    async function loadVerification(ids) {
        const sb = getClient();
        if (!sb || !ids.length) return new Map();
        try {
            const { data, error } = await sb.from("project_verification_summary").select("project_id,verification_score,ownership_verified,domain_verified,github_verified,identity_verified,business_verified,badges").in("project_id", ids);
            if (error) { console.warn("Trust score lookup unavailable", error); return new Map(); }
            return new Map((data || []).map(row => [String(row.project_id), row]));
        } catch (e) { console.warn("Trust score lookup failed", e); return new Map(); }
    }

    async function loadProjectsForStaticCards() {
        if (projectCache) return projectCache;
        const sb = getClient();
        if (!sb) return [];
        try {
            const { data, error } = await sb.from("projects").select("id,title,name");
            if (error) throw error;
            projectCache = Array.isArray(data) ? data : [];
        } catch (e) { console.warn("Trust UI project lookup unavailable", e); projectCache = []; }
        return projectCache;
    }

    function makeBadge(value) {
        const badge = document.createElement("div");
        badge.className = `wm-trust-badge ${level(value)}`;
        badge.innerHTML = `<span>Trust / Verification</span><strong>${escapeHtml(scoreLabel(value))}</strong>`;
        return badge;
    }

    async function renderDynamicMarketplaceTrust() {
        const cards = Array.from(document.querySelectorAll(".project-card[data-project-id]"));
        if (!cards.length) return;
        const ids = [...new Set(cards.map(c => c.dataset.projectId).filter(Boolean))];
        const map = await loadVerification(ids);
        cards.forEach(card => {
            if (card.querySelector(".wm-trust-badge")) return;
            const badge = makeBadge(map.get(String(card.dataset.projectId))?.verification_score);
            const target = card.querySelector(".project-card-footer") || card.querySelector(".project-meta") || card;
            target.before(badge);
        });
    }

    async function renderStaticMarketplaceTrust() {
        const cards = Array.from(document.querySelectorAll(".listing"));
        if (!cards.length) return;
        const projects = await loadProjectsForStaticCards();
        if (!projects.length) return;
        const matched = cards.map(card => {
            const title = normalize(card.querySelector("h3")?.textContent);
            return projects.find(p => normalize(p.title || p.name) === title) || null;
        }).filter(Boolean);
        const map = await loadVerification([...new Set(matched.map(p => String(p.id)).filter(Boolean))]);
        cards.forEach(card => {
            if (card.querySelector(".wm-trust-badge")) return;
            const title = normalize(card.querySelector("h3")?.textContent);
            const project = projects.find(p => normalize(p.title || p.name) === title);
            const badge = makeBadge(project?.id ? map.get(String(project.id))?.verification_score : null);
            const target = card.querySelector(".meta") || card.querySelector(".listingBody") || card;
            target.before(badge);
        });
    }

    async function renderMarketplaceTrust() {
        if (marketplaceRunning) return;
        marketplaceRunning = true;
        try { await renderDynamicMarketplaceTrust(); await renderStaticMarketplaceTrust(); }
        finally { marketplaceRunning = false; }
    }

    function findTrustCard() {
        const heading = Array.from(document.querySelectorAll("h1,h2,h3,h4")).find(h => /trust\s*&\s*verification/i.test(h.textContent || ""));
        return heading?.closest(".card") || null;
    }

    async function renderProjectTrust() {
        if (projectRunning) return;
        const id = new URLSearchParams(location.search).get("id");
        const card = findTrustCard();
        if (!id || !card || card.querySelector(".wm-trust-details")) return;
        projectRunning = true;
        try {
            const row = (await loadVerification([id])).get(String(id));
            const details = document.createElement("div");
            details.className = "wm-trust-details";
            details.innerHTML = `<div class="wm-copy"><div class="wm-caption">WEB3MARKET TRUST / VERIFICATION SCORE</div><p>Based on the project's existing verification signals. Missing verification is not proof of a problem.</p></div><div class="wm-score ${level(row?.verification_score)}">${escapeHtml(scoreLabel(row?.verification_score))}</div>`;
            const heading = card.querySelector("h2,h3,h4");
            if (heading) heading.insertAdjacentElement("afterend", details); else card.prepend(details);
        } finally { projectRunning = false; }
    }

    function scan() { injectStyles(); renderMarketplaceTrust(); renderProjectTrust(); }
    function init() {
        if (observerStarted) return;
        observerStarted = true;
        scan();
        new MutationObserver(() => scan()).observe(document.body, { childList: true, subtree: true });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true }); else init();
})();
