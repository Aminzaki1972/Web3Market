"use strict";
(function () {
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get("id");
  if (!projectId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) return;

  const getClient = () =>
    window.Web3MarketSupabase?.getClient?.() ||
    window.supabaseClient ||
    window.web3marketSupabase ||
    null;

  function installCounter(total) {
    const page = document.getElementById("page");
    if (!page || !page.querySelector("h1")) return false;

    let counter = document.getElementById("wm-project-view-count");
    if (!counter) {
      counter = document.createElement("span");
      counter.id = "wm-project-view-count";
      counter.setAttribute("aria-live", "polite");
      counter.setAttribute("aria-label", "Project page views");
      counter.style.cssText = "display:inline-flex;align-items:center;gap:7px;margin:10px 0;padding:8px 12px;border:1px solid #e3e6eb;border-radius:999px;background:#fff;color:#4b5563;font-size:13px;font-weight:800";
      counter.innerHTML = '<span aria-hidden="true">👁</span><span data-wm-project-view-number>—</span> <span data-wm-project-view-label>Views</span>';

      const hero = page.querySelector(".hero-actions");
      if (hero) hero.insertAdjacentElement("afterend", counter);
      else page.querySelector("h1").insertAdjacentElement("afterend", counter);
    }

    const number = counter.querySelector("[data-wm-project-view-number]");
    const label = counter.querySelector("[data-wm-project-view-label]");
    const lang = (document.documentElement.lang || "en").toLowerCase();
    if (number) number.textContent = Number(total || 0).toLocaleString("en-US");
    if (label) label.textContent = lang.startsWith("ar") ? "مشاهدة" : "Views";
    return true;
  }

  async function countView() {
    const client = getClient();
    if (!client) return;
    try {
      const recorded = await client.rpc("record_project_page_view", { p_project_id: projectId });
      if (recorded.error) throw recorded.error;
      const total = Number(recorded.data || 0);
      installCounter(total);
    } catch (error) {
      console.warn("Web3Market project view counter unavailable:", error);
      try {
        const result = await client.rpc("get_project_page_view_count", { p_project_id: projectId });
        if (!result.error) installCounter(result.data);
      } catch (_) {}
    }
  }

  function start() {
    const page = document.getElementById("page");
    if (!page) return;
    let started = false;
    const maybeCount = () => {
      if (started || !page.querySelector("h1")) return;
      started = true;
      observer.disconnect();
      countView();
    };
    const observer = new MutationObserver(maybeCount);
    observer.observe(page, { childList: true, subtree: true });
    maybeCount();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
