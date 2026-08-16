/* =========================================================
   Web3Market
   File: js/auth.js
   Unified Authentication
   Version: 1.0
   Uses js/supabase.js
   ========================================================= */

"use strict";

(function () {

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

        console.error(
            "Web3Market Auth: Supabase client is unavailable."
        );

        return null;
    }


    /* =====================================================
       CURRENT SESSION
       ===================================================== */

    async function getCurrentSession() {

        if (
            window.Web3MarketSupabase &&
            typeof window.Web3MarketSupabase.getSession ===
                "function"
        ) {

            return await window.Web3MarketSupabase.getSession();
        }

        return null;
    }


    /* =====================================================
       CURRENT USER
       ===================================================== */

    async function getCurrentUser() {

        if (
            window.Web3MarketSupabase &&
            typeof window.Web3MarketSupabase.getUser ===
                "function"
        ) {

            return await window.Web3MarketSupabase.getUser();
        }

        return null;
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
       ACCOUNT TYPE NORMALIZATION
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
                "super_admin",
                "admin_account"
            ].includes(type)
        ) {
            return "admin";
        }


        if (
            [
                "company",
                "companies",
                "business",
                "employer",
                "organization",
                "company_account",
                "company-account"
            ].includes(type)
        ) {
            return "company";
        }


        if (
            [
                "individual",
                "individuals",
                "person",
                "user",
                "candidate",
                "freelancer",
                "buyer",
                "seller",
                "individual_account",
                "individual-account"
            ].includes(type)
        ) {
            return "individual";
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


        /* =================================================
           1. AUTH METADATA
        ================================================= */

        const metadata =
            user?.user_metadata || {};


        const metadataType =
            findAccountType(
                metadata
            );


        if (metadataType) {

            return metadataType;
        }


        /* =================================================
           2. PROFILES TABLE
        ================================================= */

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
                    findAccountType(
                        data
                    );


                if (type) {
                    return type;
                }
            }

        } catch (error) {

            console.warn(
                "Web3Market profiles check:",
                error
            );
        }


        /* =================================================
           3. PROFILES BY USER ID
        ================================================= */

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
                    findAccountType(
                        data
                    );


                if (type) {
                    return type;
                }
            }

        } catch (error) {

            console.warn(
                "Web3Market profiles.user_id check:",
                error
            );
        }


        /* =================================================
           4. COMPANY PROFILES
        ================================================= */

        try {

            const {
                data,
                error
            } =
                await supabase
                    .from("company_profiles")
                    .select("*")
                    .eq("user_id", id)
                    .maybeSingle();


            if (
                !error &&
                data
            ) {

                return "company";
            }

        } catch (error) {

            /*
             * The table may not exist yet.
             * This must not break authentication.
             */

            console.warn(
                "Web3Market company_profiles check:",
                error
            );
        }


        /* =================================================
           5. COMPANY PROFILE BY ID
        ================================================= */

        try {

            const {
                data,
                error
            } =
                await supabase
                    .from("company_profiles")
                    .select("*")
                    .eq("id", id)
                    .maybeSingle();


            if (
                !error &&
                data
            ) {

                return "company";
            }

        } catch (error) {

            console.warn(
                "Web3Market company_profiles.id check:",
                error
            );
        }


        /* =================================================
           6. JOB / PROJECT OWNER FALLBACK
        ================================================= */

        try {

            const {
                data,
                error
            } =
                await supabase
                    .from("projects")
                    .select("id")
                    .eq("user_id", id)
                    .limit(1);


            if (
                !error &&
                Array.isArray(data) &&
                data.length > 0
            ) {

                return "company";
            }

        } catch (error) {

            /*
             * Projects table may not exist yet.
             */

            console.warn(
                "Web3Market projects account detection:",
                error
            );
        }


        /* =================================================
           7. DEFAULT INDIVIDUAL
        ================================================= */

        /*
         * A normal authenticated user is treated
         * as an individual unless another account
         * type was explicitly detected.
         */

        return "individual";
    }


    /* =====================================================
       BASE URL
       ===================================================== */

    function getBaseUrl() {

        const pathname =
            window.location.pathname;


        const lastSlash =
            pathname.lastIndexOf("/");


        const directory =
            lastSlash >= 0
                ? pathname.substring(
                    0,
                    lastSlash + 1
                )
                : "/";


        return (
            window.location.origin +
            directory
        );
    }


    /* =====================================================
       LOGIN URL
       ===================================================== */

    function getLoginUrl() {

        return (
            getBaseUrl() +
            "login.html"
        );
    }


    /* =====================================================
       HOME URL
       ===================================================== */

    function getHomeUrl() {

        return (
            getBaseUrl() +
            "index.html"
        );
    }


    /* =====================================================
       DASHBOARD URL
       ===================================================== */

    function getDashboardUrl(
        accountType
    ) {

        const type =
            normalizeAccountType(
                accountType
            );


        if (type === "admin") {

            return (
                getBaseUrl() +
                "admin-dashboard.html"
            );
        }


        if (type === "company") {

            return (
                getBaseUrl() +
                "company-dashboard.html"
            );
        }


        if (type === "individual") {

            return (
                getBaseUrl() +
                "dashboard.html"
            );
        }


        return getHomeUrl();
    }


    /* =====================================================
       SAVE AUTH DATA
       ===================================================== */

    function saveAuthData(
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
                "Web3Market auth localStorage:",
                error
            );
        }
    }


    /* =====================================================
       CLEAR AUTH DATA
       ===================================================== */

    function clearAuthData() {

        try {

            localStorage.removeItem(
                "web3market_user_id"
            );

            localStorage.removeItem(
                "web3market_account_type"
            );

        } catch (error) {

            console.warn(
                "Web3Market clear localStorage:",
                error
            );
        }
    }


    /* =====================================================
       LOGIN
       ===================================================== */

    async function login(
        email,
        password
    ) {

        if (
            !window.Web3MarketSupabase ||
            typeof window.Web3MarketSupabase.signIn !==
                "function"
        ) {

            showMessage(
                "تعذر الاتصال بخدمة تسجيل الدخول.",
                "Authentication service is unavailable.",
                "error"
            );

            return {
                success: false
            };
        }


        email =
            String(email || "")
                .trim()
                .toLowerCase();


        password =
            String(password || "");


        if (!email || !password) {

            showMessage(
                "يرجى إدخال البريد الإلكتروني وكلمة المرور.",
                "Please enter your email and password.",
                "error"
            );

            return {
                success: false
            };
        }


        try {

            const result =
                await window.Web3MarketSupabase.signIn(
                    email,
                    password
                );


            const data =
                result?.data;


            const error =
                result?.error;


            if (error) {

                showAuthError(
                    error
                );

                return {
                    success: false,
                    error: error
                };
            }


            const user =
                data?.user;


            const session =
                data?.session;


            if (
                !user ||
                !session
            ) {

                showMessage(
                    "تعذر إنشاء جلسة تسجيل الدخول.",
                    "Could not create a login session.",
                    "error"
                );

                return {
                    success: false
                };
            }


            /* ---------------------------------------------
               EMAIL CONFIRMATION
            --------------------------------------------- */

            if (
                !isEmailConfirmed(
                    user
                )
            ) {

                await logout(
                    false
                );


                showMessage(
                    "البريد الإلكتروني غير مؤكد. يرجى تأكيد البريد أولًا.",
                    "Your email is not confirmed. Please confirm your email first.",
                    "error"
                );


                return {
                    success: false,
                    emailNotConfirmed: true
                };
            }


            /* ---------------------------------------------
               ACCOUNT TYPE
            --------------------------------------------- */

            const accountType =
                await getAccountType(
                    user.id
                );


            saveAuthData(
                user,
                accountType
            );


            /* ---------------------------------------------
               SYNC APP STATE
            --------------------------------------------- */

            if (
                window.Web3MarketApp &&
                typeof
                window.Web3MarketApp.setCurrentUser ===
                    "function"
            ) {

                window.Web3MarketApp.setCurrentUser(
                    user
                );
            }


            const dashboardUrl =
                getDashboardUrl(
                    accountType
                );


            console.log(
                "Web3Market login successful:",
                {
                    userId:
                        user.id,

                    email:
                        user.email,

                    accountType:
                        accountType
                }
            );


            return {

                success: true,

                user:
                    user,

                session:
                    session,

                accountType:
                    accountType,

                dashboardUrl:
                    dashboardUrl
            };

        } catch (error) {

            console.error(
                "Web3Market login:",
                error
            );

            showAuthError(
                error
            );

            return {
                success: false,
                error: error
            };
        }
    }


    /* =====================================================
       SIGN UP
       ===================================================== */

    async function register(
        email,
        password,
        accountType = "individual",
        metadata = {}
    ) {

        if (
            !window.Web3MarketSupabase ||
            typeof window.Web3MarketSupabase.signUp !==
                "function"
        ) {

            showMessage(
                "تعذر الاتصال بخدمة التسجيل.",
                "Registration service is unavailable.",
                "error"
            );

            return {
                success: false
            };
        }


        email =
            String(email || "")
                .trim()
                .toLowerCase();


        password =
            String(password || "");


        const normalizedType =
            normalizeAccountType(
                accountType
            ) || "individual";


        if (!email || !password) {

            showMessage(
                "يرجى إدخال البريد الإلكتروني وكلمة المرور.",
                "Please enter your email and password.",
                "error"
            );

            return {
                success: false
            };
        }


        try {

            const userMetadata =
                Object.assign(
                    {},
                    metadata || {},
                    {
                        account_type:
                            normalizedType
                    }
                );


            const result =
                await window.Web3MarketSupabase.signUp(
                    email,
                    password,
                    {
                        data:
                            userMetadata,

                        emailRedirectTo:
                            getLoginUrl()
                    }
                );


            const data =
                result?.data;


            const error =
                result?.error;


            if (error) {

                showAuthError(
                    error
                );

                return {
                    success: false,
                    error: error
                };
            }


            const user =
                data?.user;


            const session =
                data?.session;


            /*
             * Supabase may create the user without
             * creating a session when email confirmation
             * is enabled.
             */

            if (user) {

                saveAuthData(
                    user,
                    normalizedType
                );
            }


            if (
                user &&
                session
            ) {

                if (
                    window.Web3MarketApp &&
                    typeof
                    window.Web3MarketApp.setCurrentUser ===
                        "function"
                ) {

                    window.Web3MarketApp.setCurrentUser(
                        user
                    );
                }
            }


            return {

                success: true,

                user:
                    user || null,

                session:
                    session || null,

                accountType:
                    normalizedType,

                emailConfirmationRequired:
                    !session
            };

        } catch (error) {

            console.error(
                "Web3Market registration:",
                error
            );

            showAuthError(
                error
            );

            return {
                success: false,
                error: error
            };
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
                typeof
                window.Web3MarketSupabase.signOut ===
                    "function"
            ) {

                await window.Web3MarketSupabase.signOut();
            }

        } catch (error) {

            console.error(
                "Web3Market logout:",
                error
            );
        }


        clearAuthData();


        if (
            window.Web3MarketApp &&
            typeof
            window.Web3MarketApp.setCurrentUser ===
                "function"
        ) {

            window.Web3MarketApp.setCurrentUser(
                null
            );
        }


        if (redirect) {

            window.location.replace(
                getLoginUrl()
            );
        }


        return true;
    }


    /* =====================================================
       RESEND CONFIRMATION
       ===================================================== */

    async function resendConfirmation(
        email
    ) {

        if (
            !window.Web3MarketSupabase ||
            typeof
            window.Web3MarketSupabase.resendConfirmation !==
                "function"
        ) {

            showMessage(
                "خدمة البريد الإلكتروني غير متاحة.",
                "Email service is unavailable.",
                "error"
            );

            return false;
        }


        email =
            String(email || "")
                .trim()
                .toLowerCase();


        if (!email) {

            showMessage(
                "يرجى إدخال البريد الإلكتروني.",
                "Please enter your email address.",
                "error"
            );

            return false;
        }


        try {

            const result =
                await window.Web3MarketSupabase.resendConfirmation(
                    email,
                    {
                        emailRedirectTo:
                            getLoginUrl()
                    }
                );


            if (result?.error) {

                showAuthError(
                    result.error
                );

                return false;
            }


            showMessage(
                "تم إرسال رسالة تأكيد جديدة إلى بريدك الإلكتروني.",
                "A new confirmation email has been sent.",
                "success"
            );


            return true;

        } catch (error) {

            showAuthError(
                error
            );

            return false;
        }
    }


    /* =====================================================
       RESET PASSWORD
       ===================================================== */

    async function resetPassword(
        email
    ) {

        if (
            !window.Web3MarketSupabase ||
            typeof
            window.Web3MarketSupabase.resetPassword !==
                "function"
        ) {

            showMessage(
                "خدمة إعادة تعيين كلمة المرور غير متاحة.",
                "Password reset service is unavailable.",
                "error"
            );

            return false;
        }


        email =
            String(email || "")
                .trim()
                .toLowerCase();


        if (!email) {

            showMessage(
                "يرجى إدخال البريد الإلكتروني.",
                "Please enter your email address.",
                "error"
            );

            return false;
        }


        try {

            const result =
                await window.Web3MarketSupabase.resetPassword(
                    email,
                    {
                        redirectTo:
                            getLoginUrl()
                    }
                );


            if (result?.error) {

                showAuthError(
                    result.error
                );

                return false;
            }


            showMessage(
                "تم إرسال رابط إعادة تعيين كلمة المرور.",
                "Password reset link has been sent.",
                "success"
            );


            return true;

        } catch (error) {

            showAuthError(
                error
            );

            return false;
        }
    }


    /* =====================================================
       PROTECT PAGE
       ===================================================== */

    async function protectPage(
        requiredAccountType = null
    ) {

        const session =
            await getCurrentSession();


        if (!session?.user) {

            window.location.replace(
                getLoginUrl()
            );

            return false;
        }


        const user =
            session.user;


        if (
            !isEmailConfirmed(
                user
            )
        ) {

            await logout(
                true
            );

            return false;
        }


        const accountType =
            await getAccountType(
                user.id
            );


        if (!accountType) {

            showMessage(
                "تعذر تحديد نوع الحساب.",
                "Could not determine account type.",
                "error"
            );

            return false;
        }


        if (requiredAccountType) {

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


        saveAuthData(
            user,
            accountType
        );


        if (
            window.Web3MarketApp &&
            typeof
            window.Web3MarketApp.setCurrentUser ===
                "function"
        ) {

            window.Web3MarketApp.setCurrentUser(
                user
            );
        }


        return {

            authenticated:
                true,

            user:
                user,

            session:
                session,

            accountType:
                accountType
        };
    }


    /* =====================================================
       AUTH STATE LISTENER
       ===================================================== */

    function onAuthStateChange(
        callback
    ) {

        if (
            !window.Web3MarketSupabase ||
            typeof
            window.Web3MarketSupabase.onAuthStateChange !==
                "function"
        ) {

            return null;
        }


        return window.Web3MarketSupabase.onAuthStateChange(
            function (
                event,
                session
            ) {

                const user =
                    session?.user ||
                    null;


                if (user) {

                    getAccountType(
                        user.id
                    )
                        .then(
                            function (
                                accountType
                            ) {

                                saveAuthData(
                                    user,
                                    accountType
                                );


                                if (
                                    window.Web3MarketApp &&
                                    typeof
                                    window.Web3MarketApp.setCurrentUser ===
                                        "function"
                                ) {

                                    window.Web3MarketApp.setCurrentUser(
                                        user
                                    );
                                }


                                if (
                                    typeof callback ===
                                        "function"
                                ) {

                                    callback(
                                        event,
                                        session,
                                        accountType
                                    );
                                }
                            }
                        )
                        .catch(
                            function (error) {

                                console.error(
                                    "Web3Market auth state:",
                                    error
                                );

                                if (
                                    typeof callback ===
                                        "function"
                                ) {

                                    callback(
                                        event,
                                        session,
                                        null
                                    );
                                }
                            }
                        );

                } else {

                    clearAuthData();


                    if (
                        window.Web3MarketApp &&
                        typeof
                        window.Web3MarketApp.setCurrentUser ===
                            "function"
                    ) {

                        window.Web3MarketApp.setCurrentUser(
                            null
                        );
                    }


                    if (
                        typeof callback ===
                            "function"
                    ) {

                        callback(
                            event,
                            null,
                            null
                        );
                    }
                }
            }
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
            "Web3Market AUTH ERROR:",
            error
        );


        if (
            text.includes(
                "invalid login credentials"
            )
        ) {

            showMessage(
                "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
                "Invalid email or password.",
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
                "Email address is not confirmed.",
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
                "This email address is already registered.",
                "error"
            );

            return;
        }


        if (
            text.includes(
                "password"
            ) &&
            (
                text.includes("short") ||
                text.includes("characters") ||
                text.includes("weak")
            )
        ) {

            showMessage(
                "كلمة المرور غير صالحة أو قصيرة جدًا.",
                "The password is invalid or too short.",
                "error"
            );

            return;
        }


        if (
            text.includes("rate limit") ||
            text.includes("too many") ||
            text.includes("429")
        ) {

            showMessage(
                "تم تجاوز عدد المحاولات. يرجى الانتظار قليلًا ثم المحاولة مرة أخرى.",
                "Too many attempts. Please wait and try again.",
                "error"
            );

            return;
        }


        if (
            text.includes("failed to fetch") ||
            text.includes("network") ||
            text.includes("fetch")
        ) {

            showMessage(
                "تعذر الاتصال بخادم Supabase.",
                "Could not connect to Supabase.",
                "error"
            );

            return;
        }


        showMessage(
            "حدث خطأ: " + raw,
            "Authentication error: " + raw,
            "error"
        );
    }


    /* =====================================================
       MESSAGE SYSTEM
       ===================================================== */

    function showMessage(
        arabic,
        english,
        type = "info"
    ) {

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

                    position:
                        "fixed",

                    top:
                        "20px",

                    right:
                        "20px",

                    zIndex:
                        "999999",

                    maxWidth:
                        "420px",

                    padding:
                        "15px 18px",

                    borderRadius:
                        "12px",

                    boxShadow:
                        "0 12px 35px rgba(0,0,0,.25)",

                    fontFamily:
                        "inherit",

                    lineHeight:
                        "1.5",

                    display:
                        "none"

                }
            );


            document.body.appendChild(
                element
            );
        }


        element.innerHTML = "";


        const arabicElement =
            document.createElement(
                "div"
            );


        arabicElement.textContent =
            String(
                arabic || ""
            );


        const englishElement =
            document.createElement(
                "div"
            );


        englishElement.style.marginTop =
            "4px";


        englishElement.style.opacity =
            "0.85";


        englishElement.textContent =
            String(
                english || ""
            );


        element.appendChild(
            arabicElement
        );


        element.appendChild(
            englishElement
        );


        if (type === "success") {

            element.style.background =
                "#198754";

            element.style.color =
                "#ffffff";

        } else if (type === "error") {

            element.style.background =
                "#dc3545";

            element.style.color =
                "#ffffff";

        } else if (type === "warning") {

            element.style.background =
                "#ffc107";

            element.style.color =
                "#111111";

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
       GLOBAL API
       ===================================================== */

    window.Web3MarketAuth = {

        /* User */

        getCurrentUser:
            getCurrentUser,

        getCurrentSession:
            getCurrentSession,


        /* Account */

        getAccountType:
            getAccountType,

        normalizeAccountType:
            normalizeAccountType,

        isEmailConfirmed:
            isEmailConfirmed,


        /* Authentication */

        login:
            login,

        loginUser:
            login,

        register:
            register,

        signUp:
            register,

        logout:
            logout,

        signOut:
            logout,


        /* Email */

        resendConfirmation:
            resendConfirmation,


        /* Password */

        resetPassword:
            resetPassword,


        /* Protection */

        protectPage:
            protectPage,


        /* Events */

        onAuthStateChange:
            onAuthStateChange,


        /* URLs */

        getLoginUrl:
            getLoginUrl,

        getHomeUrl:
            getHomeUrl,

        getDashboardUrl:
            getDashboardUrl,


        /* Messages */

        showMessage:
            showMessage,

        showError:
            showAuthError
    };


    /* =====================================================
       BACKWARD COMPATIBILITY
       ===================================================== */

    window.getCurrentUser =
        getCurrentUser;


    window.getCurrentSession =
        getCurrentSession;


    window.getAccountType =
        getAccountType;


    window.loginUser =
        login;


    window.logoutUser =
        logout;


    window.protectPage =
        protectPage;


    /* =====================================================
       INITIALIZE AUTH STATE
       ===================================================== */

    async function initializeAuth() {

        try {

            const session =
                await getCurrentSession();


            if (
                session?.user
            ) {

                const user =
                    session.user;


                const accountType =
                    await getAccountType(
                        user.id
                    );


                saveAuthData(
                    user,
                    accountType
                );


                if (
                    window.Web3MarketApp &&
                    typeof
                    window.Web3MarketApp.setCurrentUser ===
                        "function"
                ) {

                    window.Web3MarketApp.setCurrentUser(
                        user
                    );
                }


                console.log(
                    "Web3Market Auth initialized:",
                    {
                        userId:
                            user.id,

                        accountType:
                            accountType
                    }
                );

            } else {

                clearAuthData();
            }

        } catch (error) {

            console.error(
                "Web3Market Auth initialization error:",
                error
            );
        }
    }


    /* =====================================================
       START
       ===================================================== */

    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            initializeAuth,
            {
                once: true
            }
        );

    } else {

        initializeAuth();
    }


    console.log(
        "Web3Market Auth loaded successfully."
    );

})();
