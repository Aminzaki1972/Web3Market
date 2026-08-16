/* =========================================================
   Web3Market
   File: js/auth.js

   Authentication System
   -----------------------------------------
   Registration flow:

   1. Connect Web3 Wallet
   2. Verify Wallet Ownership
   3. Enter Email
   4. Send Supabase Email Verification / OTP
   5. Complete account after email verification

   Compatible with:
   register.html

   Required public API:
   window.Web3MarketAuth.registerWithWallet()

   ========================================================= */

"use strict";

(function () {

    /* =====================================================
       CONFIGURATION
       ===================================================== */

    const STORAGE_KEY = "web3market_pending_registration";

    const PROFILE_TABLE = "profiles";


    /* =====================================================
       SUPABASE CLIENT
       ===================================================== */

    function getSupabaseClient() {

        /*
         * Preferred Web3Market client.
         */

        if (
            window.Web3MarketSupabase &&
            window.Web3MarketSupabase.client
        ) {
            return window.Web3MarketSupabase.client;
        }


        /*
         * Alternative naming.
         */

        if (
            window.Web3MarketSupabase &&
            window.Web3MarketSupabase.supabase
        ) {
            return window.Web3MarketSupabase.supabase;
        }


        /*
         * Common global client names.
         */

        if (
            window.supabaseClient
        ) {
            return window.supabaseClient;
        }


        if (
            window.supabase &&
            typeof window.supabase.from === "function"
        ) {
            return window.supabase;
        }


        /*
         * Some projects expose:
         * window.supabase.client
         */

        if (
            window.supabase &&
            window.supabase.client &&
            typeof window.supabase.client.from === "function"
        ) {
            return window.supabase.client;
        }


        return null;
    }


    /* =====================================================
       VALIDATION
       ===================================================== */

    function normalizeEmail(email) {

        if (
            typeof email !== "string"
        ) {
            return "";
        }

        return email
            .trim()
            .toLowerCase();
    }


    function isValidEmail(email) {

        if (!email) {
            return false;
        }

        /*
         * Practical email validation.
         */

        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }


    function normalizeWalletAddress(address) {

        if (
            typeof address !== "string"
        ) {
            return "";
        }

        return address.trim();
    }


    function isValidWalletAddress(address) {

        return /^0x[a-fA-F0-9]{40}$/.test(
            address
        );
    }


    /* =====================================================
       STORAGE
       ===================================================== */

    function savePendingRegistration(data) {

        try {

            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify({
                    walletAddress:
                        data.walletAddress || "",

                    email:
                        data.email || "",

                    createdAt:
                        Date.now()
                })
            );

        }
        catch (error) {

            console.warn(
                "Web3Market: unable to save pending registration.",
                error
            );
        }
    }


    function getPendingRegistration() {

        try {

            const raw =
                localStorage.getItem(
                    STORAGE_KEY
                );

            if (!raw) {
                return null;
            }

            const data =
                JSON.parse(raw);

            if (
                !data ||
                typeof data !== "object"
            ) {
                return null;
            }

            return data;

        }
        catch (error) {

            console.warn(
                "Web3Market: unable to read pending registration.",
                error
            );

            return null;
        }
    }


    function clearPendingRegistration() {

        try {

            localStorage.removeItem(
                STORAGE_KEY
            );

        }
        catch (error) {

            console.warn(
                "Web3Market: unable to clear pending registration.",
                error
            );
        }
    }


    /* =====================================================
       AUTH ERROR NORMALIZATION
       ===================================================== */

    function normalizeAuthError(error) {

        if (!error) {

            return new Error(
                "An unknown authentication error occurred."
            );
        }


        const message =
            error.message ||
            error.error_description ||
            error.msg ||
            "";


        const lower =
            String(message).toLowerCase();


        if (
            lower.includes("rate limit") ||
            lower.includes("too many") ||
            lower.includes("email rate limit")
        ) {

            return new Error(
                "Too many verification emails were requested. Please wait a few minutes before trying again."
            );
        }


        if (
            lower.includes("invalid email")
        ) {

            return new Error(
                "Please enter a valid email address."
            );
        }


        if (
            lower.includes("user already registered")
        ) {

            return new Error(
                "This email is already registered. Please sign in instead."
            );
        }


        if (
            lower.includes("failed to fetch") ||
            lower.includes("network")
        ) {

            return new Error(
                "Unable to connect to Web3Market. Please check your internet connection and try again."
            );
        }


        return new Error(
            String(message) ||
            "Authentication failed."
        );
    }


    /* =====================================================
       PROFILE HELPERS
       ===================================================== */

    async function upsertProfile(
        client,
        user,
        walletAddress,
        email
    ) {

        if (
            !client ||
            !user
        ) {
            return null;
        }


        const normalizedWallet =
            normalizeWalletAddress(
                walletAddress
            );


        const normalizedEmail =
            normalizeEmail(
                email ||
                user.email ||
                ""
            );


        /*
         * The basic profile structure used by
         * Web3Market.
         *
         * id:
         * Supabase Auth user ID
         *
         * email:
         * User email
         *
         * wallet_address:
         * Connected Web3 wallet
         *
         * role:
         * individual by default
         *
         * updated_at:
         * Current timestamp
         */

        const profileData = {

            id:
                user.id,

            email:
                normalizedEmail,

            wallet_address:
                normalizedWallet || null,

            role:
                "individual",

            updated_at:
                new Date().toISOString()
        };


        /*
         * First try upsert.
         */

        const result =
            await client
                .from(PROFILE_TABLE)
                .upsert(
                    profileData,
                    {
                        onConflict: "id"
                    }
                )
                .select()
                .maybeSingle();


        if (result.error) {

            /*
             * Do not make registration fail solely
             * because the optional profile table has
             * a different structure.
             *
             * The authenticated Supabase account
             * has already been created.
             */

            console.warn(
                "Web3Market profile upsert warning:",
                result.error
            );

            return null;
        }


        return result.data || null;
    }


    /* =====================================================
       SAVE WALLET DATA TO AUTH USER METADATA
       ===================================================== */

    async function updateUserMetadata(
        client,
        walletAddress,
        email
    ) {

        if (
            !client ||
            !client.auth
        ) {
            return null;
        }


        const metadata = {

            wallet_address:
                normalizeWalletAddress(
                    walletAddress
                ),

            registration_method:
                "wallet",

            wallet_verified:
                true,

            web3market_account:
                true
        };


        /*
         * Do not overwrite email through metadata.
         * Supabase Auth controls the real email field.
         */

        const {
            data,
            error
        } =
            await client.auth.updateUser({

                data: metadata

            });


        if (error) {

            console.warn(
                "Web3Market metadata update warning:",
                error
            );

            return null;
        }


        return data;
    }


    /* =====================================================
       REGISTER WITH WALLET + EMAIL
       ===================================================== */

    async function registerWithWallet(
        registration
    ) {

        const client =
            getSupabaseClient();


        if (!client) {

            throw new Error(
                "Supabase client is not initialized. Please check js/supabase.js."
            );
        }


        if (
            !registration ||
            typeof registration !== "object"
        ) {

            throw new Error(
                "Registration data is missing."
            );
        }


        const walletAddress =
            normalizeWalletAddress(
                registration.walletAddress
            );


        const email =
            normalizeEmail(
                registration.email
            );


        /*
         * Validate wallet.
         */

        if (
            !isValidWalletAddress(
                walletAddress
            )
        ) {

            throw new Error(
                "The connected wallet address is invalid."
            );
        }


        /*
         * Validate email.
         */

        if (
            !isValidEmail(email)
        ) {

            throw new Error(
                "Please enter a valid email address."
            );
        }


        /*
         * Save pending registration locally.
         *
         * This allows the wallet address to survive
         * the email verification step.
         */

        savePendingRegistration({

            walletAddress:
                walletAddress,

            email:
                email

        });


        /*
         * -------------------------------------------------
         * SUPABASE PASSWORDLESS EMAIL AUTH
         * -------------------------------------------------
         *
         * signInWithOtp() sends a verification email.
         *
         * If the email does not exist, Supabase can
         * create the Auth user automatically.
         *
         * No password is required.
         */

        const {
            data,
            error
        } =
            await client.auth.signInWithOtp({

                email: email,

                options: {

                    shouldCreateUser: true,

                    data: {

                        wallet_address:
                            walletAddress,

                        registration_method:
                            "wallet",

                        wallet_verified:
                            true,

                        web3market_account:
                            true
                    }

                }

            });


        if (error) {

            throw normalizeAuthError(
                error
            );
        }


        /*
         * If Supabase returned a session immediately,
         * update the profile now.
         *
         * Usually passwordless signup will require
         * email confirmation first.
         */

        if (
            data &&
            data.session &&
            data.user
        ) {

            try {

                await upsertProfile(
                    client,
                    data.user,
                    walletAddress,
                    email
                );

            }
            catch (profileError) {

                console.warn(
                    "Web3Market profile creation warning:",
                    profileError
                );
            }

        }


        /*
         * Return a clear result to register.html.
         */

        return {

            success: true,

            requiresEmailVerification:
                !(
                    data &&
                    data.session
                ),

            email:
                email,

            walletAddress:
                walletAddress,

            user:
                data
                    ? data.user || null
                    : null,

            session:
                data
                    ? data.session || null
                    : null
        };
    }


    /* =====================================================
       COMPLETE REGISTRATION AFTER EMAIL VERIFICATION
       ===================================================== */

    async function completeRegistration() {

        const client =
            getSupabaseClient();


        if (!client) {

            throw new Error(
                "Supabase client is not initialized."
            );
        }


        const {
            data,
            error
        } =
            await client.auth.getUser();


        if (error) {

            throw normalizeAuthError(
                error
            );
        }


        const user =
            data &&
            data.user
                ? data.user
                : null;


        if (!user) {

            return {

                success: false,

                authenticated: false

            };
        }


        const pending =
            getPendingRegistration();


        let walletAddress =
            pending &&
            pending.walletAddress
                ? pending.walletAddress
                : "";


        let email =
            pending &&
            pending.email
                ? pending.email
                : user.email || "";


        /*
         * If the wallet address is not in localStorage,
         * try to recover it from Auth metadata.
         */

        if (
            !walletAddress &&
            user.user_metadata
        ) {

            walletAddress =
                user.user_metadata.wallet_address ||
                "";
        }


        /*
         * Update Auth metadata.
         */

        try {

            await updateUserMetadata(
                client,
                walletAddress,
                email
            );

        }
        catch (metadataError) {

            console.warn(
                "Web3Market metadata warning:",
                metadataError
            );
        }


        /*
         * Create/update the profile.
         */

        try {

            await upsertProfile(
                client,
                user,
                walletAddress,
                email
            );

        }
        catch (profileError) {

            console.warn(
                "Web3Market profile warning:",
                profileError
            );
        }


        /*
         * Registration is complete.
         */

        clearPendingRegistration();


        return {

            success: true,

            authenticated: true,

            user:
                user,

            walletAddress:
                walletAddress,

            email:
                email
        };
    }


    /* =====================================================
       GET CURRENT USER
       ===================================================== */

    async function getCurrentUser() {

        const client =
            getSupabaseClient();


        if (!client) {
            return null;
        }


        try {

            const {
                data,
                error
            } =
                await client.auth.getUser();


            if (error) {
                return null;
            }


            return data &&
                data.user
                ? data.user
                : null;

        }
        catch (error) {

            console.error(
                "Web3Market getCurrentUser error:",
                error
            );

            return null;
        }
    }


    /* =====================================================
       GET CURRENT SESSION
       ===================================================== */

    async function getSession() {

        const client =
            getSupabaseClient();


        if (!client) {
            return null;
        }


        try {

            const {
                data,
                error
            } =
                await client.auth.getSession();


            if (error) {
                return null;
            }


            return data &&
                data.session
                ? data.session
                : null;

        }
        catch (error) {

            console.error(
                "Web3Market getSession error:",
                error
            );

            return null;
        }
    }


    /* =====================================================
       EMAIL SIGN-IN
       ===================================================== */

    async function signInWithEmail(
        email
    ) {

        const client =
            getSupabaseClient();


        if (!client) {

            throw new Error(
                "Supabase client is not initialized."
            );
        }


        const normalizedEmail =
            normalizeEmail(
                email
            );


        if (
            !isValidEmail(
                normalizedEmail
            )
        ) {

            throw new Error(
                "Please enter a valid email address."
            );
        }


        const {
            data,
            error
        } =
            await client.auth.signInWithOtp({

                email:
                    normalizedEmail,

                options: {

                    shouldCreateUser:
                        false

                }

            });


        if (error) {

            throw normalizeAuthError(
                error
            );
        }


        return {

            success: true,

            email:
                normalizedEmail,

            requiresEmailVerification:
                true,

            data:
                data || null
        };
    }


    /* =====================================================
       SIGN OUT
       ===================================================== */

    async function signOut() {

        const client =
            getSupabaseClient();


        if (!client) {

            throw new Error(
                "Supabase client is not initialized."
            );
        }


        const {
            error
        } =
            await client.auth.signOut();


        if (error) {

            throw normalizeAuthError(
                error
            );
        }


        clearPendingRegistration();


        return {
            success: true
        };
    }


    /* =====================================================
       AUTH STATE LISTENER
       ===================================================== */

    function onAuthStateChange(
        callback
    ) {

        const client =
            getSupabaseClient();


        if (
            !client ||
            !client.auth ||
            typeof callback !== "function"
        ) {

            return {
                unsubscribe: function () {}
            };
        }


        const {
            data
        } =
            client.auth.onAuthStateChange(
                function (
                    event,
                    session
                ) {

                    try {

                        callback(
                            event,
                            session
                        );

                    }
                    catch (error) {

                        console.error(
                            "Web3Market auth callback error:",
                            error
                        );

                    }

                }
            );


        if (
            data &&
            data.subscription
        ) {

            return data.subscription;
        }


        return {
            unsubscribe: function () {}
        };
    }


    /* =====================================================
       GET PROFILE
       ===================================================== */

    async function getProfile(
        userId
    ) {

        const client =
            getSupabaseClient();


        if (
            !client ||
            !userId
        ) {
            return null;
        }


        try {

            const {
                data,
                error
            } =
                await client
                    .from(PROFILE_TABLE)
                    .select("*")
                    .eq(
                        "id",
                        userId
                    )
                    .maybeSingle();


            if (error) {

                console.warn(
                    "Web3Market profile lookup warning:",
                    error
                );

                return null;
            }


            return data || null;

        }
        catch (error) {

            console.error(
                "Web3Market getProfile error:",
                error
            );

            return null;
        }
    }


    /* =====================================================
       GET PENDING REGISTRATION
       ===================================================== */

    function getPendingRegistrationPublic() {

        return getPendingRegistration();
    }


    /* =====================================================
       CHECK AUTHENTICATION
       ===================================================== */

    async function isAuthenticated() {

        const user =
            await getCurrentUser();

        return !!user;
    }


    /* =====================================================
       INITIALIZE AUTH
       ===================================================== */

    async function initialize() {

        const client =
            getSupabaseClient();


        if (!client) {

            console.warn(
                "Web3Market Auth: Supabase client is not available yet."
            );

            return {

                initialized: false,

                user: null

            };
        }


        const user =
            await getCurrentUser();


        /*
         * If a verified email session exists,
         * complete the pending registration.
         */

        if (user) {

            try {

                await completeRegistration();

            }
            catch (error) {

                console.warn(
                    "Web3Market registration completion warning:",
                    error
                );
            }

        }


        return {

            initialized: true,

            user:
                user

        };
    }


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.Web3MarketAuth = {

        /*
         * Main registration method used by register.html.
         */

        registerWithWallet:
            registerWithWallet,


        /*
         * Complete account after email verification.
         */

        completeRegistration:
            completeRegistration,


        /*
         * Authentication helpers.
         */

        signInWithEmail:
            signInWithEmail,

        signOut:
            signOut,

        getCurrentUser:
            getCurrentUser,

        getSession:
            getSession,

        isAuthenticated:
            isAuthenticated,

        getProfile:
            getProfile,

        onAuthStateChange:
            onAuthStateChange,


        /*
         * Registration state.
         */

        getPendingRegistration:
            getPendingRegistrationPublic,

        clearPendingRegistration:
            clearPendingRegistration,


        /*
         * Initialization.
         */

        initialize:
            initialize

    };


    /* =====================================================
       AUTO INITIALIZATION
       ===================================================== */

    function startAuth() {

        /*
         * Give js/supabase.js a chance to initialize
         * before attempting authentication.
         */

        initialize()
            .catch(function (error) {

                console.warn(
                    "Web3Market Auth initialization warning:",
                    error
                );

            });
    }


    if (
        document.readyState === "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            startAuth,
            {
                once: true
            }
        );

    }
    else {

        startAuth();

    }


})();
