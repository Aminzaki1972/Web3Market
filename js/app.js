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

    function init() {
        initMobileMenu();
        initSearchFallback();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
