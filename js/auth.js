/* =========================================================
   Web3Market
   File: js/auth.js
   Unified Authentication System
   Version: 1.0
   ========================================================= */

"use strict";

(function () {

    /* =====================================================
       GLOBAL STATE
       ===================================================== */

    const Web3MarketAuth = {

        initialized: false,

        currentUser: null,

        currentSession: null,

        accountType: null,

        loading: false

    };


    /* =====================================================
       SUPABASE
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
            window.supabaseClient &&
            typeof window.supabaseClient.from ===
                "function"
        ) {

            return window.supabaseClient;
        }


        console.error(
            "Web3Market Auth: Supabase client is unavailable."
        );

        return null;
    }


    /* =====================================================
       INITIALIZE
       ===================================================== */

    async function initialize() {

        if (
            Web3MarketAuth.initialized
        ) {

            return Web3MarketAuth;
        }


        const supabase =
            getSupabase();


        if (!supabase) {

            console.error(
                "Web3Market Auth: initialization failed."
            );

            return Web3MarketAuth;
        }


        Web3MarketAuth.initialized =
            true;


        try {

            const session =
                await getSession();


            if (
                session &&
                session.user
            ) {

                Web3MarketAuth.currentSession =
                    session;

                Web3MarketAuth.currentUser =
                    session.user;


                Web3MarketAuth.accountType =
                    await getAccountType(
                        session.user.id
                    );


                syncUserWithApp();
            }


        } catch (error) {

            console.error(
                "Web3Market Auth initialization error:",
                error
            );
        }


        setupAuthListener();

        setupAuthForms();

        updateAuthUI();


        console.log(
            "Web3Market Auth initialized successfully."
        );


        return Web3MarketAuth;
    }


    /* =====================================================
       SESSION
       ===================================================== */

    async function getSession() {

        if (
            window.Web3MarketSupabase &&
            typeof window.Web3MarketSupabase.getSession ===
                "function"
        ) {

            return await window.Web3MarketSupabase.getSession();
        }


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

                console.error(
                    "Web3Market Auth getSession:",
                    error
                );

                return null;
            }


            return data?.session || null;

        } catch (error) {

            console.error(
                "Web3Market Auth getSession exception:",
                error
            );

            return null;
        }
    }


    /* =====================================================
       CURRENT USER
       ===================================================== */

    async function getCurrentUser() {

        if (
            Web3MarketAuth.currentUser
        ) {

            return Web3MarketAuth.currentUser;
        }


        if (
            window.Web3MarketSupabase &&
            typeof window.Web3MarketSupabase.getUser ===
                "function"
        ) {

            const user =
                await window.Web3MarketSupabase.getUser();


            Web3MarketAuth.currentUser =
                user || null;


            return user || null;
        }


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

                return null;
            }


            Web3MarketAuth.currentUser =
                data?.user || null;


            return (
                Web3MarketAuth.currentUser ||
                null
            );

        } catch (error) {

            console.error(
                "Web3Market Auth getUser:",
                error
            );

            return null;
        }
    }


    /* =====================================================
       EMAIL CONFIRMATION
       ===================================================== */

    function isEmailConfirmed(user) {

        if (!user) {
            return false;
        }


        return Boolean(
            user.email_confirmed_at ||
            user.confirmed_at
        );
    }


    /* =====================================================
       NORMALIZE ACCOUNT TYPE
       ===================================================== */

    function normalizeAccountType(value) {

        if (
            value === null ||
            value === undefined
        ) {

            return null;
        }


        const type =
            String(value)
                .trim()
                .toLowerCase();


        if (
            [
                "admin",
                "administrator",
                "superadmin",
                "super_admin"
            ].includes(type)
        ) {

            return "admin";
        }


        if (
            [
                "seller",
                "vendor",
                "owner",
                "developer",
                "company",
                "business",
                "seller_account"
            ].includes(type)
        ) {

            return "seller";
        }


        if (
            [
                "buyer",
                "user",
                "customer",
                "individual",
                "investor",
                "buyer_account"
            ].includes(type)
        ) {

            return "buyer";
        }


        return null;
    }


    /* =====================================================
       FIND ACCOUNT TYPE
       ===================================================== */

    function findAccountType(object) {

        if (!object) {
            return null;
        }


        const values = [

            object.account_type,

            object.accountType,

            object.role,

            object.user_type,

            object.userType,

            object.type

        ];


        for (
            const value of values
        ) {

            const type =
                normalizeAccountType(
                    value
                );


            if (type) {
                return type;
            }
        }


        return null;
    }


    /* =====================================================
       GET ACCOUNT TYPE
       ===================================================== */

    async function getAccountType(
        userId = null
    ) {

        const supabase =
            getSupabase();


        if (!supabase) {
            return null;
        }


        const user =
            await getCurrentUser();


        const id =
            userId ||
            user?.id;


        if (!id) {
            return null;
        }


        /* -------------------------------------------------
           1. ADMIN
        ------------------------------------------------- */

        try {

            const {
                data,
                error
            } =
                await supabase
                    .from("profiles")
                    .select("*")
                    .eq("id", id)
                    .maybeSingle();


            if (
                !error &&
                data
            ) {

                const type =
                    findAccountType(data);


                if (type) {
                    return type;
                }
            }

        } catch (error) {

            console.warn(
                "Web3Market profiles.id:",
                error
            );
        }


        /* -------------------------------------------------
           2. PROFILE BY USER ID
        ------------------------------------------------- */

        try {

            const {
                data,
                error
            } =
                await supabase
                    .from("profiles")
                    .select("*")
                    .eq("user_id", id)
                    .maybeSingle();


            if (
                !error &&
                data
            ) {

                const type =
                    findAccountType(data);


                if (type) {
                    return type;
                }
            }

        } catch (error) {

            console.warn(
                "Web3Market profiles.user_id:",
                error
            );
        }


        /* -------------------------------------------------
           3. USER METADATA
        ------------------------------------------------- */

        const metadata =
            user?.user_metadata || {};


        const metadataType =
            findAccountType(
                metadata
            );


        if (metadataType) {

            return metadataType;
        }


        /* -------------------------------------------------
           4. SELLER PROFILE
        ------------------------------------------------- */

        try {

            const {
                data,
                error
            } =
                await supabase
                    .from("seller_profiles")
                    .select("*")
                    .eq("user_id", id)
                    .maybeSingle();


            if (
                !error &&
                data
            ) {

                return "seller";
            }

        } catch (error) {

            console.warn(
                "Web3Market seller_profiles:",
                error
            );
        }


        /* -------------------------------------------------
           5. SELLER PROJECTS
        ------------------------------------------------- */

        try {

            const {
                data,
                error
            } =
                await supabase
                    .from("projects")
                    .select("id")
                    .eq("seller_id", id)
                    .limit(1);


            if (
                !error &&
                Array.isArray(data) &&
                data.length > 0
            ) {

                return "seller";
            }

        } catch (error) {

            console.warn(
                "Web3Market projects seller check:",
                error
            );
        }


        /* -------------------------------------------------
           6. DEFAULT BUYER
        ------------------------------------------------- */

        return "buyer";
    }


    /* =====================================================
       SIGN UP
       ===================================================== */

    async function register(
        email,
        password,
        accountType = "buyer",
        metadata = {}
    ) {

        email =
            String(email || "")
                .trim()
                .toLowerCase();


        password =
            String(password || "");


        const type =
            normalizeAccountType(
                accountType
            ) || "buyer";


        if (!email) {

            showMessage(
                "يرجى إدخال البريد الإلكتروني.",
                "error"
            );

            return {
                success: false
            };
        }


        if (password.length < 6) {

            showMessage(
                "كلمة المرور يجب أن تكون 6 أحرف على الأقل.",
                "error"
            );

            return {
                success: false
            };
        }


        Web3MarketAuth.loading =
            true;


        try {

            const options = {

                data: {

                    ...metadata,

                    account_type:
                        type,

                    role:
                        type

                },

                emailRedirectTo:
                    getLoginUrl()
            };


            let result;


            if (
                window.Web3MarketSupabase &&
                typeof window.Web3MarketSupabase.signUp ===
                    "function"
            ) {

                result =
                    await window.Web3MarketSupabase.signUp(
                        email,
                        password,
                        options
                    );

            } else {

                const supabase =
                    getSupabase();


                if (!supabase) {

                    throw new Error(
                        "Supabase client is unavailable."
                    );
                }


                result =
                    await supabase.auth.signUp({

                        email,

                        password,

                        options
                    });
            }


            const {
                data,
                error
            } = result;


            if (error) {

                showAuthError(error);

                return {
                    success: false,
                    error
                };
            }


            if (
                data?.user
            ) {

                Web3MarketAuth.currentUser =
                    data.user;
            }


            showMessage(
                "تم إنشاء الحساب بنجاح. يرجى تأكيد البريد الإلكتروني.",
                "success"
            );


            return {

                success: true,

                user:
                    data?.user || null,

                session:
                    data?.session || null,

                accountType:
                    type,

                emailConfirmationRequired:
                    !data?.session

            };

        } catch (error) {

            console.error(
                "Web3Market registration error:",
                error
            );


            showAuthError(error);


            return {
                success: false,
                error
            };

        } finally {

            Web3MarketAuth.loading =
                false;
        }
    }


    /* =====================================================
       LOGIN
       ===================================================== */

    async function login(
        email,
        password
    ) {

        email =
            String(email || "")
                .trim()
                .toLowerCase();


        password =
            String(password || "");


        if (!email || !password) {

            showMessage(
                "يرجى إدخال البريد الإلكتروني وكلمة المرور.",
                "error"
            );

            return {
                success: false
            };
        }


        Web3MarketAuth.loading =
            true;


        try {

            let result;


            if (
                window.Web3MarketSupabase &&
                typeof window.Web3MarketSupabase.signIn ===
                    "function"
            ) {

                result =
                    await window.Web3MarketSupabase.signIn(
                        email,
                        password
                    );

            } else {

                const supabase =
                    getSupabase();


                if (!supabase) {

                    throw new Error(
                        "Supabase client is unavailable."
                    );
                }


                result =
                    await supabase.auth.signInWithPassword({

                        email,

                        password
                    });
            }


            const {
                data,
                error
            } = result;


            if (error) {

                showAuthError(error);

                return {
                    success: false,
                    error
                };
            }


            const user =
                data?.user;


            const session =
                data?.session;


            if (!user || !session) {

                showMessage(
                    "تعذر إنشاء جلسة تسجيل الدخول.",
                    "error"
                );

                return {
                    success: false
                };
            }


            if (
                !isEmailConfirmed(user)
            ) {

                await logout(
                    false
                );


                showMessage(
                    "يرجى تأكيد البريد الإلكتروني أولاً.",
                    "error"
                );


                return {
                    success: false,
                    emailNotConfirmed: true
                };
            }


            Web3MarketAuth.currentUser =
                user;


            Web3MarketAuth.currentSession =
                session;


            const accountType =
                await getAccountType(
                    user.id
                );


            Web3MarketAuth.accountType =
                accountType;


            saveLocalAuthState(
                user,
                accountType
            );


            syncUserWithApp();

            updateAuthUI();


            const dashboardUrl =
                getDashboardUrl(
                    accountType
                );


            showMessage(
                "تم تسجيل الدخول بنجاح.",
                "success"
            );


            return {

                success: true,

                user,

                session,

                accountType,

                dashboardUrl
            };

        } catch (error) {

            console.error(
                "Web3Market login error:",
                error
            );


            showAuthError(error);


            return {
                success: false,
                error
            };

        } finally {

            Web3MarketAuth.loading =
                false;
        }
    }


    /* =====================================================
       LOGOUT
       ===================================================== */

    async function logout(
        redirect = true
    ) {

        try {

            if (
                window.Web3MarketSupabase &&
                typeof window.Web3MarketSupabase.signOut ===
                    "function"
            ) {

                await window.Web3MarketSupabase.signOut();

            } else {

                const supabase =
                    getSupabase();


                if (supabase) {

                    await supabase.auth.signOut();
                }
            }

        } catch (error) {

            console.error(
                "Web3Market logout:",
                error
            );
        }


        Web3MarketAuth.currentUser =
            null;

        Web3MarketAuth.currentSession =
            null;

        Web3MarketAuth.accountType =
            null;


        clearLocalAuthState();

        syncUserWithApp();

        updateAuthUI();


        if (redirect) {

            window.location.href =
                getLoginUrl();
        }


        return true;
    }


    /* =====================================================
       RESEND CONFIRMATION
       ===================================================== */

    async function resendConfirmation(
        email
    ) {

        email =
            String(email || "")
                .trim()
                .toLowerCase();


        if (!email) {

            showMessage(
                "يرجى إدخال البريد الإلكتروني.",
                "error"
            );

            return false;
        }


        try {

            let result;


            if (
                window.Web3MarketSupabase &&
                typeof window.Web3MarketSupabase.resendConfirmation ===
                    "function"
            ) {

                result =
                    await window.Web3MarketSupabase.resendConfirmation(
                        email,
                        {
                            emailRedirectTo:
                                getLoginUrl()
                        }
                    );

            } else {

                const supabase =
                    getSupabase();


                if (!supabase) {
                    return false;
                }


                result =
                    await supabase.auth.resend({

                        type: "signup",

                        email,

                        options: {

                            emailRedirectTo:
                                getLoginUrl()
                        }
                    });
            }


            if (result?.error) {

                showAuthError(
                    result.error
                );

                return false;
            }


            showMessage(
                "تم إرسال رسالة تأكيد جديدة.",
                "success"
            );


            return true;

        } catch (error) {

            showAuthError(error);

            return false;
        }
    }


    /* =====================================================
       RESET PASSWORD
       ===================================================== */

    async function resetPassword(
        email
    ) {

        email =
            String(email || "")
                .trim()
                .toLowerCase();


        if (!email) {

            showMessage(
                "يرجى إدخال البريد الإلكتروني.",
                "error"
            );

            return false;
        }


        try {

            let result;


            if (
                window.Web3MarketSupabase &&
                typeof window.Web3MarketSupabase.resetPassword ===
                    "function"
            ) {

                result =
                    await window.Web3MarketSupabase.resetPassword(
                        email,
                        {
                            redirectTo:
                                getLoginUrl()
                        }
                    );

            } else {

                const supabase =
                    getSupabase();


                if (!supabase) {
                    return false;
                }


                result =
                    await supabase.auth.resetPasswordForEmail(
                        email,
                        {
                            redirectTo:
                                getLoginUrl()
                        }
                    );
            }


            if (result?.error) {

                showAuthError(
                    result.error
                );

                return false;
            }


            showMessage(
                "تم إرسال رابط إعادة تعيين كلمة المرور.",
                "success"
            );


            return true;

        } catch (error) {

            showAuthError(error);

            return false;
        }
    }


    /* =====================================================
       AUTH LISTENER
       ===================================================== */

    function setupAuthListener() {

        if (
            Web3MarketAuth.__listenerInitialized
        ) {

            return;
        }


        Web3MarketAuth.__listenerInitialized =
            true;


        if (
            window.Web3MarketSupabase &&
            typeof window.Web3MarketSupabase.onAuthStateChange ===
                "function"
        ) {

            window.Web3MarketSupabase.onAuthStateChange(
                async function (
                    event,
                    session
                ) {

                    console.log(
                        "Web3Market Auth:",
                        event
                    );


                    Web3MarketAuth.currentSession =
                        session || null;


                    Web3MarketAuth.currentUser =
                        session?.user || null;


                    if (
                        session?.user
                    ) {

                        Web3MarketAuth.accountType =
                            await getAccountType(
                                session.user.id
                            );

                        saveLocalAuthState(
                            session.user,
                            Web3MarketAuth.accountType
                        );

                    } else {

                        Web3MarketAuth.accountType =
                            null;

                        clearLocalAuthState();
                    }


                    syncUserWithApp();

                    updateAuthUI();
                }
            );
        }
    }


    /* =====================================================
       SYNC WITH APP.JS
       ===================================================== */

    function syncUserWithApp() {

        if (
            window.Web3MarketApp &&
            typeof window.Web3MarketApp.setCurrentUser ===
                "function"
        ) {

            window.Web3MarketApp.setCurrentUser(
                Web3MarketAuth.currentUser
            );
        }
    }


    /* =====================================================
       LOCAL STORAGE
       ===================================================== */

    function saveLocalAuthState(
        user,
        accountType
    ) {

        try {

            if (user?.id) {

                localStorage.setItem(
                    "web3market_user_id",
                    user.id
                );
            }


            if (accountType) {

                localStorage.setItem(
                    "web3market_account_type",
                    accountType
                );
            }


        } catch (error) {

            console.warn(
                "Web3Market localStorage:",
                error
            );
        }
    }


    function clearLocalAuthState() {

        try {

            localStorage.removeItem(
                "web3market_user_id"
            );

            localStorage.removeItem(
                "web3market_account_type"
            );

        } catch (error) {

            console.warn(
                "Web3Market localStorage:",
                error
            );
        }
    }


    /* =====================================================
       URL HELPERS
       ===================================================== */

    function getBaseUrl() {

        const path =
            window.location.pathname;


        const index =
            path.lastIndexOf("/");


        const directory =
            index >= 0
                ? path.substring(
                    0,
                    index + 1
                )
                : "/";


        return (
            window.location.origin +
            directory
        );
    }


    function getLoginUrl() {

        return (
            getBaseUrl() +
            "login.html"
        );
    }


    function getDashboardUrl(
        accountType
    ) {

        const type =
            normalizeAccountType(
                accountType
            );


        if (
            type === "admin"
        ) {

            return (
                getBaseUrl() +
                "admin-dashboard.html"
            );
        }


        if (
            type === "seller"
        ) {

            return (
                getBaseUrl() +
                "seller-dashboard.html"
            );
        }


        return (
            getBaseUrl() +
            "dashboard.html"
        );
    }


    /* =====================================================
       PROTECT PAGE
       ===================================================== */

    async function protectPage(
        requiredAccountType = null
    ) {

        const session =
            await getSession();


        if (
            !session?.user
        ) {

            window.location.replace(
                getLoginUrl()
            );

            return false;
        }


        if (
            !isEmailConfirmed(
                session.user
            )
        ) {

            await logout(
                false
            );


            window.location.replace(
                getLoginUrl()
            );

            return false;
        }


        const accountType =
            await getAccountType(
                session.user.id
            );


        Web3MarketAuth.currentUser =
            session.user;

        Web3MarketAuth.currentSession =
            session;

        Web3MarketAuth.accountType =
            accountType;


        if (
            requiredAccountType
        ) {

            const required =
                normalizeAccountType(
                    requiredAccountType
                );


            if (
                required &&
                accountType !== required
            ) {

                window.location.replace(
                    getDashboardUrl(
                        accountType
                    )
                );

                return false;
            }
        }


        syncUserWithApp();

        updateAuthUI();


        return {

            authenticated:
                true,

            user:
                session.user,

            session,

            accountType
        };
    }


    /* =====================================================
       AUTH FORMS
       ===================================================== */

    function setupAuthForms() {

        const loginForm =
            document.querySelector(
                "#login-form, " +
                "#loginForm, " +
                "[data-login-form]"
            );


        if (loginForm) {

            if (
                loginForm.dataset.web3marketAuthInitialized !==
                    "true"
            ) {

                loginForm.dataset.web3marketAuthInitialized =
                    "true";


                loginForm.addEventListener(
                    "submit",
                    async function (event) {

                        event.preventDefault();


                        const email =
                            loginForm.querySelector(
                                'input[type="email"], #email, [name="email"]'
                            )?.value;


                        const password =
                            loginForm.querySelector(
                                'input[type="password"], #password, [name="password"]'
                            )?.value;


                        const result =
                            await login(
                                email,
                                password
                            );


                        if (
                            result.success
                        ) {

                            window.location.href =
                                result.dashboardUrl;
                        }
                    }
                );
            }
        }


        const registerForm =
            document.querySelector(
                "#register-form, " +
                "#registerForm, " +
                "#signup-form, " +
                "#signupForm, " +
                "[data-register-form]"
            );


        if (registerForm) {

            if (
                registerForm.dataset.web3marketAuthInitialized !==
                    "true"
            ) {

                registerForm.dataset.web3marketAuthInitialized =
                    "true";


                registerForm.addEventListener(
                    "submit",
                    async function (event) {

                        event.preventDefault();


                        const email =
                            registerForm.querySelector(
                                'input[type="email"], #email, [name="email"]'
                            )?.value;


                        const password =
                            registerForm.querySelector(
                                'input[type="password"], #password, [name="password"]'
                            )?.value;


                        const accountTypeElement =
                            registerForm.querySelector(
                                "#account-type, " +
                                "#accountType, " +
                                "[name='account_type'], " +
                                "[name='accountType'], " +
                                "[data-account-type]"
                            );


                        const accountType =
                            accountTypeElement
                                ? accountTypeElement.value
                                : "buyer";


                        const result =
                            await register(
                                email,
                                password,
                                accountType
                            );


                        if (
                            result.success
                        ) {

                            if (
                                result.emailConfirmationRequired
                            ) {

                                return;
                            }


                            window.location.href =
                                getDashboardUrl(
                                    result.accountType
                                );
                        }
                    }
                );
            }
        }


        const logoutButtons =
            document.querySelectorAll(
                "#logout, " +
                "#logout-button, " +
                ".logout-button, " +
                "[data-logout]"
            );


        logoutButtons.forEach(
            function (button) {

                if (
                    button.dataset.web3marketLogoutInitialized ===
                        "true"
                ) {

                    return;
                }


                button.dataset.web3marketLogoutInitialized =
                    "true";


                button.addEventListener(
                    "click",
                    async function (event) {

                        event.preventDefault();

                        await logout();
                    }
                );
            }
        );


        const resetForm =
            document.querySelector(
                "#reset-password-form, " +
                "#resetPasswordForm, " +
                "[data-reset-password-form]"
            );


        if (resetForm) {

            if (
                resetForm.dataset.web3marketAuthInitialized !==
                    "true"
            ) {

                resetForm.dataset.web3marketAuthInitialized =
                    "true";


                resetForm.addEventListener(
                    "submit",
                    async function (event) {

                        event.preventDefault();


                        const email =
                            resetForm.querySelector(
                                'input[type="email"], #email, [name="email"]'
                            )?.value;


                        await resetPassword(
                            email
                        );
                    }
                );
            }
        }
    }


    /* =====================================================
       AUTH UI
       ===================================================== */

    function updateAuthUI() {

        const user =
            Web3MarketAuth.currentUser;


        const loggedIn =
            Boolean(user);


        document.querySelectorAll(
            "[data-auth-user]"
        ).forEach(
            function (element) {

                element.textContent =
                    user?.email || "";
            }
        );


        document.querySelectorAll(
            "[data-auth-account-type]"
        ).forEach(
            function (element) {

                element.textContent =
                    Web3MarketAuth.accountType || "";
            }
        );


        document.querySelectorAll(
            "[data-auth-logged-in]"
        ).forEach(
            function (element) {

                element.style.display =
                    loggedIn
                        ? ""
                        : "none";
            }
        );


        document.querySelectorAll(
            "[data-auth-logged-out]"
        ).forEach(
            function (element) {

                element.style.display =
                    loggedIn
                        ? "none"
                        : "";
            }
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
            typeof window.Web3MarketApp.showMessage ===
                "function"
        ) {

            window.Web3MarketApp.showMessage(
                message,
                type
            );

            return;
        }


        let element =
            document.getElementById(
                "web3market-auth-message"
            );


        if (!element) {

            element =
                document.createElement(
                    "div"
                );


            element.id =
                "web3market-auth-message";


            Object.assign(
                element.style,
                {

                    position: "fixed",

                    top: "20px",

                    right: "20px",

                    zIndex: "999999",

                    padding: "14px 18px",

                    borderRadius: "12px",

                    maxWidth: "380px",

                    fontFamily:
                        "inherit",

                    boxShadow:
                        "0 10px 30px rgba(0,0,0,.25)"

                }
            );


            document.body.appendChild(
                element
            );
        }


        element.textContent =
            String(
                message || ""
            );


        if (
            type === "success"
        ) {

            element.style.background =
                "#198754";

            element.style.color =
                "#ffffff";

        } else if (
            type === "error"
        ) {

            element.style.background =
                "#dc3545";

            element.style.color =
                "#ffffff";

        } else {

            element.style.background =
                "#212529";

            element.style.color =
                "#ffffff";
        }


        element.style.display =
            "block";


        clearTimeout(
            element.__web3marketTimer
        );


        element.__web3marketTimer =
            setTimeout(
                function () {

                    element.style.display =
                        "none";

                },
                5000
            );
    }


    /* =====================================================
       AUTH ERROR
       ===================================================== */

    function showAuthError(
        error
    ) {

        const raw =
            String(
                error?.message ||
                error?.error_description ||
                error ||
                "Authentication failed."
            );


        const text =
            raw.toLowerCase();


        console.error(
            "Web3Market Auth Error:",
            error
        );


        if (
            text.includes(
                "invalid login credentials"
            )
        ) {

            showMessage(
                "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
                "error"
            );

            return;
        }


        if (
            text.includes(
                "email not confirmed"
            )
        ) {

            showMessage(
                "البريد الإلكتروني غير مؤكد.",
                "error"
            );

            return;
        }


        if (
            text.includes(
                "user already registered"
            )
        ) {

            showMessage(
                "هذا البريد الإلكتروني مسجل بالفعل.",
                "error"
            );

            return;
        }


        if (
            text.includes(
                "password should be at least"
            )
        ) {

            showMessage(
                "كلمة المرور قصيرة جدًا.",
                "error"
            );

            return;
        }


        if (
            text.includes(
                "rate limit"
            ) ||
            text.includes(
                "too many"
            )
        ) {

            showMessage(
                "تم تجاوز عدد المحاولات. حاول لاحقًا.",
                "error"
            );

            return;
        }


        if (
            text.includes(
                "failed to fetch"
            ) ||
            text.includes(
                "network"
            ) ||
            text.includes(
                "fetch"
            )
        ) {

            showMessage(
                "تعذر الاتصال بخادم Supabase.",
                "error"
            );

            return;
        }


        showMessage(
            "حدث خطأ: " + raw,
            "error"
        );
    }


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.Web3MarketAuth = {

        initialize:
            initialize,

        getSupabase:
            getSupabase,

        getSession:
            getSession,

        getCurrentUser:
            getCurrentUser,

        getAccountType:
            getAccountType,

        normalizeAccountType:
            normalizeAccountType,

        isEmailConfirmed:
            isEmailConfirmed,

        register:
            register,

        signup:
            register,

        signUp:
            register,

        login:
            login,

        signIn:
            login,

        logout:
            logout,

        signOut:
            logout,

        resendConfirmation:
            resendConfirmation,

        resetPassword:
            resetPassword,

        protectPage:
            protectPage,

        getDashboardUrl:
            getDashboardUrl,

        getLoginUrl:
            getLoginUrl,

        showMessage:
            showMessage,

        showError:
            showAuthError,

        getState:
            function () {

                return Web3MarketAuth;
            }
    };


    /* =====================================================
       BACKWARD COMPATIBILITY
       ===================================================== */

    window.getCurrentUser =
        getCurrentUser;

    window.getCurrentSession =
        getSession;

    window.getAccountType =
        getAccountType;

    window.loginUser =
        login;

    window.registerUser =
        register;

    window.logoutUser =
        logout;

    window.protectPage =
        protectPage;


    /* =====================================================
       START
       ===================================================== */

    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            initialize,
            {
                once: true
            }
        );

    } else {

        initialize();
    }


})();
