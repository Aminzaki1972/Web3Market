/* =========================================================
   Web3Market
   File: js/supabase.js
   Unified Supabase Client
   Version: 1.0
   ========================================================= */

"use strict";

(function () {

    /* =====================================================
       SUPABASE CONFIG
       ===================================================== */

    const SUPABASE_URL =
        "https://jqhemwskrnlycximjpag.supabase.co";

    const SUPABASE_PUBLISHABLE_KEY =
        "sb_publishable_JZuODPmD72gqSauHBTGNYg_cbN7gVsp";

    const STORAGE_KEY =
        "web3market-auth";


    /* =====================================================
       INTERNAL STATE
       ===================================================== */

    let client = null;

    let initialized = false;


    /* =====================================================
       CREATE CLIENT
       ===================================================== */

    function initialize() {

        if (client) {
            return client;
        }


        /* -------------------------------------------------
           Check Supabase library
        ------------------------------------------------- */

        if (
            typeof window === "undefined" ||
            !window.supabase ||
            typeof window.supabase.createClient !==
                "function"
        ) {

            console.error(
                "Web3Market: Supabase library is not loaded."
            );

            return null;
        }


        /* -------------------------------------------------
           Create client
        ------------------------------------------------- */

        try {

            client =
                window.supabase.createClient(
                    SUPABASE_URL,
                    SUPABASE_PUBLISHABLE_KEY,
                    {
                        auth: {

                            persistSession: true,

                            autoRefreshToken: true,

                            detectSessionInUrl: true,

                            storageKey:
                                STORAGE_KEY
                        }
                    }
                );


            initialized = true;


            /*
             * Global compatibility.
             *
             * Other Web3Market files can use
             * window.supabaseClient if necessary.
             */

            window.web3marketSupabase =
                client;

            window.supabaseClient =
                client;


            console.log(
                "Web3Market: Supabase initialized successfully."
            );


            return client;

        } catch (error) {

            console.error(
                "Web3Market: Supabase initialization failed:",
                error
            );

            client = null;

            initialized = false;

            return null;
        }
    }


    /* =====================================================
       GET CLIENT
       ===================================================== */

    function getClient() {

        if (client) {
            return client;
        }

        return initialize();
    }


    /* =====================================================
       IS INITIALIZED
       ===================================================== */

    function isInitialized() {

        return Boolean(
            client &&
            initialized
        );
    }


    /* =====================================================
       GET SESSION
       ===================================================== */

    async function getSession() {

        const supabase =
            getClient();


        if (!supabase) {
            return null;
        }


        try {

            const {
                data,
                error
            } =
                await supabase.auth.getSession();


            if (error) {

                console.error(
                    "Web3Market: getSession error:",
                    error
                );

                return null;
            }


            return (
                data?.session ||
                null
            );

        } catch (error) {

            console.error(
                "Web3Market: getSession exception:",
                error
            );

            return null;
        }
    }


    /* =====================================================
       GET CURRENT USER
       ===================================================== */

    async function getUser() {

        const supabase =
            getClient();


        if (!supabase) {
            return null;
        }


        try {

            const {
                data,
                error
            } =
                await supabase.auth.getUser();


            if (error) {

                console.error(
                    "Web3Market: getUser error:",
                    error
                );

                return null;
            }


            return (
                data?.user ||
                null
            );

        } catch (error) {

            console.error(
                "Web3Market: getUser exception:",
                error
            );

            return null;
        }
    }


    /* =====================================================
       AUTH STATE CHANGE
       ===================================================== */

    function onAuthStateChange(
        callback
    ) {

        const supabase =
            getClient();


        if (
            !supabase ||
            typeof callback !==
                "function"
        ) {

            return null;
        }


        try {

            return supabase.auth.onAuthStateChange(
                callback
            );

        } catch (error) {

            console.error(
                "Web3Market: auth listener error:",
                error
            );

            return null;
        }
    }


    /* =====================================================
       SIGN OUT
       ===================================================== */

    async function signOut() {

        const supabase =
            getClient();


        if (!supabase) {
            return false;
        }


        try {

            const {
                error
            } =
                await supabase.auth.signOut();


            if (error) {

                console.error(
                    "Web3Market: signOut error:",
                    error
                );

                return false;
            }


            return true;

        } catch (error) {

            console.error(
                "Web3Market: signOut exception:",
                error
            );

            return false;
        }
    }


    /* =====================================================
       SIGN UP
       ===================================================== */

    async function signUp(
        email,
        password,
        options = {}
    ) {

        const supabase =
            getClient();


        if (!supabase) {

            return {
                data: null,
                error: new Error(
                    "Supabase client is unavailable."
                )
            };
        }


        try {

            return await supabase.auth.signUp({

                email:
                    String(
                        email || ""
                    )
                        .trim()
                        .toLowerCase(),

                password:
                    String(
                        password || ""
                    ),

                options:
                    options
            });

        } catch (error) {

            console.error(
                "Web3Market: signUp exception:",
                error
            );

            return {
                data: null,
                error
            };
        }
    }


    /* =====================================================
       SIGN IN
       ===================================================== */

    async function signIn(
        email,
        password
    ) {

        const supabase =
            getClient();


        if (!supabase) {

            return {
                data: null,
                error: new Error(
                    "Supabase client is unavailable."
                )
            };
        }


        try {

            return await supabase.auth.signInWithPassword({

                email:
                    String(
                        email || ""
                    )
                        .trim()
                        .toLowerCase(),

                password:
                    String(
                        password || ""
                    )
            });

        } catch (error) {

            console.error(
                "Web3Market: signIn exception:",
                error
            );

            return {
                data: null,
                error
            };
        }
    }


    /* =====================================================
       RESET PASSWORD
       ===================================================== */

    async function resetPassword(
        email,
        options = {}
    ) {

        const supabase =
            getClient();


        if (!supabase) {

            return {
                data: null,
                error: new Error(
                    "Supabase client is unavailable."
                )
            };
        }


        try {

            return await supabase.auth.resetPasswordForEmail(

                String(
                    email || ""
                )
                    .trim()
                    .toLowerCase(),

                options
            );

        } catch (error) {

            console.error(
                "Web3Market: reset password exception:",
                error
            );

            return {
                data: null,
                error
            };
        }
    }


    /* =====================================================
       RESEND CONFIRMATION
       ===================================================== */

    async function resendConfirmation(
        email,
        options = {}
    ) {

        const supabase =
            getClient();


        if (!supabase) {

            return {
                data: null,
                error: new Error(
                    "Supabase client is unavailable."
                )
            };
        }


        try {

            return await supabase.auth.resend({

                type: "signup",

                email:
                    String(
                        email || ""
                    )
                        .trim()
                        .toLowerCase(),

                options:
                    options
            });

        } catch (error) {

            console.error(
                "Web3Market: resend confirmation exception:",
                error
            );

            return {
                data: null,
                error
            };
        }
    }


    /* =====================================================
       GET CONFIG
       ===================================================== */

    function getConfig() {

        return {

            url:
                SUPABASE_URL,

            publishableKey:
                SUPABASE_PUBLISHABLE_KEY,

            storageKey:
                STORAGE_KEY
        };
    }


    /* =====================================================
       GLOBAL API
       ===================================================== */

    window.Web3MarketSupabase = {

        /* Configuration */

        url:
            SUPABASE_URL,

        publishableKey:
            SUPABASE_PUBLISHABLE_KEY,

        storageKey:
            STORAGE_KEY,


        /* Client */

        initialize:
            initialize,

        getClient:
            getClient,

        isInitialized:
            isInitialized,


        /* Session */

        getSession:
            getSession,

        getUser:
            getUser,


        /* Authentication */

        signUp:
            signUp,

        signIn:
            signIn,

        signOut:
            signOut,

        resetPassword:
            resetPassword,

        resendConfirmation:
            resendConfirmation,


        /* Auth events */

        onAuthStateChange:
            onAuthStateChange,


        /* Config */

        getConfig:
            getConfig
    };


    /* =====================================================
       BACKWARD COMPATIBILITY
       ===================================================== */

    window.getSupabaseClient =
        getClient;


    window.getSupabaseSession =
        getSession;


    window.getSupabaseUser =
        getUser;


    /* =====================================================
       INITIALIZE AFTER SCRIPT LOAD
       ===================================================== */

    initialize();


})();
