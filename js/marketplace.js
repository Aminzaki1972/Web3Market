/* =========================================================
   Web3Market
   File: js/marketplace.js
   Marketplace Controller
   Version: 1.0
   ========================================================= */

"use strict";

(function () {

    /* =====================================================
       STATE
       ===================================================== */

    const Marketplace = {

        initialized: false,

        loading: false,

        projects: [],

        filteredProjects: [],

        search: "",

        category: ""

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
            window.web3marketSupabase
        ) {

            return window.web3marketSupabase;
        }


        if (
            window.supabaseClient
        ) {

            return window.supabaseClient;
        }


        console.error(
            "Web3Market Marketplace: Supabase client is unavailable."
        );

        return null;
    }


    /* =====================================================
       INITIALIZATION
       ===================================================== */

    async function init() {

        if (
            Marketplace.initialized
        ) {

            return;
        }


        Marketplace.initialized =
            true;


        try {

            readUrlParameters();

            await loadProjects();

            setupSearchListener();

            console.log(
                "Web3Market Marketplace initialized."
            );

        } catch (error) {

            console.error(
                "Web3Market Marketplace initialization error:",
                error
            );

            showError(
                "Unable to load marketplace projects."
            );
        }
    }


    /* =====================================================
       READ URL PARAMETERS
       ===================================================== */

    function readUrlParameters() {

        const params =
            new URLSearchParams(
                window.location.search
            );


        Marketplace.search =
            (
                params.get("search") ||
                ""
            )
                .trim();


        Marketplace.category =
            (
                params.get("category") ||
                ""
            )
                .trim();


        const searchInput =
            document.getElementById(
                "projectSearch"
            );


        const categoryFilter =
            document.getElementById(
                "categoryFilter"
            );


        if (
            searchInput &&
            Marketplace.search
        ) {

            searchInput.value =
                Marketplace.search;
        }


        if (
            categoryFilter &&
            Marketplace.category
        ) {

            categoryFilter.value =
                Marketplace.category;
        }
    }


    /* =====================================================
       LOAD PROJECTS
       ===================================================== */

    async function loadProjects() {

        const supabase =
            getSupabase();


        if (!supabase) {

            showError(
                "Database connection is not available."
            );

            return [];
        }


        setLoading(true);


        try {

            /*
             * Main projects query.
             *
             * We intentionally use select("*")
             * so this file remains compatible with
             * different project table structures.
             */

            const {
                data,
                error
            } =
                await supabase
                    .from("projects")
                    .select("*")
                    .order(
                        "created_at",
                        {
                            ascending: false
                        }
                    );


            if (error) {

                console.error(
                    "Web3Market projects query error:",
                    error
                );

                /*
                 * If created_at does not exist,
                 * retry without ordering.
                 */

                const retry =
                    await supabase
                        .from("projects")
                        .select("*");


                if (
                    retry.error
                ) {

                    console.error(
                        "Web3Market projects retry error:",
                        retry.error
                    );

                    showError(
                        getDatabaseErrorMessage(
                            retry.error
                        )
                    );

                    Marketplace.projects =
                        [];

                    Marketplace.filteredProjects =
                        [];

                    renderProjects([]);

                    return [];
                }


                Marketplace.projects =
                    Array.isArray(
                        retry.data
                    )
                        ? retry.data
                        : [];

            } else {

                Marketplace.projects =
                    Array.isArray(data)
                        ? data
                        : [];
            }


            /*
             * Apply current filters.
             */

            Marketplace.filteredProjects =
                filterProjects(
                    Marketplace.projects
                );


            /*
             * Send projects to app.js
             * when available.
             */

            if (
                window.Web3MarketApp &&
                typeof
                window.Web3MarketApp.setProjects ===
                "function"
            ) {

                window.Web3MarketApp.setProjects(
                    Marketplace.projects
                );
            }


            renderProjects(
                Marketplace.filteredProjects
            );


            return Marketplace.projects;

        } catch (error) {

            console.error(
                "Web3Market loadProjects exception:",
                error
            );

            Marketplace.projects =
                [];

            Marketplace.filteredProjects =
                [];

            showError(
                "An unexpected error occurred while loading projects."
            );

            renderProjects([]);

            return [];

        } finally {

            setLoading(false);
        }
    }


    /* =====================================================
       FILTER PROJECTS
       ===================================================== */

    function filterProjects(
        projects
    ) {

        const list =
            Array.isArray(projects)
                ? projects
                : [];


        const search =
            String(
                Marketplace.search || ""
            )
                .trim()
                .toLowerCase();


        const category =
            String(
                Marketplace.category || ""
            )
                .trim()
                .toLowerCase();


        let result =
            list.slice();


        /*
         * SEARCH
         */

        if (search) {

            result =
                result.filter(
                    function (project) {

                        if (!project) {
                            return false;
                        }


                        const searchableText = [

                            project.id,

                            project.title,

                            project.name,

                            project.description,

                            project.category,

                            project.type,

                            project.tags,

                            project.seller,

                            project.company,

                            project.location,

                            project.network

                        ]
                            .filter(
                                function (value) {

                                    return (
                                        value !==
                                            null &&
                                        value !==
                                            undefined
                                    );
                                }
                            )
                            .map(
                                function (value) {

                                    if (
                                        Array.isArray(
                                            value
                                        )
                                    ) {

                                        return value.join(
                                            " "
                                        );
                                    }

                                    if (
                                        typeof value ===
                                        "object"
                                    ) {

                                        return JSON.stringify(
                                            value
                                        );
                                    }

                                    return String(
                                        value
                                    );
                                }
                            )
                            .join(" ")
                            .toLowerCase();


                        return searchableText.includes(
                            search
                        );
                    }
                );
        }


        /*
         * CATEGORY
         */

        if (category) {

            result =
                result.filter(
                    function (project) {

                        if (!project) {
                            return false;
                        }


                        const projectCategory =
                            String(
                                project.category ||
                                project.type ||
                                ""
                            )
                                .trim()
                                .toLowerCase();


                        return (
                            projectCategory ===
                                category ||
                            projectCategory.includes(
                                category
                            )
                        );
                    }
                );
        }


        return result;
    }


    /* =====================================================
       SEARCH LISTENER
       ===================================================== */

    function setupSearchListener() {

        const searchInput =
            document.getElementById(
                "projectSearch"
            );


        const categoryFilter =
            document.getElementById(
                "categoryFilter"
            );


        const searchButton =
            document.getElementById(
                "searchButton"
            );


        if (searchButton) {

            searchButton.addEventListener(
                "click",
                function () {

                    updateSearch(
                        searchInput,
                        categoryFilter
                    );
                }
            );
        }


        if (searchInput) {

            searchInput.addEventListener(
                "keydown",
                function (event) {

                    if (
                        event.key ===
                        "Enter"
                    ) {

                        event.preventDefault();

                        updateSearch(
                            searchInput,
                            categoryFilter
                        );
                    }
                }
            );
        }


        if (categoryFilter) {

            categoryFilter.addEventListener(
                "change",
                function () {

                    updateSearch(
                        searchInput,
                        categoryFilter
                    );
                }
            );
        }
    }


    /* =====================================================
       UPDATE SEARCH
       ===================================================== */

    function updateSearch(
        searchInput,
        categoryFilter
    ) {

        Marketplace.search =
            searchInput
                ? String(
                    searchInput.value || ""
                ).trim()
                : "";


        Marketplace.category =
            categoryFilter
                ? String(
                    categoryFilter.value || ""
                ).trim()
                : "";


        const filtered =
            filterProjects(
                Marketplace.projects
            );


        Marketplace.filteredProjects =
            filtered;


        renderProjects(
            filtered
        );


        /*
         * Keep URL synchronized.
         */

        try {

            const url =
                new URL(
                    window.location.href
                );


            if (
                Marketplace.search
            ) {

                url.searchParams.set(
                    "search",
                    Marketplace.search
                );

            } else {

                url.searchParams.delete(
                    "search"
                );
            }


            if (
                Marketplace.category
            ) {

                url.searchParams.set(
                    "category",
                    Marketplace.category
                );

            } else {

                url.searchParams.delete(
                    "category"
                );
            }


            window.history.replaceState(
                {},
                "",
                url
            );

        } catch (error) {

            console.warn(
                "Web3Market URL update failed:",
                error
            );
        }
    }


    /* =====================================================
       RENDER PROJECTS
       ===================================================== */

    function renderProjects(
        projects
    ) {

        const containers =
            document.querySelectorAll(
                "#projects-container, " +
                "#projects-list, " +
                ".projects-grid, " +
                "[data-projects-container]"
            );


        if (
            !containers.length
        ) {

            return;
        }


        const list =
            Array.isArray(projects)
                ? projects
                : [];


        containers.forEach(
            function (container) {

                if (!list.length) {

                    container.innerHTML =
                        getEmptyState();

                    return;
                }


                container.innerHTML =
                    list
                        .map(
                            createProjectCard
                        )
                        .join("");
            }
        );


        /*
         * Reconnect project links
         * through app.js.
         */

        if (
            window.Web3MarketApp &&
            typeof
            window.Web3MarketApp.setupProjectLinks ===
            "function"
        ) {

            window.Web3MarketApp.setupProjectLinks();
        }
    }


    /* =====================================================
       CREATE PROJECT CARD
       ===================================================== */

    function createProjectCard(
        project
    ) {

        if (!project) {
            return "";
        }


        const id =
            escapeHTML(
                project.id ||
                ""
            );


        const title =
            escapeHTML(
                project.title ||
                project.name ||
                "Untitled Web3 Project"
            );


        const description =
            escapeHTML(
                project.description ||
                "No project description available."
            );


        const category =
            escapeHTML(
                project.category ||
                project.type ||
                "Web3 Project"
            );


        const seller =
            escapeHTML(
                project.seller ||
                project.company ||
                project.owner_name ||
                "Web3 Seller"
            );


        const network =
            escapeHTML(
                project.network ||
                project.blockchain ||
                project.chain ||
                "Web3"
            );


        const price =
            getPrice(
                project
            );


        const image =
            getProjectImage(
                project
            );


        return `
            <article
                class="project-card"
                data-project-id="${id}"
            >

                <div class="project-card-top">

                    <span class="project-category">
                        ${category}
                    </span>

                    ${
                        project.featured
                            ? `
                                <span class="project-status">
                                    Featured
                                </span>
                            `
                            : ""
                    }

                </div>


                ${
                    image
                        ? `
                            <div class="project-image-wrapper">

                                <img
                                    src="${image}"
                                    alt="${title}"
                                    class="project-image"
                                    loading="lazy"
                                >

                            </div>
                        `
                        : `
                            <div class="project-icon">
                                W3
                            </div>
                        `
                }


                <h3>
                    ${title}
                </h3>


                <p>
                    ${description}
                </p>


                <div class="project-meta">

                    <div>

                        <span>
                            Seller
                        </span>

                        <strong>
                            ${seller}
                        </strong>

                    </div>


                    <div>

                        <span>
                            Network
                        </span>

                        <strong>
                            ${network}
                        </strong>

                    </div>

                </div>


                <div class="project-card-footer">

                    <strong>
                        ${
                            price
                                ? price
                                : "Available"
                        }
                    </strong>


                    <a
                        href="project-details.html?id=${encodeURIComponent(
                            project.id || ""
                        )}"
                        data-project-link
                        data-project-id="${id}"
                    >
                        View Project →
                    </a>

                </div>

            </article>
        `;
    }


    /* =====================================================
       PRICE
       ===================================================== */

    function getPrice(
        project
    ) {

        const value =
            project.price ??
            project.asking_price ??
            project.sale_price ??
            project.amount ??
            null;


        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {

            return "";
        }


        const currency =
            project.currency ||
            "USD";


        return (
            escapeHTML(
                String(value)
            ) +
            " " +
            escapeHTML(
                String(currency)
            )
        );
    }


    /* =====================================================
       IMAGE
       ===================================================== */

    function getProjectImage(
        project
    ) {

        const image =
            project.image_url ||
            project.image ||
            project.logo_url ||
            project.logo ||
            "";


        if (!image) {
            return "";
        }


        /*
         * Only allow HTTP(S) images.
         */

        try {

            const parsed =
                new URL(
                    String(image),
                    window.location.href
                );


            if (
                parsed.protocol !==
                    "http:" &&
                parsed.protocol !==
                    "https:"
            ) {

                return "";
            }


            return escapeHTML(
                parsed.href
            );

        } catch (error) {

            return "";
        }
    }


    /* =====================================================
       EMPTY STATE
       ===================================================== */

    function getEmptyState() {

        if (
            Marketplace.search ||
            Marketplace.category
        ) {

            return `
                <div class="no-projects">

                    <h3>
                        No projects found
                    </h3>

                    <p>
                        No Web3 projects match your
                        current search or category.
                    </p>

                    <button
                        type="button"
                        class="btn btn-primary"
                        data-clear-marketplace-filters
                    >
                        Clear Filters
                    </button>

                </div>
            `;
        }


        return `
            <div class="no-projects">

                <h3>
                    No projects available yet
                </h3>

                <p>
                    The Web3Market marketplace is ready
                    for its first projects.
                </p>

                <a
                    href="register.html"
                    class="btn btn-primary"
                >
                    List Your Project
                </a>

            </div>
        `;
    }


    /* =====================================================
       ERROR
       ===================================================== */

    function showError(
        message
    ) {

        const containers =
            document.querySelectorAll(
                "#projects-container, " +
                "#projects-list, " +
                ".projects-grid, " +
                "[data-projects-container]"
            );


        containers.forEach(
            function (container) {

                container.innerHTML = `
                    <div class="no-projects marketplace-error">

                        <h3>
                            Marketplace temporarily unavailable
                        </h3>

                        <p>
                            ${escapeHTML(
                                message
                            )}
                        </p>

                        <button
                            type="button"
                            class="btn btn-primary"
                            data-retry-marketplace
                        >
                            Try Again
                        </button>

                    </div>
                `;
            }
        );


        if (
            window.Web3MarketApp &&
            typeof
            window.Web3MarketApp.showMessage ===
            "function"
        ) {

            window.Web3MarketApp.showMessage(
                message,
                "error"
            );
        }
    }


    /* =====================================================
       DATABASE ERROR MESSAGE
       ===================================================== */

    function getDatabaseErrorMessage(
        error
    ) {

        if (!error) {

            return "Unable to load projects.";
        }


        const message =
            String(
                error.message ||
                ""
            );


        if (
            message.toLowerCase().includes(
                "relation"
            ) &&
            message.toLowerCase().includes(
                "does not exist"
            )
        ) {

            return (
                "The projects table does not exist in Supabase yet."
            );
        }


        if (
            message.toLowerCase().includes(
                "permission denied"
            ) ||
            message.toLowerCase().includes(
                "row-level security"
            )
        ) {

            return (
                "Supabase security policies are preventing project access."
            );
        }


        return (
            message ||
            "Unable to load projects from Supabase."
        );
    }


    /* =====================================================
       LOADING
       ===================================================== */

    function setLoading(
        loading
    ) {

        Marketplace.loading =
            Boolean(
                loading
            );


        if (
            window.Web3MarketApp &&
            typeof
            window.Web3MarketApp.setLoading ===
            "function"
        ) {

            window.Web3MarketApp.setLoading(
                Marketplace.loading
            );
        }


        const containers =
            document.querySelectorAll(
                "#projects-container, " +
                "#projects-list, " +
                ".projects-grid, " +
                "[data-projects-container]"
            );


        if (
            Marketplace.loading
        ) {

            containers.forEach(
                function (container) {

                    if (
                        !container.children.length
                    ) {

                        container.innerHTML = `
                            <div class="no-projects">

                                <h3>
                                    Loading projects...
                                </h3>

                                <p>
                                    Connecting to the Web3Market marketplace.
                                </p>

                            </div>
                        `;
                    }
                }
            );
        }
    }


    /* =====================================================
       ESCAPE HTML
       ===================================================== */

    function escapeHTML(
        value
    ) {

        if (
            value === null ||
            value === undefined
        ) {

            return "";
        }


        return String(value)
            .replace(
                /&/g,
                "&amp;"
            )
            .replace(
                /</g,
                "&lt;"
            )
            .replace(
                />/g,
                "&gt;"
            )
            .replace(
                /"/g,
                "&quot;"
            )
            .replace(
                /'/g,
                "&#039;"
            );
    }


    /* =====================================================
       GLOBAL CLICK EVENTS
       ===================================================== */

    document.addEventListener(
        "click",
        function (event) {

            const retryButton =
                event.target.closest(
                    "[data-retry-marketplace]"
                );


            if (
                retryButton
            ) {

                event.preventDefault();

                loadProjects();

                return;
            }


            const clearButton =
                event.target.closest(
                    "[data-clear-marketplace-filters]"
                );


            if (
                clearButton
            ) {

                event.preventDefault();

                Marketplace.search =
                    "";

                Marketplace.category =
                    "";


                const searchInput =
                    document.getElementById(
                        "projectSearch"
                    );


                const categoryFilter =
                    document.getElementById(
                        "categoryFilter"
                    );


                if (searchInput) {

                    searchInput.value =
                        "";
                }


                if (categoryFilter) {

                    categoryFilter.value =
                        "";
                }


                Marketplace.filteredProjects =
                    Marketplace.projects.slice();


                renderProjects(
                    Marketplace.filteredProjects
                );


                try {

                    const url =
                        new URL(
                            window.location.href
                        );


                    url.searchParams.delete(
                        "search"
                    );


                    url.searchParams.delete(
                        "category"
                    );


                    window.history.replaceState(
                        {},
                        "",
                        url
                    );

                } catch (error) {

                    console.warn(
                        "Web3Market filter reset URL error:",
                        error
                    );
                }
            }

        }
    );


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.Web3MarketMarketplace = {

        init:
            init,

        loadProjects:
            loadProjects,

        getProjects:
            function () {

                return Marketplace.projects.slice();
            },

        getFilteredProjects:
            function () {

                return Marketplace.filteredProjects.slice();
            },

        filterProjects:
            filterProjects,

        renderProjects:
            renderProjects,

        refresh:
            loadProjects,

        getState:
            function () {

                return Marketplace;
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
