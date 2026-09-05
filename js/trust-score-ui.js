"use strict";

/* Web3Market Trust / Verification UI layer.
   Reads existing verification data only; does not modify payments, deals,
   wallets, Safe, or scoring records. */
(function () {
    const SUPABASE_URL = "https://hzhqlexnhtukfljcvnyd.supabase.co";
    const SUPABASE_KEY = "sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI";
    let client = null;
    let observerStarted = false;
    let marketplaceRun = false;
    let projectRun = false;

    function getClient() {
        if (client?.from) return client;
        client = window.Web3MarketSupabase?.getClient?.() || window.supabaseClient || window.web3marketSupabase || null;
        if (client?.from) return client;
        if (window.supabase?.createClient) {
            try {
                client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
                    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "web3market-auth" }
                });
            } catch (e) { console.warn("Trust UI Supabase bootstrap failed", e); }
        }
        return client;
    }

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>\"']/g, (m) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
        }[m]));
    }

    function scoreLabel(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return "Not verified";
        const s = Math.max(0, Math.min(100, Math.round(n)));
        return `${s}/100`;
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
        style.textContent = `
.wm-trust-badge{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;padding:9px 11px;border:1px solid #e2e6ee;border-radius:11px;background:#f8f9fc;font-size:11px;font-weight:800}
.wm-trust-badge strong{font-size:14px}
.wm-trust-badge.strong{border-color:#b9e2c9;background:#f0fbf4;color:#16733b}
.wm-trust-badge.moderate{border-color:#e8d59b;background:#fffaf0;color:#8a6400}
.wm-trust-badge.developing{border-color:#cbdcf1;background:#f4f9ff;color:#28669c}
.wm-trust-badge.limited{border-color:#e4c6c6;background:#fff7f7;color:#a33a3a}
.wm-trust-badge.pending{color:#667085}
.wm-trust-details{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:0 0 18px;padding:16px 18px;border:1px solid #d9d6ff;border-radius:15px;background:linear-gradient(135deg,#f5f3ff,#fff)}
.wm-trust-details .wm-score{font-size:38px;font-weight:900;line-height:1;color:#5149db}
.wm-trust-details .wm-caption{font-size:11px;font-weight:900;letter-spacing:.6px;color:#6b7280}
.wm-trust-details .wm-copy{max-width:600px}.wm-trust-details p{margin:5px 0 0;color:#6b7280;font-size:12px;line-height:1.5}
@media(max-width:620px){.wm-trust-details .wm-score{font-size:32px}}
        `;
        document.head.appendChild(style);
    }

    async function loadVerification(ids) {
        const sb = getClient();
        if (!sb || !ids.length) return new Map();
        try {
            const { data, error } = await sb.from("project_verification_summary")
                .select("project_id,verification_score,ownership_verified,domain_verified,github_verified,identity_verified,business_verified,badges")
                .in("project_id", ids);
            if (error) {
                console.warn("Trust score lookup unavailable", error);
                return new Map();
            }
            return new Map((data || []).map(row => [String(row.project_id), row]));
        } catch (e) {
            console.warn("Trust score lookup failed", e);
            return new Map();
        }
    }

    async function renderMarketplaceTrust() {
        if (marketplaceRun) return;
        const cards = Array.from(document.querySelectorAll(".project-card[data-project-id]"));
        if (!cards.length) return;
        marketplaceRun = true;
        const ids = [...new Set(cards.map(c => c.dataset.projectId).filter(Boolean))];
        const map = await loadVerification(ids);
        cards.forEach(card => {
            if (card.querySelector(".wm-trust-badge")) return;
            const row = map.get(String(card.dataset.projectId));
            const value = row?.verification_score;
            const badge = document.createElement("div");
            const state = level(value);
            badge.className = `wm-trust-badge ${state}`;
            badge.innerHTML = `<span>Trust / Verification</span><strong>${escapeHtml(scoreLabel(value))}</strong>`;
            const footer = card.querySelector(".project-card-footer");
            const meta = card.querySelector(".project-meta");
            (footer || meta || card).before(badge);
        });
        marketplaceRun = false;
    }

    function findTrustCard() {
        const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4"));
        const heading = headings.find(h => /trust\s*&\s*verification/i.test(h.textContent || ""));
        return heading?.closest(".card") || null;
    }

    async function renderProjectTrust() {
        if (projectRun) return;
        const id = new URLSearchParams(location.search).get("id");
        const card = findTrustCard();
        if (!id || !card) return;
        projectRun = true;
        const map = await loadVerification([id]);
        const row = map.get(String(id));
        if (card.querySelector(".wm-trust-details")) { projectRun = false; return; }
        const details = document.createElement("div");
        const state = level(row?.verification_score);
        details.className = "wm-trust-details";
        details.innerHTML = `<div class="wm-copy"><div class="wm-caption">WEB3MARKET TRUST / VERIFICATION SCORE</div><p>Based on the project's existing verification signals. Missing verification is not proof of a problem.</p></div><div class="wm-score ${state}">${escapeHtml(scoreLabel(row?.verification_score))}</div>`;
        const heading = card.querySelector("h2,h3,h4");
        if (heading) heading.insertAdjacentElement("afterend", details); else card.prepend(details);
        projectRun = false;
    }

    function scan() {
        injectStyles();
        renderMarketplaceTrust();
        renderProjectTrust();
    }

    function init() {
        if (observerStarted) return;
        observerStarted = true;
        scan();
        const observer = new MutationObserver(() => scan());
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
    else init();
})();
