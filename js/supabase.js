/* =========================================================
   Web3Market
   File: js/supabase.js
   Unified Supabase Client
   Version: 1.2
   ========================================================= */

"use strict";

(function () {

    // Web3Market has its own isolated Supabase project.
    // DO NOT point this client at Web3Jobs/web3jobs-v3.
    const SUPABASE_URL = "https://hzhqlexnhtukfljcvnyd.supabase.co";
    const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_JZuODPmD72gqSauHBTGNYg_cbN7gVsp";
    const STORAGE_KEY = "web3market-auth";

    let client = null;
    let initialized = false;

    function initialize() {
        if (client) return client;

        if (
            typeof window === "undefined" ||
            !window.supabase ||
            typeof window.supabase.createClient !== "function"
        ) {
            console.error("Web3Market: Supabase library is not loaded.");
            return null;
        }

        try {
            client = window.supabase.createClient(
                SUPABASE_URL,
                SUPABASE_PUBLISHABLE_KEY,
                {
                    auth: {
                        persistSession: true,
                        autoRefreshToken: true,
                        detectSessionInUrl: true,
                        storageKey: STORAGE_KEY
                    }
                }
            );

            initialized = true;

            window.Web3MarketSupabase = {
                client: client,
                supabase: client,
                getClient: function () { return client; }
            };

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

    function getClient() {
        return client || initialize();
    }

    function isInitialized() {
        return Boolean(client && initialized);
    }

    async function getSession() {
        const supabase = getClient();
        if (!supabase) return null;

        try {
            const { data, error } = await supabase.auth.getSession();
            if (error) {
                console.error("Web3Market: getSession error:", error);
                return null;
            }
            return data?.session || null;
        } catch (error) {
            console.error("Web3Market: getSession exception:", error);
            return null;
        }
    }

    async function getUser() {
        const supabase = getClient();
        if (!supabase) return null;

        try {
            const { data, error } = await supabase.auth.getUser();
            if (error) {
                console.error("Web3Market: getUser error:", error);
                return null;
            }
            return data?.user || null;
        } catch (error) {
            console.error("Web3Market: getUser exception:", error);
            return null;
        }
    }

    window.Web3MarketSupabase = window.Web3MarketSupabase || {};
    window.Web3MarketSupabase.initialize = initialize;
    window.Web3MarketSupabase.getClient = getClient;
    window.Web3MarketSupabase.getSession = getSession;
    window.Web3MarketSupabase.getUser = getUser;
    window.Web3MarketSupabase.isInitialized = isInitialized;

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
        initialize();
    }

})();
