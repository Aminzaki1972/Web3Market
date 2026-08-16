/* =========================================================
   Web3Market
   File: js/auth.js
   Authentication Controller
   Version: 2.0

   Flow:
   1. Create account
   2. Supabase sends email confirmation
   3. User confirms email
   4. Connect Web3 wallet
   5. Sign wallet ownership message
   6. Account becomes ready

   No Face Verification
   No Liveness
   No Private Keys
   No Seed Phrases
   ========================================================= */

"use strict";

(function () {

    /* =====================================================
       GLOBAL STATE
       ===================================================== */

    const Web3MarketAuth = {

        initialized: false,

        user: null,

        session: null,

        emailVerified: false,

        walletVerified: false,

        walletAddress: null,

        loading: false

    };


    /* =====================================================
       GET SUPABASE CLIENT
       ===================================================== */

    function getSupabase() {

        if (
            window.Web3MarketSupabase &&
            typeof
            window.Web3MarketSupabase.getClient ===
            "function"
        ) {

            return window.Web3MarketSupabase.getClient();
        }


        if (
            window.supabaseClient
        ) {

            return window.supabaseClient;
        }


        if (
            window.supabase &&
            typeof
            window.supabase.createClient ===
            "function"
        ) {

            console.error(
                "Web3Market Auth: use js/supabase.js to create the client."
            );
        }


        return null;
    }


    /* =====================================================
       GET USER
       ===================================================== */

    async function getUser() {

        const supabase =
            getSupabase();


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

                console.warn(
                    "Web3Market Auth getUser:",
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
                "Web3Market Auth getUser exception:",
                error
            );

            return null;
        }
    }


    /* =====================================================
       GET SESSION
       ===================================================== */

    async function getSession() {

        const supabase =
            getSupabase();


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

                console.warn(
                    "Web3Market Auth getSession:",
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
                "Web3Market Auth getSession exception:",
                error
            );

            return null;
        }
    }


    /* =====================================================
       CHECK EMAIL VERIFICATION
       ===================================================== */

    function isEmailVerified(
        user
    ) {

        if (!user) {
            return false;
        }


        return Boolean(
            user.email_confirmed_at ||
            user.confirmed_at
        );
    }


    /* =====================================================
       CREATE ACCOUNT
       ===================================================== */

    async function register(
        email,
        password,
        accountType = "buyer"
    ) {

        const supabase =
            getSupabase();


        if (!supabase) {

            return {

                success: false,

                error:
                    "Supabase client is not available."

            };
        }


        const cleanEmail =
            String(
                email || ""
            )
                .trim()
                .toLowerCase();


        const cleanPassword =
            String(
                password || ""
            );


        const cleanAccountType =
            String(
                accountType || "buyer"
            )
                .trim()
                .toLowerCase();


        if (!cleanEmail) {

            return {

                success: false,

                error:
                    "Please enter your email address."

            };
        }


        if (
            cleanPassword.length < 6
        ) {

            return {

                success: false,

                error:
                    "Password must contain at least 6 characters."

            };
        }


        setLoading(true);


        try {

            const redirectUrl =
                getEmailRedirectUrl();


            const result =
                await supabase.auth.signUp({

                    email:
                        cleanEmail,

                    password:
                        cleanPassword,

                    options: {

                        emailRedirectTo:
                            redirectUrl,

                        data: {

                            account_type:
                                cleanAccountType,

                            platform:
                                "Web3Market"

                        }

                    }

                });


            if (result.error) {

                console.error(
                    "Web3Market registration error:",
                    result.error
                );


                return {

                    success: false,

                    error:
                        formatAuthError(
                            result.error
                        ),

                    rawError:
                        result.error

                };
            }


            Web3MarketAuth.user =
                result.data?.user ||
                null;


            Web3MarketAuth.session =
                result.data?.session ||
                null;


            Web3MarketAuth.emailVerified =
                isEmailVerified(
                    Web3MarketAuth.user
                );


            syncAppState();


            /*
             * If email confirmation is enabled,
             * Supabase normally returns a user
             * without an active session.
             */

            if (
                result.data?.user &&
                !result.data?.session &&
                !Web3MarketAuth.emailVerified
            ) {

                showMessage(
                    "Account created. Please check your email and click the verification link.",
                    "success"
                );

            } else {

                showMessage(
                    "Account created successfully.",
                    "success"
                );
            }


            dispatchAuthEvent(
                "registered"
            );


            return {

                success: true,

                user:
                    result.data?.user ||
                    null,

                session:
                    result.data?.session ||
                    null,

                emailVerified:
                    Web3MarketAuth.emailVerified,

                requiresEmailVerification:
                    !Web3MarketAuth.emailVerified

            };

        } catch (error) {

            console.error(
                "Web3Market registration exception:",
                error
            );


            showMessage(
                formatAuthError(error),
                "error"
            );


            return {

                success: false,

                error:
                    formatAuthError(error),

                rawError:
                    error

            };

        } finally {

            setLoading(false);
        }
    }


    /* =====================================================
       SIGN IN
       ===================================================== */

    async function login(
        email,
        password
    ) {

        const supabase =
            getSupabase();


        if (!supabase) {

            return {

                success: false,

                error:
                    "Supabase client is not available."

            };
        }


        const cleanEmail =
            String(
                email || ""
            )
                .trim()
                .toLowerCase();


        const cleanPassword =
            String(
                password || ""
            );


        if (!cleanEmail || !cleanPassword) {

            return {

                success: false,

                error:
                    "Please enter your email and password."

            };
        }


        setLoading(true);


        try {

            const result =
                await supabase.auth.signInWithPassword({

                    email:
                        cleanEmail,

                    password:
                        cleanPassword

                });


            if (result.error) {

                console.error(
                    "Web3Market login error:",
                    result.error
                );


                showMessage(
                    formatAuthError(
                        result.error
                    ),
                    "error"
                );


                return {

                    success: false,

                    error:
                        formatAuthError(
                            result.error
                        ),

                    rawError:
                        result.error

                };
            }


            Web3MarketAuth.user =
                result.data?.user ||
                null;


            Web3MarketAuth.session =
                result.data?.session ||
                null;


            Web3MarketAuth.emailVerified =
                isEmailVerified(
                    Web3MarketAuth.user
                );


            syncAppState();


            dispatchAuthEvent(
                "signed_in"
            );


            /*
             * Supabase normally blocks password login
             * when email confirmation is required.
             *
             * This extra check protects the UI in case
             * the project's email policy changes.
             */

            if (
                Web3MarketAuth.user &&
                !Web3MarketAuth.emailVerified
            ) {

                showMessage(
                    "Please verify your email before continuing.",
                    "warning"
                );


                return {

                    success: true,

                    requiresEmailVerification:
                        true,

                    user:
                        Web3MarketAuth.user,

                    session:
                        Web3MarketAuth.session

                };
            }


            showMessage(
                "Signed in successfully.",
                "success"
            );


            return {

                success: true,

                requiresEmailVerification:
                    false,

                user:
                    Web3MarketAuth.user,

                session:
                    Web3MarketAuth.session

            };

        } catch (error) {

            console.error(
                "Web3Market login exception:",
                error
            );


            showMessage(
                formatAuthError(error),
                "error"
            );


            return {

                success: false,

                error:
                    formatAuthError(error),

                rawError:
                    error

            };

        } finally {

            setLoading(false);
        }
    }


    /* =====================================================
       SIGN OUT
       ===================================================== */

    async function logout() {

        const supabase =
            getSupabase();


        if (!supabase) {

            return {

                success: false,

                error:
                    "Supabase client is not available."

            };
        }


        setLoading(true);


        try {

            const {
                error
            } =
                await supabase.auth.signOut();


            if (error) {

                console.error(
                    "Web3Market logout error:",
                    error
                );


                return {

                    success: false,

                    error:
                        formatAuthError(error)

                };
            }


            Web3MarketAuth.user =
                null;

            Web3MarketAuth.session =
                null;

            Web3MarketAuth.emailVerified =
                false;

            Web3MarketAuth.walletVerified =
                false;

            Web3MarketAuth.walletAddress =
                null;


            syncAppState();


            dispatchAuthEvent(
                "signed_out"
            );


            showMessage(
                "You have been signed out.",
                "success"
            );


            return {

                success: true

            };

        } catch (error) {

            console.error(
                "Web3Market logout exception:",
                error
            );


            return {

                success: false,

                error:
                    formatAuthError(error)

            };

        } finally {

            setLoading(false);
        }
    }


    /* =====================================================
       RESEND EMAIL CONFIRMATION
       ===================================================== */

    async function resendConfirmation(
        email
    ) {

        const supabase =
            getSupabase();


        if (!supabase) {

            return {

                success: false,

                error:
                    "Supabase client is not available."

            };
        }


        const cleanEmail =
            String(
                email || ""
            )
                .trim()
                .toLowerCase();


        if (!cleanEmail) {

            return {

                success: false,

                error:
                    "Please enter your email address."

            };
        }


        setLoading(true);


        try {

            const redirectUrl =
                getEmailRedirectUrl();


            const result =
                await supabase.auth.resend({

                    type:
                        "signup",

                    email:
                        cleanEmail,

                    options: {

                        emailRedirectTo:
                            redirectUrl

                    }

                });


            if (result.error) {

                showMessage(
                    formatAuthError(
                        result.error
                    ),
                    "error"
                );


                return {

                    success: false,

                    error:
                        formatAuthError(
                            result.error
                        )

                };
            }


            showMessage(
                "A new verification email has been sent.",
                "success"
            );


            return {

                success: true

            };

        } catch (error) {

            console.error(
                "Web3Market resend confirmation error:",
                error
            );


            showMessage(
                formatAuthError(error),
                "error"
            );


            return {

                success: false,

                error:
                    formatAuthError(error)

            };

        } finally {

            setLoading(false);
        }
    }


    /* =====================================================
       RESET PASSWORD
       ===================================================== */

    async function resetPassword(
        email
    ) {

        const supabase =
            getSupabase();


        if (!supabase) {

            return {

                success: false,

                error:
                    "Supabase client is not available."

            };
        }


        const cleanEmail =
            String(
                email || ""
            )
                .trim()
                .toLowerCase();


        if (!cleanEmail) {

            return {

                success: false,

                error:
                    "Please enter your email address."

            };
        }


        setLoading(true);


        try {

            const redirectUrl =
                getPasswordResetUrl();


            const result =
                await supabase.auth.resetPasswordForEmail(

                    cleanEmail,

                    {

                        redirectTo:
                            redirectUrl

                    }

                );


            if (result.error) {

                showMessage(
                    formatAuthError(
                        result.error
                    ),
                    "error"
                );


                return {

                    success: false,

                    error:
                        formatAuthError(
                            result.error
                        )

                };
            }


            showMessage(
                "Password reset instructions have been sent to your email.",
                "success"
            );


            return {

                success: true

            };

        } catch (error) {

            console.error(
                "Web3Market password reset error:",
                error
            );


            showMessage(
                formatAuthError(error),
                "error"
            );


            return {

                success: false,

                error:
                    formatAuthError(error)

            };

        } finally {

            setLoading(false);
        }
    }


    /* =====================================================
       CONNECT + VERIFY WALLET
       ===================================================== */

    async function connectAndVerifyWallet() {

        if (
            !window.Web3MarketWallet
        ) {

            showMessage(
                "Wallet module is not loaded.",
                "error"
            );


            return {

                success: false,

                error:
                    "WALLET_MODULE_NOT_LOADED"

            };
        }


        /*
         * User must be authenticated first.
         */

        const user =
            Web3MarketAuth.user ||
            await getUser();


        if (!user) {

            showMessage(
                "Please create an account or sign in before connecting your wallet.",
                "warning"
            );


            return {

                success: false,

                error:
                    "AUTH_REQUIRED"

            };
        }


        /*
         * Email must be verified first.
         */

        if (
            !isEmailVerified(user)
        ) {

            showMessage(
                "Please verify your email before connecting your wallet.",
                "warning"
            );


            return {

                success: false,

                error:
                    "EMAIL_NOT_VERIFIED"

            };
        }


        setLoading(true);


        try {

            const connection =
                await window.Web3MarketWallet.connect();


            if (
                !connection ||
                !connection.success
            ) {

                return {

                    success: false,

                    error:
                        connection?.error ||
                        "WALLET_CONNECTION_FAILED"

                };
            }


            const verification =
                await window.Web3MarketWallet.verifyOwnership();


            if (
                !verification ||
                !verification.success
            ) {

                return {

                    success: false,

                    error:
                        verification?.error ||
                        "WALLET_VERIFICATION_FAILED"

                };
            }


            Web3MarketAuth.walletAddress =
                verification.address;


            Web3MarketAuth.walletVerified =
                true;


            syncAppState();


            dispatchAuthEvent(
                "wallet_verified"
            );


            showMessage(
                "Your wallet has been successfully verified.",
                "success"
            );


            return {

                success: true,

                address:
                    verification.address,

                signature:
                    verification.signature,

                message:
                    verification.message

            };

        } catch (error) {

            console.error(
                "Web3Market wallet verification error:",
                error
            );


            showMessage(
                error?.message ||
                "Wallet verification failed.",
                "error"
            );


            return {

                success: false,

                error:
                    error?.message ||
                    "WALLET_VERIFICATION_FAILED"

            };

        } finally {

            setLoading(false);
        }
    }


    /* =====================================================
       CHECK ACCOUNT STATUS
       ===================================================== */

    async function getAccountStatus() {

        const user =
            Web3MarketAuth.user ||
            await getUser();


        if (!user) {

            return {

                authenticated: false,

                emailVerified: false,

                walletConnected: false,

                walletVerified: false,

                ready: false

            };
        }


        const emailVerified =
            isEmailVerified(user);


        let walletConnected =
            Boolean(
                Web3MarketAuth.walletAddress
            );


        let walletAddress =
            Web3MarketAuth.walletAddress ||
            null;


        if (
            window.Web3MarketWallet &&
            typeof
            window.Web3MarketWallet.getState ===
            "function"
        ) {

            const walletState =
                window.Web3MarketWallet.getState();


            walletConnected =
                Boolean(
                    walletState?.connected
                );


            walletAddress =
                walletState?.address ||
                walletAddress;
        }


        const walletVerified =
            Boolean(
                Web3MarketAuth.walletVerified
            );


        return {

            authenticated: true,

            emailVerified:
                emailVerified,

            walletConnected:
                walletConnected,

            walletVerified:
                walletVerified,

            walletAddress:
                walletAddress,

            ready:
                emailVerified &&
                walletVerified

        };
    }


    /* =====================================================
       EMAIL REDIRECT URL
       ===================================================== */

    function getEmailRedirectUrl() {

        /*
         * The current page is used as the default
         * callback so the project works correctly
         * on GitHub Pages and other static hosting.
         */

        try {

            const url =
                new URL(
                    window.location.href
                );


            url.search = "";

            url.hash = "";


            return url.href;

        } catch (error) {

            return window.location.href;
        }
    }


    /* =====================================================
       PASSWORD RESET URL
       ===================================================== */

    function getPasswordResetUrl() {

        try {

            const url =
                new URL(
                    window.location.href
                );


            url.search = "";

            url.hash = "";


            return url.href;

        } catch (error) {

            return window.location.href;
        }
    }


    /* =====================================================
       SYNC APP STATE
       ===================================================== */

    function syncAppState() {

        if (
            window.Web3MarketApp &&
            typeof
            window.Web3MarketApp.setCurrentUser ===
            "function"
        ) {

            window.Web3MarketApp.setCurrentUser(
                Web3MarketAuth.user
            );
        }


        if (
            Web3MarketAuth.walletAddress &&
            window.Web3MarketApp &&
            typeof
            window.Web3MarketApp.setWalletState ===
            "function"
        ) {

            window.Web3MarketApp.setWalletState(
                Web3MarketAuth.walletAddress
            );
        }
    }


    /* =====================================================
       AUTH EVENT
       ===================================================== */

    function dispatchAuthEvent(
        type
    ) {

        try {

            window.dispatchEvent(
                new CustomEvent(
                    "web3market:auth",
                    {
                        detail: {

                            type:
                                type,

                            user:
                                Web3MarketAuth.user,

                            session:
                                Web3MarketAuth.session,

                            emailVerified:
                                Web3MarketAuth.emailVerified,

                            walletVerified:
                                Web3MarketAuth.walletVerified,

                            walletAddress:
                                Web3MarketAuth.walletAddress

                        }
                    }
                )
            );

        } catch (error) {

            console.warn(
                "Web3Market auth event error:",
                error
            );
        }
    }


    /* =====================================================
       AUTH STATE CHANGE
       ===================================================== */

    function setupAuthListener() {

        const supabase =
            getSupabase();


        if (!supabase) {

            console.error(
                "Web3Market Auth: Supabase is not available."
            );

            return;
        }


        if (
            Web3MarketAuth.__listenerInstalled
        ) {

            return;
        }


        Web3MarketAuth.__listenerInstalled =
            true;


        supabase.auth.onAuthStateChange(
            async function (
                event,
                session
            ) {

                console.log(
                    "Web3Market Auth Event:",
                    event
                );


                Web3MarketAuth.session =
                    session ||
                    null;


                Web3MarketAuth.user =
                    session?.user ||
                    null;


                Web3MarketAuth.emailVerified =
                    isEmailVerified(
                        Web3MarketAuth.user
                    );


                syncAppState();


                dispatchAuthEvent(
                    event
                );
            }
        );
    }


    /* =====================================================
       HANDLE EMAIL CALLBACK
       ===================================================== */

    async function handleEmailCallback() {

        const params =
            new URLSearchParams(
                window.location.search
            );


        const hash =
            window.location.hash ||
            "";


        /*
         * Supabase may return authentication
         * parameters in the URL/hash.
         *
         * The Supabase client handles the session.
         * We only refresh our application state here.
         */

        if (
            params.has("code") ||
            hash.includes("access_token") ||
            hash.includes("refresh_token")
        ) {

            const session =
                await getSession();


            if (session) {

                Web3MarketAuth.session =
                    session;

                Web3MarketAuth.user =
                    session.user ||
                    null;

                Web3MarketAuth.emailVerified =
                    isEmailVerified(
                        Web3MarketAuth.user
                    );


                syncAppState();


                dispatchAuthEvent(
                    "email_verified"
                );


                /*
                 * Remove authentication parameters
                 * from the visible URL without reloading.
                 */

                try {

                    const cleanUrl =
                        window.location.pathname +
                        window.location.search
                            .replace(
                                /([?&])code=[^&]*/g,
                                ""
                            ) +
                        window.location.hash;


                    /*
                     * Do not aggressively modify the URL
                     * because Supabase may still need its
                     * callback parameters.
                     */

                    if (
                        history.replaceState
                    ) {

                        history.replaceState(
                            {},
                            document.title,
                            window.location.pathname
                        );
                    }

                } catch (error) {

                    console.warn(
                        "Web3Market callback URL cleanup:",
                        error
                    );
                }
            }
        }
    }


    /* =====================================================
       LOADING
       ===================================================== */

    function setLoading(
        loading
    ) {

        Web3MarketAuth.loading =
            Boolean(loading);


        if (
            window.Web3MarketApp &&
            typeof
            window.Web3MarketApp.setLoading ===
            "function"
        ) {

            window.Web3MarketApp.setLoading(
                Web3MarketAuth.loading
            );
        }


        document.documentElement.classList.toggle(
            "web3market-auth-loading",
            Web3MarketAuth.loading
        );
    }


    /* =====================================================
       MESSAGE
       ===================================================== */

    function showMessage(
        message,
        type = "info"
    ) {

        if (
            window.Web3MarketApp &&
            typeof
            window.Web3MarketApp.showMessage ===
            "function"
        ) {

            window.Web3MarketApp.showMessage(
                message,
                type
            );

            return;
        }


        console.log(
            "Web3Market:",
            message
        );
    }


    /* =====================================================
       AUTH ERROR FORMATTER
       ===================================================== */

    function formatAuthError(
        error
    ) {

        if (!error) {

            return "An unknown authentication error occurred.";
        }


        const message =
            String(
                error.message ||
                error.error_description ||
                error.msg ||
                error
            );


        const lower =
            message.toLowerCase();


        if (
            lower.includes(
                "invalid login credentials"
            )
        ) {

            return "Invalid email or password.";
        }


        if (
            lower.includes(
                "email not confirmed"
            )
        ) {

            return "Please confirm your email address before signing in.";
        }


        if (
            lower.includes(
                "user already registered"
            )
        ) {

            return "This email address is already registered.";
        }


        if (
            lower.includes(
                "password should be at least"
            )
        ) {

            return "Password is too short.";
        }


        if (
            lower.includes(
                "rate limit"
            ) ||
            lower.includes(
                "too many requests"
            )
        ) {

            return "Too many requests. Please wait a moment and try again.";
        }


        if (
            lower.includes(
                "email rate limit"
            )
        ) {

            return "Email sending is temporarily rate-limited. Please wait before requesting another email.";
        }


        return message;
    }


    /* =====================================================
       GET STATE
       ===================================================== */

    function getState() {

        return {

            initialized:
                Web3MarketAuth.initialized,

            loading:
                Web3MarketAuth.loading,

            user:
                Web3MarketAuth.user,

            session:
                Web3MarketAuth.session,

            emailVerified:
                Web3MarketAuth.emailVerified,

            walletVerified:
                Web3MarketAuth.walletVerified,

            walletAddress:
                Web3MarketAuth.walletAddress

        };
    }


    /* =====================================================
       INITIALIZE
       ===================================================== */

    async function init() {

        if (
            Web3MarketAuth.initialized
        ) {

            return;
        }


        Web3MarketAuth.initialized =
            true;


        try {

            const session =
                await getSession();


            Web3MarketAuth.session =
                session ||
                null;


            Web3MarketAuth.user =
                session?.user ||
                null;


            Web3MarketAuth.emailVerified =
                isEmailVerified(
                    Web3MarketAuth.user
                );


            setupAuthListener();


            await handleEmailCallback();


            /*
             * Restore wallet state if the wallet
             * module is already available.
             */

            if (
                window.Web3MarketWallet &&
                typeof
                window.Web3MarketWallet.getState ===
                "function"
            ) {

                const walletState =
                    window.Web3MarketWallet.getState();


                if (
                    walletState?.address
                ) {

                    Web3MarketAuth.walletAddress =
                        walletState.address;
                }
            }


            syncAppState();


            dispatchAuthEvent(
                "initialized"
            );


            console.log(
                "Web3Market Auth initialized."
            );

        } catch (error) {

            console.error(
                "Web3Market Auth initialization error:",
                error
            );


            Web3MarketAuth.initialized =
                false;
        }
    }


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.Web3MarketAuth = {

        version:
            "2.0.0",

        init:
            init,

        register:
            register,

        signup:
            register,

        login:
            login,

        signin:
            login,

        logout:
            logout,

        signout:
            logout,

        resendConfirmation:
            resendConfirmation,

        resetPassword:
            resetPassword,

        connectAndVerifyWallet:
            connectAndVerifyWallet,

        getUser:
            getUser,

        getSession:
            getSession,

        getAccountStatus:
            getAccountStatus,

        isEmailVerified:
            function () {
                return Web3MarketAuth.emailVerified;
            },

        isWalletVerified:
            function () {
                return Web3MarketAuth.walletVerified;
            },

        getState:
            getState,

        getEmailRedirectUrl:
            getEmailRedirectUrl
    };


    /* =====================================================
       GLOBAL COMPATIBILITY
       ===================================================== */

    window.getWeb3MarketUser =
        getUser;

    window.getWeb3MarketSession =
        getSession;


    /* =====================================================
       START
       ===================================================== */

    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            init,
            {
                once: true
            }
        );

    } else {

        init();
    }

})();
