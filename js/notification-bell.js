"use strict";
(function () {
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c] || c));
  const client = () => window.Web3MarketSupabase?.getClient?.() || window.supabaseClient || window.web3marketSupabase;

  function addStyles() {
    if (document.getElementById("w3mNotificationStyles")) return;
    const style = document.createElement("style");
    style.id = "w3mNotificationStyles";
    style.textContent = `
      .w3m-notify-wrap{position:relative;display:inline-flex;align-items:center;margin-left:8px;z-index:1000}
      .w3m-notify-button{position:relative;display:inline-grid;place-items:center;width:42px;height:42px;border:1px solid #dbe3ef;border-radius:12px;background:#fff;color:#1e293b;font-size:21px;cursor:pointer}
      .w3m-notify-count{position:absolute;top:-5px;right:-5px;min-width:18px;height:18px;padding:0 4px;box-sizing:border-box;border-radius:999px;background:#dc2626;color:#fff;font:700 10px/18px Arial,sans-serif;text-align:center}
      .w3m-notify-panel{position:absolute;right:0;top:49px;width:min(360px,calc(100vw - 28px));max-height:420px;overflow:auto;background:#fff;border:1px solid #dbe3ef;border-radius:14px;box-shadow:0 18px 50px rgba(15,23,42,.18);color:#0f172a}
      .w3m-notify-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #e2e8f0;font-weight:800}
      .w3m-notify-item{display:block;padding:13px 16px;border-bottom:1px solid #f1f5f9;color:inherit;text-decoration:none}
      .w3m-notify-item:hover{background:#f8fafc}.w3m-notify-item.unread{background:#eff6ff}
      .w3m-notify-item strong{display:block;font-size:13px;margin-bottom:4px}.w3m-notify-item span{display:block;font-size:12px;line-height:1.5;color:#475569}
      .w3m-notify-item small{display:block;font-size:10px;color:#64748b;margin-top:6px}
      .w3m-notify-empty{padding:20px 16px;font-size:12px;color:#64748b}
      @media(max-width:520px){.w3m-notify-wrap{margin-left:4px}.w3m-notify-button{width:38px;height:38px}.w3m-notify-panel{right:-46px}}
    `;
    document.head.appendChild(style);
  }

  async function init() {
    const topbar = document.querySelector("header.topbar");
    if (!topbar || document.getElementById("w3mNotifyWrap")) return;
    addStyles();
    const wrap = document.createElement("div");
    wrap.className = "w3m-notify-wrap";
    wrap.id = "w3mNotifyWrap";
    wrap.innerHTML = `
      <button class="w3m-notify-button" id="w3mNotifyButton" type="button" aria-label="Notifications" aria-expanded="false" title="Notifications">🔔<span class="w3m-notify-count" id="w3mNotifyCount" hidden>0</span></button>
      <section class="w3m-notify-panel" id="w3mNotifyPanel" hidden aria-label="Notifications">
        <div class="w3m-notify-head"><span>Notifications</span><button id="w3mNotifyRefresh" type="button" style="border:0;background:transparent;color:#2563eb;font-weight:700;cursor:pointer">Refresh</button></div>
        <div id="w3mNotifyItems"><div class="w3m-notify-empty">Loading notifications…</div></div>
      </section>`;
    const homeLink = topbar.querySelector(":scope > .btn, :scope > .btn-ghost");
    if (homeLink) topbar.insertBefore(wrap, homeLink); else topbar.appendChild(wrap);

    const button = document.getElementById("w3mNotifyButton");
    const panel = document.getElementById("w3mNotifyPanel");
    const items = document.getElementById("w3mNotifyItems");
    const count = document.getElementById("w3mNotifyCount");
    let currentUser = null;

    async function load() {
      const sb = client();
      if (!sb?.auth) { items.innerHTML = '<div class="w3m-notify-empty">Sign in to view notifications.</div>'; return; }
      const { data: { user } = {} } = await sb.auth.getUser();
      if (!user) { items.innerHTML = '<div class="w3m-notify-empty">Sign in to view notifications.</div>'; return; }
      currentUser = user;
      const { data, error } = await sb.from("marketplace_notifications")
        .select("id,title,message,data,read_at,created_at")
        .eq("user_id", user.id).order("created_at", { ascending: false }).limit(25);
      if (error) {
        console.warn("Web3Market notifications:", error.message);
        items.innerHTML = '<div class="w3m-notify-empty">Notifications are temporarily unavailable.</div>';
        return;
      }
      const rows = data || [];
      const unread = rows.filter(n => !n.read_at).length;
      count.hidden = unread === 0;
      count.textContent = unread > 99 ? "99+" : String(unread);
      if (!rows.length) {
        items.innerHTML = '<div class="w3m-notify-empty">You are all caught up. New offers and accepted offers will appear here.</div>';
        return;
      }
      items.innerHTML = rows.map(n => {
        const data = n.data && typeof n.data === "object" ? n.data : {};
        const dealId = String(data.deal_id || "");
        const href = dealId ? "deal-room.html?deal=" + encodeURIComponent(dealId) : "marketplace.html";
        return '<a class="w3m-notify-item ' + (!n.read_at ? "unread" : "") + '" href="' + href + '" data-notification-id="' + esc(n.id) + '"><strong>' + esc(n.title || "Web3Market notification") + '</strong><span>' + esc(n.message || "") + '</span><small>' + esc(n.created_at ? new Date(n.created_at).toLocaleString() : "") + '</small></a>';
      }).join("");
    }

    button.addEventListener("click", async () => {
      const open = panel.hidden;
      panel.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
      if (open) await load();
    });
    document.getElementById("w3mNotifyRefresh").addEventListener("click", load);
    items.addEventListener("click", async (event) => {
      const link = event.target.closest("[data-notification-id]");
      if (!link) return;
      event.preventDefault();
      const sb = client();
      if (sb && currentUser) {
        try { await sb.rpc("mark_notification_read", { p_notification_id: link.dataset.notificationId }); }
        catch (e) { console.warn("Could not mark notification as read", e); }
      }
      window.location.href = link.href;
    });
    document.addEventListener("click", event => {
      if (!wrap.contains(event.target)) { panel.hidden = true; button.setAttribute("aria-expanded", "false"); }
    });
    await load();
    window.setInterval(() => { if (!panel.hidden) load(); else load(); }, 60000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(init, 0));
  else setTimeout(init, 0);
})();
