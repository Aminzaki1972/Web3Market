/* =========================================================
   Web3Market
   File: js/marketplace.js
   Marketplace Controller
   Supabase Projects
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

        category: "",

        tableName: "projects"

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
            window.supabaseClient
        ) {

            return window.supabaseClient;
        }


        console.error(
            "Web3Market Marketplace: Supabase client unavailable."
        );

        return null;
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


        console.log(
            "Web3Market:",
            message
        );
    }


    /* =====================================================
       LOADING
       ===================================================== */

    function setLoading(
        value
    ) {

        Marketplace.loading =
            Boolean(value);


        if (
            window.Web3MarketApp &&
            typeof window.Web3MarketApp.setLoading ===
                "function"
        ) {

            window.Web3MarketApp.setLoading(
                Marketplace.loading
            );
        }


        const loaders =
            document.querySelectorAll(
                "[data-marketplace-loading]"
            );


        loaders.forEach(
            function (element) {

                element.style.display =
                    Marketplace.loading
                        ? ""
                        : "none";
            }
        );
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
       NORMALIZE PROJECT
       ===================================================== */

    function normalizeProject(
        project
    ) {

        if (!project) {
            return null;
        }


        return {

            id:
                project.id ??
                "",


            title:
                project.title ??
                project.name ??
                "Untitled Project",


            name:
                project.name ??
                project.title ??
                "Untitled Project",


            description:
                project.description ??
                project.summary ??
                "No description available.",


            category:
                project.category ??
                project.type ??
                "Web3 Project",


            type:
                project.type ??
                project.category ??
                "",


            price:
                project.price ??
                project.asking_price ??
                project.sale_price ??
                null,


            currency:
                project.currency ??
                project.price_currency ??
                "",


            seller:
                project.seller ??
                project.company ??
                project.owner ??
                "",


            image:
                project.image ??
                project.image_url ??
                project.logo ??
                "",


            status:
                project.status ??
                "available",


            created_at:
                project.created_at ??
                null,


            raw:
                project

        };
    }


    /* =====================================================
       LOAD PROJECTS
       ===================================================== */

    async function loadProjects() {

        const supabase =
            getSupabase();


        if (!supabase) {

            renderEmptyState(
                "Supabase is not available."
            );

            return [];
        }


        setLoading(true);


        try {

            console.log(
                "Web3Market: Loading projects..."
            );


            const result =
                await supabase
                    .from(
                        Marketplace.tableName
                    )
                    .select("*")
                    .order(
                        "created_at",
                        {
                            ascending:
                                false
                        }
                    );


            const data =
                result?.data ||
                [];


            const error =
                result?.error ||
                null;


            if (error) {

                console.error(
                    "Web3Market projects error:",
                    error
                );


                /*
                 * If the table does not exist yet,
                 * keep the application usable.
                 */

                if (
                    error.code ===
                    "42P01"
                ) {

                    renderEmptyState(
                        "The projects table has not been created in Supabase yet."
                    );

                } else {

                    renderEmptyState(
                        "Unable to load marketplace projects."
                    );
                }


                return [];
            }


            Marketplace.projects =
                data
                    .map(
                        normalizeProject
                    )
                    .filter(
                        Boolean
                    );


            Marketplace.filteredProjects =
                applyFilters(
                    Marketplace.projects
                );


            /*
             * Synchronize with app.js
             */

            if (
                window.Web3MarketApp &&
                typeof window.Web3MarketApp.setProjects ===
                    "function"
            ) {

                window.Web3MarketApp.setProjects(
                    Marketplace.projects
                );
            }


            renderProjects(
                Marketplace.filteredProjects
            );


            console.log(
                "Web3Market: Projects loaded:",
                Marketplace.projects.length
            );


            return Marketplace.projects;

        } catch (error) {

            console.error(
                "Web3Market loadProjects exception:",
                error
            );


            renderEmptyState(
                "Unable to load marketplace projects."
            );


            return [];

        } finally {

            setLoading(false);
        }
    }


    /* =====================================================
       APPLY FILTERS
       ===================================================== */

    function applyFilters(
        projects
    ) {

        const list =
            Array.isArray(projects)
                ? projects
                : [];


        const search =
            String(
                Marketplace.search ||
                ""
            )
                .trim()
                .toLowerCase();


        const category =
            String(
                Marketplace.category ||
                ""
            )
                .trim()
                .toLowerCase();


        let result =
            list.slice();


        if (search) {

            result =
                result.filter(
                    function (project) {

                        const searchableText = [

                            project.id,

                            project.title,

                            project.name,

                            project.description,

                            project.category,

                            project.type,

                            project.seller,

                            project.currency

                        ]
                            .filter(
                                function (value) {

                                    return (
                                        value !== null &&
                                        value !== undefined
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


        if (category) {

            result =
                result.filter(
                    function (project) {

                        const value =
                            String(
                                project.category ||
                                project.type ||
                                ""
                            )
                                .trim()
                                .toLowerCase();


                        return (
                            value ===
                            category
                        );
                    }
                );
        }


        return result;
    }


    /* =====================================================
       SEARCH
       ===================================================== */

    function searchProjects(
        search,
        category
    ) {

        Marketplace.search =
            String(
                search || ""
            ).trim();


        Marketplace.category =
            String(
                category || ""
            ).trim();


        Marketplace.filteredProjects =
            applyFilters(
                Marketplace.projects
            );


        renderProjects(
            Marketplace.filteredProjects
        );


        return Marketplace.filteredProjects;
    }


    /* =====================================================
       PROJECT CARD
       ===================================================== */

    function createProjectCard(
        project
    ) {

        if (!project) {
            return "";
        }


        const id =
            escapeHTML(
                project.id
            );


        const title =
            escapeHTML(
                project.title
            );


        const category =
            escapeHTML(
                project.category
            );


        const description =
            escapeHTML(
                project.description
            );


        const seller =
            escapeHTML(
                project.seller ||
                "Web3 Seller"
            );


        const status =
            escapeHTML(
                project.status ||
                "Available"
            );


        const price =
            project.price !== null &&
            project.price !== undefined &&
            project.price !== ""
                ? escapeHTML(
                    project.price
                )
                : "";


        const currency =
            escapeHTML(
                project.currency ||
                ""
            );


        const image =
            escapeHTML(
                project.image ||
                ""
            );


        const imageHTML =
            image
                ? `
                    <img
                        src="${image}"
                        alt="${title}"
                        class="project-image"
                        loading="lazy"
                    >
                `
                : `
                    <div
                        class="project-icon"
                        aria-hidden="true"
                    >
                        W3M
                    </div>
                `;


        const priceHTML =
            price
                ? `
                    <div class="project-price">
                        <span>Price</span>
                        <strong>
                            ${price}
                            ${currency}
                        </strong>
                    </div>
                `
                : `
                    <div class="project-price">
                        <span>Price</span>
                        <strong>
                            Contact Seller
                        </strong>
                    </div>
                `;


        return `
            <article
                class="project-card"
                data-project-id="${id}"
            >

                <div class="project-card-top">

                    <span class="project-category">
                        ${category}
                    </span>

                    <span class="project-status">
                        ${status}
                    </span>

                </div>


                <div class="project-card-image">

                    ${imageHTML}

                </div>


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

                    ${priceHTML}

                </div>


                <div class="project-card-footer">

                    <strong>
                        Web3Market
                    </strong>

                    <a
                        href="project-details.html?id=${encodeURIComponent(
                            project.id
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


        if (!containers.length) {

            return;
        }


        const list =
            Array.isArray(projects)
                ? projects
                : [];


        containers.forEach(
            function (container) {

                /*
                 * IMPORTANT:
                 *
                 * If the container already contains
                 * demo projects and Supabase has no
                 * projects, do not destroy them.
                 */

                if (
                    !list.length &&
                    container.querySelector(
                        ".project-card"
                    )
                ) {

                    return;
                }


                if (!list.length) {

                    renderEmptyState(
                        "No Web3 projects are currently available.",
                        container
                    );

                    return;
                }


                container.innerHTML =
                    list
                        .map(
                            createProjectCard
                        )
                        .join("");


                setupProjectLinks();
            }
        );
    }


    /* =====================================================
       EMPTY STATE
       ===================================================== */

    function renderEmptyState(
        message,
        target = null
    ) {

        const containers =
            target
                ? [target]
                : document.querySelectorAll(
                    "#projects-container, " +
                    "#projects-list, " +
                    ".projects-grid, " +
                    "[data-projects-container]"
                );


        if (!containers.length) {
            return;
        }


        containers.forEach(
            function (container) {

                container.innerHTML = `
                    <div class="no-projects">

                        <div class="project-icon">
                            W3M
                        </div>

                        <h3>
                            Marketplace
                        </h3>

                        <p>
                            ${escapeHTML(message)}
                        </p>

                    </div>
                `;
            }
        );
    }


    /* =====================================================
       PROJECT LINKS
       ===================================================== */

    function setupProjectLinks() {

        const links =
            document.querySelectorAll(
                "[data-project-link]"
            );


        links.forEach(
            function (link) {

                if (
                    link.dataset.web3marketMarketplaceInitialized ===
                    "true"
                ) {

                    return;
                }


                link.dataset.web3marketMarketplaceInitialized =
                    "true";


                link.addEventListener(
                    "click",
                    function (event) {

                        const projectId =
                            link.dataset.projectId;


                        if (!projectId) {
                            return;
                        }


                        /*
                         * Let the browser navigate normally.
                         *
                         * This event only records the
                         * currently selected project.
                         */

                        const project =
                            getProjectById(
                                projectId
                            );


                        if (project) {

                            Marketplace.currentProject =
                                project;
                        }
                    }
                );
            }
        );
    }


    /* =====================================================
       GET PROJECT
       ===================================================== */

    function getProjectById(
        id
    ) {

        if (
            id === null ||
            id === undefined ||
            id === ""
        ) {

            return null;
        }


        return (
            Marketplace.projects.find(
                function (project) {

                    return (
                        project &&
                        String(project.id) ===
                        String(id)
                    );
                }
            ) ||
            null
        );
    }


    /* =====================================================
       LOAD SINGLE PROJECT
       ===================================================== */

    async function loadProject(
        id
    ) {

        const supabase =
            getSupabase();


        if (!supabase) {
            return null;
        }


        if (
            !id
        ) {
            return null;
        }


        try {

            const result =
                await supabase
                    .from(
                        Marketplace.tableName
                    )
                    .select("*")
                    .eq(
                        "id",
                        id
                    )
                    .maybeSingle();


            if (
                result?.error
            ) {

                console.error(
                    "Web3Market project error:",
                    result.error
                );

                return null;
            }


            if (
                !result?.data
            ) {

                return null;
            }


            return normalizeProject(
                result.data
            );

        } catch (error) {

            console.error(
                "Web3Market loadProject exception:",
                error
            );

            return null;
        }
    }


    /* =====================================================
       REFRESH
       ===================================================== */

    async function refresh() {

        return loadProjects();
    }


    /* =====================================================
       SEARCH UI
       ===================================================== */

    function setupSearch() {

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


        function executeSearch() {

            searchProjects(

                searchInput
                    ? searchInput.value
                    : "",

                categoryFilter
                    ? categoryFilter.value
                    : ""
            );
        }


        if (searchButton) {

            searchButton.addEventListener(
                "click",
                executeSearch
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

                        executeSearch();
                    }
                }
            );
        }


        if (categoryFilter) {

            categoryFilter.addEventListener(
                "change",
                executeSearch
            );
        }
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

            setupSearch();

            setupProjectLinks();

            /*
             * Read URL parameters.
             */

            const params =
                new URLSearchParams(
                    window.location.search
                );


            Marketplace.search =
                params.get(
                    "search"
                ) || "";


            Marketplace.category =
                params.get(
                    "category"
                ) || "";


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


            await loadProjects();


            console.log(
                "Web3Market Marketplace initialized successfully."
            );

        } catch (error) {

            console.error(
                "Web3Market Marketplace initialization error:",
                error
            );

            Marketplace.initialized =
                false;
        }
    }


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.Web3MarketMarketplace = {

        init:
            init,

        loadProjects:
            loadProjects,

        loadProject:
            loadProject,

        refresh:
            refresh,

        search:
            searchProjects,

        getProjectById:
            getProjectById,

        getProjects:
            function () {

                return Marketplace.projects.slice();

            },

        getFilteredProjects:
            function () {

                return Marketplace.filteredProjects.slice();

            },

        render:
            renderProjects,

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
