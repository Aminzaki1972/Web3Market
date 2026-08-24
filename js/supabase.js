/* =========================================================
   Web3Market
   File: js/supabase.js
   Unified Supabase Client
   Version: 1.4
   ========================================================= */

"use strict";

(function () {
    const SUPABASE_URL = "https://hzhqlexnhtukfljcvnyd.supabase.co";
    const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI";
    const STORAGE_KEY = "web3market-auth";
    let client = null;
    let initialized = false;

    function initialize() {
        if (client) return client;
        if (typeof window === "undefined" || !window.supabase || typeof window.supabase.createClient !== "function") {
            console.error("Web3Market: Supabase library is not loaded.");
            return null;
        }
        try {
            client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
                auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: STORAGE_KEY }
            });
            initialized = true;
            window.Web3MarketSupabase = { client: client, supabase: client, getClient: function () { return client; } };
            window.web3marketSupabase = client;
            window.supabaseClient = client;
            console.log("Web3Market: Supabase initialized successfully.");
            return client;
        } catch (error) {
            console.error("Web3Market: Supabase initialization failed:", error);
            client = null;
            initialized = false;
            return null;
        }
    }

    function getClient() { return client || initialize(); }
    function isInitialized() { return Boolean(client && initialized); }

    async function getSession() {
        const supabase = getClient();
        if (!supabase) return null;
        try {
            const { data, error } = await supabase.auth.getSession();
            if (error) { console.error("Web3Market: getSession error:", error); return null; }
            return data?.session || null;
        } catch (error) { console.error("Web3Market: getSession exception:", error); return null; }
    }

    async function getUser() {
        const supabase = getClient();
        if (!supabase) return null;
        try {
            const { data, error } = await supabase.auth.getUser();
            if (error) { console.error("Web3Market: getUser error:", error); return null; }
            return data?.user || null;
        } catch (error) { console.error("Web3Market: getUser exception:", error); return null; }
    }

    function installHomepageNewsTicker() {
        if (!document.body || document.getElementById("web3market-news-ticker")) return;
        const path = (window.location.pathname || "").split("/").pop().toLowerCase();
        if (path && path !== "index.html") return;
        const counters = document.querySelector(".projectCounters");
        if (!counters) return;

        const labels = document.querySelectorAll(".projectCounters .counter span");
        ["Listed", "Under AI Review", "Pending Execution", "Sold"].forEach(function (label, i) {
            if (labels[i]) labels[i].textContent = label;
        });

        const style = document.createElement("style");
        style.textContent = `
          #web3market-news-ticker{width:100%;overflow:hidden;background:#141820;color:#d8dde6;border-radius:10px;margin:4px 0 12px;white-space:nowrap;box-shadow:0 5px 16px rgba(20,24,32,.06)}
          #web3market-news-ticker .wm-news-track{display:inline-flex;min-width:max-content;animation:wmNewsMove 38s linear infinite}
          #web3market-news-ticker a{display:inline-block;color:#d8dde6;text-decoration:none;font-size:11px;font-weight:700;padding:9px 0 9px 28px}
          #web3market-news-ticker a:hover{color:#fff}
          #web3market-news-ticker .wm-sep{color:#635bff;padding:0 18px;font-weight:900}
          @keyframes wmNewsMove{from{transform:translateX(0)}to{transform:translateX(-50%)}}
          @media(max-width:620px){#web3market-news-ticker a{font-size:10px;padding-left:20px}}
          @media(prefers-reduced-motion:reduce){#web3market-news-ticker .wm-news-track{animation:none}}
        `;
        document.head.appendChild(style);

        const items = [
            ["Metaplanet agrees to acquire 96% of Super League in a 2,100 BTC and cash deal", "https://www.theblock.co/news/deals"],
            ["IREN delivers first AI cloud deployment to Microsoft under a reported $9.7B deal", "https://www.theblock.co/news/deals"],
            ["HIVE signs a five-year $350M AI cloud contract", "https://www.theblock.co/news/deals"],
            ["Vangrid raises $9M to build a spatial-data network for physical AI", "https://www.theblock.co/news/deals"],
            ["July crypto M&A activity reached 19 announced acquisitions", "https://www.thetie.io/insights/july-2026-crypto-funding-brief"]
        ];

        const ticker = document.createElement("div");
        ticker.id = "web3market-news-ticker";
        ticker.setAttribute("aria-label", "Latest market news");

        function makeTrack() {
            const track = document.createElement("div");
            track.className = "wm-news-track";
            items.forEach(function (item) {
                const a = document.createElement("a");
                a.href = item[1];
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                a.textContent = item[0];
                track.appendChild(a);
                const sep = document.createElement("span");
                sep.className = "wm-sep";
                sep.textContent = "•";
                track.appendChild(sep);
            });
            return track;
        }
        ticker.appendChild(makeTrack());
        ticker.appendChild(makeTrack());
        counters.insertAdjacentElement("afterend", ticker);
    }

    window.Web3MarketSupabase = window.Web3MarketSupabase || {};
    window.Web3MarketSupabase.initialize = initialize;
    window.Web3MarketSupabase.getClient = getClient;
    window.Web3MarketSupabase.getSession = getSession;
    window.Web3MarketSupabase.getUser = getUser;
    window.Web3MarketSupabase.isInitialized = isInitialized;

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () {
            initialize();
            installHomepageNewsTicker();
        }, { once: true });
    } else {
        initialize();
        installHomepageNewsTicker();
    }
})();
