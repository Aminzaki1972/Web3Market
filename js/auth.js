/* =========================================================
   Web3Market
   File: js/auth.js
   Authentication Controller
   Version: 1.0
   ========================================================= */

"use strict";

(function () {

    /* =====================================================
       STATE
       ===================================================== */

    const Auth = {

        initialized: false,

        user: null,

        session: null,

        loading: false

    };


    /* =====================================================
       HELPERS
       ===================================================== */

    function getSupabase() {

        if (
            window.Web3MarketSupabase &&
            typeof window.Web3MarketSupabase.getClient ===
                "function"
        ) {
            return window.Web3MarketSupabase.getClient();
        }

        if (
            window.supabaseClient
        ) {
            return window.supabaseClient;
        }

        console.error(
            "Web3Market Auth: Supabase client is unavailable."
        );

        return null;
    }


    function showMessage(
        message,
        type = "info"
    ) {

        if (
            window.Web3MarketApp &&
            typeof window.Web3MarketApp.showMessage ===
                "function"
        ) {

            window.Web3MarketApp.showMessage(
                message,
                type
            );

            return;
        }

        const element =
            document.getElementById(
                "web3market-message"
            );

        if (!element) {
            alert(message);
            return;
        }

        element.textContent =
            String(message || "");

        element.style.display =
            "block";

        clearTimeout(
            element.__authTimer
        );

        element.__authTimer =
            setTimeout(
                function () {

                    element.style.display =
                        "none";

                },
                5000
            );
    }


    function setLoading(
        value
    ) {

        Auth.loading =
            Boolean(value);

        if (
            window.Web3MarketApp &&
            typeof window.Web3MarketApp.setLoading ===
                "function"
        ) {

            window.Web3MarketApp.setLoading(
                Auth.loading
            );
        }
    }


    function getInput(
        selectors
    ) {

        for (
            let i = 0;
            i < selectors.length;
            i++
        ) {

            const element =
                document.querySelector(
                    selectors[i]
                );

            if (element) {
                return element;
            }
        }

        return null;
    }


    function getEmailInput() {

        return getInput([
            "#email",
            "#login-email",
            "#register-email",
            "#auth-email",
            'input[type="email"]'
        ]);
    }


    function getPasswordInput() {

        return getInput([
            "#password",
            "#login-password",
            "#register-password",
            "#auth-password",
            'input[type="password"]'
        ]);
    }


    function getNameInput() {

        return getInput([
            "#name",
            "#full-name",
            "#fullName",
            "#register-name",
            "#auth-name"
        ]);
    }


    function getConfirmPasswordInput() {

        return getInput([
            "#confirm-password",
            "#confirmPassword",
            "#password-confirm",
            "#register-confirm-password"
        ]);
    }


    /* =====================================================
       ERROR MESSAGE
       ===================================================== */

    function formatAuthError(
        error
    ) {

        if (!error) {
            return "An unexpected authentication error occurred.";
        }

        const message =
            String(
                error.message ||
                error.error_description ||
                error.msg ||
                ""
            ).toLowerCase();


        if (
            message.includes(
                "invalid login credentials"
            )
        ) {

            return "Invalid email or password.";
        }


        if (
            message.includes(
                "email not confirmed"
            )
        ) {

            return "Please confirm your email address before signing in.";
        }


        if (
            message.includes(
                "user already registered"
            )
        ) {

            return "This email address is already registered.";
        }


        if (
            message.includes(
                "password"
            ) &&
            message.includes(
                "6"
            )
        ) {

            return "Password must meet the minimum security requirements.";
        }


        if (
            message.includes(
                "rate limit"
            ) ||
            message.includes(
                "too many requests"
            )
        ) {

            return "Too many requests. Please wait and try again.";
        }


        if (
            message.includes(
                "failed to fetch"
            )
        ) {

            return "Unable to connect to the authentication service.";
        }


        return (
            error.message ||
            "Authentication failed. Please try again."
        );
    }


    /* =====================================================
       SIGN UP
       ===================================================== */

    async function register(
        event
    ) {

        if (event) {
            event.preventDefault();
        }


        const api =
            window.Web3MarketSupabase;


        if (
            !api ||
            typeof api.signUp !==
                "function"
        ) {

            showMessage(
                "Authentication system is not available.",
                "error"
            );

            return false;
        }


        const emailInput =
            getEmailInput();

        const passwordInput =
            getPasswordInput();

        const nameInput =
            getNameInput();

        const confirmInput =
            getConfirmPasswordInput();


        const email =
            emailInput
                ? String(
                    emailInput.value || ""
                )
                    .trim()
                    .toLowerCase()
                : "";


        const password =
            passwordInput
                ? String(
                    passwordInput.value || ""
                )
                : "";


        const name =
            nameInput
                ? String(
                    nameInput.value || ""
                ).trim()
                : "";


        const confirmPassword =
            confirmInput
                ? String(
                    confirmInput.value || ""
                )
                : "";


        if (!email) {

            showMessage(
                "Please enter your email address.",
                "warning"
            );

            if (emailInput) {
                emailInput.focus();
            }

            return false;
        }


        if (!password) {

            showMessage(
                "Please enter a password.",
                "warning"
            );

            if (passwordInput) {
                passwordInput.focus();
            }

            return false;
        }


        if (
            confirmInput &&
            password !== confirmPassword
        ) {

            showMessage(
                "Passwords do not match.",
                "warning"
            );

            confirmInput.focus();

            return false;
        }


        if (
            password.length < 6
        ) {

            showMessage(
                "Password must contain at least 6 characters.",
                "warning"
            );

            passwordInput?.focus();

            return false;
        }


        setLoading(true);


        try {

            const metadata = {};


            if (name) {

                metadata.full_name =
                    name;

                metadata.name =
                    name;
            }


            metadata.platform =
                "Web3Market";


            metadata.account_type =
                "individual";


            const result =
                await api.signUp(
                    email,
                    password,
                    {
                        data:
                            metadata,

                        emailRedirectTo:
                            getRedirectUrl()
                    }
                );


            if (
                result &&
                result.error
            ) {

                console.error(
                    "Web3Market registration error:",
                    result.error
                );

                showMessage(
                    formatAuthError(
                        result.error
                    ),
                    "error"
                );

                return false;
            }


            const session =
                result?.data?.session ||
                null;


            const user =
                result?.data?.user ||
                null;


            Auth.session =
                session;

            Auth.user =
                user;


            if (
                session &&
                user
            ) {

                syncUser(
                    user
                );

                showMessage(
                    "Account created successfully.",
                    "success"
                );

                setTimeout(
                    function () {

                        redirectAfterAuth();

                    },
                    800
                );

            } else {

                showMessage(
                    "Account created. Please check your email to confirm your account.",
                    "success"
                );
            }


            return true;

        } catch (error) {

            console.error(
                "Web3Market registration exception:",
                error
            );

            showMessage(
                formatAuthError(error),
                "error"
            );

            return false;

        } finally {

            setLoading(false);
        }
    }


    /* =====================================================
       SIGN IN
       ===================================================== */

    async function login(
        event
    ) {

        if (event) {
            event.preventDefault();
        }


        const api =
            window.Web3MarketSupabase;


        if (
            !api ||
            typeof api.signIn !==
                "function"
        ) {

            showMessage(
                "Authentication system is not available.",
                "error"
            );

            return false;
        }


        const emailInput =
            getEmailInput();

        const passwordInput =
            getPasswordInput();


        const email =
            emailInput
                ? String(
                    emailInput.value || ""
                )
                    .trim()
                    .toLowerCase()
                : "";


        const password =
            passwordInput
                ? String(
                    passwordInput.value || ""
                )
                : "";


        if (!email) {

            showMessage(
                "Please enter your email address.",
                "warning"
            );

            emailInput?.focus();

            return false;
        }


        if (!password) {

            showMessage(
                "Please enter your password.",
                "warning"
            );

            passwordInput?.focus();

            return false;
        }


        setLoading(true);


        try {

            const result =
                await api.signIn(
                    email,
                    password
                );


            if (
                result &&
                result.error
            ) {

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

                return false;
            }


            const session =
                result?.data?.session ||
                null;


            const user =
                result?.data?.user ||
                null;


            if (!user) {

                showMessage(
                    "Login failed. No user session was returned.",
                    "error"
                );

                return false;
            }


            Auth.session =
                session;

            Auth.user =
                user;


            syncUser(
                user
            );


            showMessage(
                "Login successful.",
                "success"
            );


            setTimeout(
                function () {

                    redirectAfterAuth();

                },
                700
            );


            return true;

        } catch (error) {

            console.error(
                "Web3Market login exception:",
                error
            );

            showMessage(
                formatAuthError(error),
                "error"
            );

            return false;

        } finally {

            setLoading(false);
        }
    }


    /* =====================================================
       SIGN OUT
       ===================================================== */

    async function logout(
        event
    ) {

        if (event) {
            event.preventDefault();
        }


        const api =
            window.Web3MarketSupabase;


        if (
            !api ||
            typeof api.signOut !==
                "function"
        ) {

            return false;
        }


        setLoading(true);


        try {

            const success =
                await api.signOut();


            if (!success) {

                showMessage(
                    "Unable to sign out.",
                    "error"
                );

                return false;
            }


            Auth.user =
                null;

            Auth.session =
                null;


            if (
                window.Web3MarketApp &&
                typeof window.Web3MarketApp.setCurrentUser ===
                    "function"
            ) {

                window.Web3MarketApp.setCurrentUser(
                    null
                );
            }


            showMessage(
                "You have been signed out.",
                "success"
            );


            setTimeout(
                function () {

                    window.location.href =
                        getHomeUrl();

                },
                500
            );


            return true;

        } catch (error) {

            console.error(
                "Web3Market logout error:",
                error
            );

            showMessage(
                "Unable to sign out.",
                "error"
            );

            return false;

        } finally {

            setLoading(false);
        }
    }


    /* =====================================================
       RESET PASSWORD
       ===================================================== */

    async function resetPassword(
        event
    ) {

        if (event) {
            event.preventDefault();
        }


        const api =
            window.Web3MarketSupabase;


        if (
            !api ||
            typeof api.resetPassword !==
                "function"
        ) {

            showMessage(
                "Password reset service is unavailable.",
                "error"
            );

            return false;
        }


        const emailInput =
            getEmailInput();


        const email =
            emailInput
                ? String(
                    emailInput.value || ""
                )
                    .trim()
                    .toLowerCase()
                : "";


        if (!email) {

            showMessage(
                "Enter your email address first.",
                "warning"
            );

            emailInput?.focus();

            return false;
        }


        setLoading(true);


        try {

            const result =
                await api.resetPassword(
                    email,
                    {
                        redirectTo:
                            getPasswordResetUrl()
                    }
                );


            if (
                result &&
                result.error
            ) {

                showMessage(
                    formatAuthError(
                        result.error
                    ),
                    "error"
                );

                return false;
            }


            showMessage(
                "Password reset instructions have been sent to your email.",
                "success"
            );


            return true;

        } catch (error) {

            console.error(
                "Web3Market password reset:",
                error
            );

            showMessage(
                formatAuthError(error),
                "error"
            );

            return false;

        } finally {

            setLoading(false);
        }
    }


    /* =====================================================
       RESEND CONFIRMATION
       ===================================================== */

    async function resendConfirmation(
        event
    ) {

        if (event) {
            event.preventDefault();
        }


        const api =
            window.Web3MarketSupabase;


        if (
            !api ||
            typeof api.resendConfirmation !==
                "function"
        ) {

            showMessage(
                "Email confirmation service is unavailable.",
                "error"
            );

            return false;
        }


        const emailInput =
            getEmailInput();


        const email =
            emailInput
                ? String(
                    emailInput.value || ""
                )
                    .trim()
                    .toLowerCase()
                : "";


        if (!email) {

            showMessage(
                "Enter your email address first.",
                "warning"
            );

            emailInput?.focus();

            return false;
        }


        setLoading(true);


        try {

            const result =
                await api.resendConfirmation(
                    email,
                    {
                        emailRedirectTo:
                            getRedirectUrl()
                    }
                );


            if (
                result &&
                result.error
            ) {

                showMessage(
                    formatAuthError(
                        result.error
                    ),
                    "error"
                );

                return false;
            }


            showMessage(
                "A new confirmation email has been sent.",
                "success"
            );


            return true;

        } catch (error) {

            console.error(
                "Web3Market confirmation resend:",
                error
            );

            showMessage(
                formatAuthError(error),
                "error"
            );

            return false;

        } finally {

            setLoading(false);
        }
    }


    /* =====================================================
       SESSION
       ===================================================== */

    async function loadSession() {

        const api =
            window.Web3MarketSupabase;


        if (
            !api ||
            typeof api.getSession !==
                "function"
        ) {

            return null;
        }


        try {

            const session =
                await api.getSession();


            Auth.session =
                session;


            Auth.user =
                session?.user ||
                null;


            syncUser(
                Auth.user
            );


            return session;

        } catch (error) {

            console.error(
                "Web3Market session error:",
                error
            );

            return null;
        }
    }


    /* =====================================================
       USER SYNC
       ===================================================== */

    function syncUser(
        user
    ) {

        Auth.user =
            user || null;


        if (
            window.Web3MarketApp &&
            typeof window.Web3MarketApp.setCurrentUser ===
                "function"
        ) {

            window.Web3MarketApp.setCurrentUser(
                Auth.user
            );
        }


        updateAuthUI();
    }


    /* =====================================================
       AUTH UI
       ===================================================== */

    function updateAuthUI() {

        const user =
            Auth.user;


        const signedInElements =
            document.querySelectorAll(
                "[data-auth='signed-in'], " +
                ".auth-signed-in"
            );


        const signedOutElements =
            document.querySelectorAll(
                "[data-auth='signed-out'], " +
                ".auth-signed-out"
            );


        signedInElements.forEach(
            function (element) {

                element.style.display =
                    user
                        ? ""
                        : "none";
            }
        );


        signedOutElements.forEach(
            function (element) {

                element.style.display =
                    user
                        ? "none"
                        : "";
            }
        );


        const userEmailElements =
            document.querySelectorAll(
                "[data-user-email]"
            );


        userEmailElements.forEach(
            function (element) {

                element.textContent =
                    user?.email ||
                    "";
            }
        );


        const logoutButtons =
            document.querySelectorAll(
                "[data-logout], " +
                "#logout-button, " +
                ".logout-button"
            );


        logoutButtons.forEach(
            function (button) {

                if (
                    button.dataset.web3marketAuthInitialized ===
                    "true"
                ) {

                    return;
                }


                button.dataset.web3marketAuthInitialized =
                    "true";


                button.addEventListener(
                    "click",
                    logout
                );
            }
        );
    }


    /* =====================================================
       URL HELPERS
       ===================================================== */

    function getBaseUrl() {

        const path =
            window.location.pathname;


        if (
            path.includes(
                "/Web3Market/"
            )
        ) {

            return (
                window.location.origin +
                "/Web3Market/"
            );
        }


        return (
            window.location.origin +
            "/"
        );
    }


    function getHomeUrl() {

        return (
            getBaseUrl() +
            "index.html"
        );
    }


    function getRedirectUrl() {

        return getHomeUrl();
    }


    function getPasswordResetUrl() {

        return (
            getBaseUrl() +
            "login.html"
        );
    }


    function redirectAfterAuth() {

        const params =
            new URLSearchParams(
                window.location.search
            );


        const redirect =
            params.get(
                "redirect"
            );


        if (
            redirect &&
            (
                redirect.startsWith(
                    "/"
                ) ||
                redirect.startsWith(
                    getBaseUrl()
                )
            )
        ) {

            window.location.href =
                redirect;

            return;
        }


        /*
         * For now we return the user
         * to the marketplace.
         *
         * Dashboard can be added later
         * without changing the authentication
         * system.
         */

        window.location.href =
            getBaseUrl() +
            "marketplace.html";
    }


    /* =====================================================
       FORM SETUP
       ===================================================== */

    function setupForms() {

        const forms =
            document.querySelectorAll(
                "form"
            );


        forms.forEach(
            function (form) {

                if (
                    form.dataset.web3marketAuthInitialized ===
                    "true"
                ) {

                    return;
                }


                const action =
                    String(
                        form.dataset.authAction ||
                        form.id ||
                        form.getAttribute(
                            "name"
                        ) ||
                        ""
                    )
                        .toLowerCase();


                if (
                    action.includes(
                        "register"
                    ) ||
                    action.includes(
                        "signup"
                    ) ||
                    action.includes(
                        "sign-up"
                    )
                ) {

                    form.dataset.web3marketAuthInitialized =
                        "true";

                    form.addEventListener(
                        "submit",
                        register
                    );

                    return;
                }


                if (
                    action.includes(
                        "login"
                    ) ||
                    action.includes(
                        "signin"
                    ) ||
                    action.includes(
                        "sign-in"
                    )
                ) {

                    form.dataset.web3marketAuthInitialized =
                        "true";

                    form.addEventListener(
                        "submit",
                        login

                    );

                    return;
                }
            }
        );


        const loginButtons =
            document.querySelectorAll(
                "[data-login], " +
                "#login-button, " +
                ".login-button"
            );


        loginButtons.forEach(
            function (button) {

                if (
                    button.dataset.web3marketAuthInitialized ===
                    "true"
                ) {
                    return;
                }


                button.dataset.web3marketAuthInitialized =
                    "true";


                button.addEventListener(
                    "click",
                    login
                );
            }
        );


        const registerButtons =
            document.querySelectorAll(
                "[data-register], " +
                "#register-button, " +
                ".register-button"
            );


        registerButtons.forEach(
            function (button) {

                if (
                    button.dataset.web3marketAuthInitialized ===
                    "true"
                ) {
                    return;
                }


                button.dataset.web3marketAuthInitialized =
                    "true";


                button.addEventListener(
                    "click",
                    register
                );
            }
        );


        const resetButtons =
            document.querySelectorAll(
                "[data-reset-password], " +
                "#reset-password, " +
                ".reset-password"
            );


        resetButtons.forEach(
            function (button) {

                if (
                    button.dataset.web3marketAuthInitialized ===
                    "true"
                ) {
                    return;
                }


                button.dataset.web3marketAuthInitialized =
                    "true";


                button.addEventListener(
                    "click",
                    resetPassword
                );
            }
        );


        const resendButtons =
            document.querySelectorAll(
                "[data-resend-confirmation], " +
                "#resend-confirmation, " +
                ".resend-confirmation"
            );


        resendButtons.forEach(
            function (button) {

                if (
                    button.dataset.web3marketAuthInitialized ===
                    "true"
                ) {
                    return;
                }


                button.dataset.web3marketAuthInitialized =
                    "true";


                button.addEventListener(
                    "click",
                    resendConfirmation
                );
            }
        );


        updateAuthUI();
    }


    /* =====================================================
       AUTH LISTENER
       ===================================================== */

    function setupAuthListener() {

        const api =
            window.Web3MarketSupabase;


        if (
            !api ||
            typeof api.onAuthStateChange !==
                "function"
        ) {

            console.error(
                "Web3Market Auth: Auth API unavailable."
            );

            return;
        }


        try {

            api.onAuthStateChange(
                function (
                    event,
                    session
                ) {

                    Auth.session =
                        session ||
                        null;


                    Auth.user =
                        session?.user ||
                        null;


                    syncUser(
                        Auth.user
                    );


                    console.log(
                        "Web3Market auth event:",
                        event
                    );
                }
            );

        } catch (error) {

            console.error(
                "Web3Market auth listener error:",
                error
            );
        }
    }


    /* =====================================================
       INITIALIZATION
       ===================================================== */

    async function init() {

        if (
            Auth.initialized
        ) {

            return;
        }


        Auth.initialized =
            true;


        try {

            await loadSession();

            setupForms();

            setupAuthListener();

            updateAuthUI();


            console.log(
                "Web3Market Auth initialized successfully."
            );

        } catch (error) {

            console.error(
                "Web3Market Auth initialization error:",
                error
            );

            Auth.initialized =
                false;
        }
    }


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.Web3MarketAuth = {

        init:
            init,

        register:
            register,

        login:
            login,

        logout:
            logout,

        resetPassword:
            resetPassword,

        resendConfirmation:
            resendConfirmation,

        getUser:
            function () {
                return Auth.user;
            },

        getSession:
            function () {
                return Auth.session;
            },

        isAuthenticated:
            function () {
                return Boolean(
                    Auth.user
                );
            },

        getState:
            function () {
                return Auth;
            }
    };


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
