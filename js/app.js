/* =========================================================
   Web3Market
   File: js/app.js
   Global UI controller
   ========================================================= */

"use strict";

(function () {
    function initMobileMenu() {
        const toggle = document.getElementById("menu-toggle");
        const menu = document.getElementById("mobile-menu");

        if (!toggle || !menu) return;

        const close = () => {
            menu.classList.remove("open", "active");
            toggle.classList.remove("active");
            toggle.setAttribute("aria-expanded", "false");
        };

        toggle.addEventListener("click", () => {
            const isOpen = menu.classList.toggle("open");
            menu.classList.toggle("active", isOpen);
            toggle.classList.toggle("active", isOpen);
            toggle.setAttribute("aria-expanded", String(isOpen));
        });

        menu.querySelectorAll("a").forEach((link) => {
            link.addEventListener("click", close);
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") close();
        });

        document.addEventListener("click", (event) => {
            if (!menu.contains(event.target) && !toggle.contains(event.target)) {
                close();
            }
        });
    }

    function initSearchFallback() {
        const input = document.getElementById("projectSearch");
        const category = document.getElementById("categoryFilter");
        const button = document.getElementById("searchButton");
        const cards = Array.from(document.querySelectorAll(".project-card"));

        if (!input || !category || !cards.length) return;

        const normalize = (value) => String(value || "").trim().toLowerCase();

        const apply = () => {
            const query = normalize(input.value);
            const selected = normalize(category.value);

            cards.forEach((card) => {
                const text = normalize(card.textContent);
                const cardCategory = normalize(
                    card.querySelector(".project-category")?.textContent
                );

                const matchesQuery = !query || text.includes(query);
                const matchesCategory = !selected ||
                    cardCategory.includes(selected.replace(/-/g, " ")) ||
                    text.includes(selected.replace(/-/g, " "));

                card.hidden = !(matchesQuery && matchesCategory);
            });
        };

        input.addEventListener("input", apply);
        category.addEventListener("change", apply);
        button?.addEventListener("click", apply);
    }

    /* Remove the legacy Total Transaction Volume widget from the homepage.
       A MutationObserver is used because the widget may be injected later by
       another script or by a cached/deployed version of the homepage. */
    function removeLegacyVolumeCounter() {
        const remove = () => {
            const selectors = [
                "#web3market-volume-counter",
                ".wm-volume-counter",
                '[aria-label="Total completed transaction volume"]'
            ];

            document.querySelectorAll(selectors.join(",")).forEach((el) => el.remove());

            document.querySelectorAll("body *").forEach((el) => {
                if (el.children.length === 0 && /total transaction volume/i.test(el.textContent || "")) {
                    const parent = el.closest(".counter, .wm-volume-counter, [class*="counter"], [id*="volume"]");
                    (parent || el).remove();
                }
            });

            const grid = document.querySelector(".projectCounters .counterGrid");
            if (grid) {
                grid.style.gridTemplateColumns = "repeat(4,minmax(0,1fr))";
            }
        };

        remove();
        const observer = new MutationObserver(remove);
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function loadTrustScoreUI() {
        if (document.querySelector('script[data-wm-trust-score-ui]')) return;
        const script = document.createElement("script");
        script.src = "js/trust-score-ui.js?v=20260905-1";
        script.async = true;
        script.dataset.wmTrustScoreUi = "true";
        document.head.appendChild(script);
    }

    function init() {
        initMobileMenu();
        initSearchFallback();
        removeLegacyVolumeCounter();
        loadTrustScoreUI();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
