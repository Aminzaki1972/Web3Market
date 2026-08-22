"use strict";
(async function () {
  const root = document.getElementById("buyerRoot");
  if (!root) return;

  const sb = window.Web3MarketSupabase?.getClient?.() || window.supabaseClient || window.web3marketSupabase;
  if (!sb) {
    root.innerHTML = '<div class="notice">Database connection unavailable.</div>';
    return;
  }

  const esc = (v) => String(v ?? "").replace(/[&<>\"']/g, (m) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));

  const { data: authData, error: authError } = await sb.auth.getUser();
  const user = authData?.user;
  if (authError || !user) {
    location.replace("login.html?next=buyer-dashboard.html");
    return;
  }

  // Buyer identity comes ONLY from profiles.role. Auth metadata is never used for authorization.
  const { data: profile, error: profileError } = await sb
    .from("profiles")
    .select("id,display_name,email,bio,wallet_address,role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile || String(profile.role || "").toLowerCase() !== "buyer") {
    root.innerHTML = '<div class="notice">This page is reserved for buyer accounts.</div>';
    setTimeout(() => location.replace("marketplace.html"), 1200);
    return;
  }

  const name = profile.display_name || "Web3 Buyer";
  const email = profile.email || user.email || "";
  const initials = name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(x => x[0]).join("").toUpperCase() || "B";
  const wallet = profile.wallet_address || "";
  const walletLabel = wallet ? wallet.slice(0, 6) + "…" + wallet.slice(-4) : "Not connected";

  // IMPORTANT: every transaction query is scoped to the authenticated buyer id.
  let deals = [];
  const dealsQuery = await sb
    .from("deals")
    .select("id,project_id,amount,currency,status,created_at")
    .eq("buyer_id", user.id)
    .order("created_at", { ascending: false });

  if (!dealsQuery.error) deals = dealsQuery.data || [];

  const projectIds = [...new Set(deals.map(d => d.project_id).filter(Boolean))];
  let projects = [];
  if (projectIds.length) {
    const projectQuery = await sb
      .from("projects")
      .select("id,title,status,price,currency,created_at")
      .in("id", projectIds);
    if (!projectQuery.error) projects = projectQuery.data || [];
  }

  const byId = new Map(projects.map(p => [p.id, p]));
  const completed = deals.filter(d => ["completed", "released", "closed"].includes(String(d.status || "").toLowerCase()));
  const active = deals.filter(d => !["completed", "released", "closed", "cancelled", "rejected"].includes(String(d.status || "").toLowerCase()));
  const spent = completed.reduce((sum, d) => sum + Number(d.amount || 0), 0);
  const money = (value, currency) => value == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 0 }).format(Number(value));
  const reputation = Math.min(100, 70 + completed.length * 3);

  const dealRows = active.slice(0, 6).map(d => {
    const p = byId.get(d.project_id);
    return `<div class="item"><div><strong>${esc(p?.title || "Web3 Project")}</strong><div class="muted">${money(d.amount, d.currency)} · ${d.created_at ? new Date(d.created_at).toLocaleDateString() : ""}</div></div><span class="pill">${esc(String(d.status || "pending").replace(/[_-]+/g, " "))}</span></div>`;
  }).join("");

  const purchaseRows = completed.slice(0, 6).map(d => {
    const p = byId.get(d.project_id);
    return `<div class="item"><div><strong>${esc(p?.title || "Web3 Project")}</strong><div class="muted">${money(d.amount, d.currency)} · ${d.created_at ? new Date(d.created_at).toLocaleDateString() : ""}</div></div><span class="pill" style="background:#ecfdf3;color:#15803d">Completed</span></div>`;
  }).join("");

  root.innerHTML = `
    <section class="hero">
      <div><div class="eyebrow">Buyer Account</div><h1>Welcome, ${esc(name)}</h1><p>Your private Web3Market workspace for buying and managing Web3 projects.</p></div>
      <div class="actions"><a class="btn" href="marketplace.html">Marketplace</a><a class="btn primary" href="marketplace.html">Find a Project</a></div>
    </section>
    <div class="notice">✓ Buyer account verified — this dashboard loads only data belonging to <strong>${esc(email)}</strong>.</div>
    <section class="identity"><div class="avatar">${esc(initials)}</div><div class="identity-main"><h2>${esc(name)}</h2><p>${esc(email)}</p><span class="role">BUYER</span></div><a class="btn" href="verification.html">Manage Profile</a></section>
    <section class="grid">
      <div class="card"><div class="label">TOTAL SPENT</div><div class="value">${money(spent, "USD")}</div><div class="sub">Completed purchases</div></div>
      <div class="card"><div class="label">PURCHASES</div><div class="value">${completed.length}</div><div class="sub">Successful transactions</div></div>
      <div class="card"><div class="label">ACTIVE DEALS</div><div class="value">${active.length}</div><div class="sub">Awaiting action</div></div>
    </section>
    <section class="content">
      <div>
        <div class="panel"><h2>Active Deals</h2>${dealRows || '<div class="empty">No active deals yet. Start by browsing the marketplace.</div>'}</div>
        <div class="panel"><h2>Recent Purchases</h2>${purchaseRows || '<div class="empty">No completed purchases yet.</div>'}</div>
      </div>
      <aside>
        <div class="panel"><h2>Buyer Profile</h2><div style="display:flex;gap:12px;align-items:center"><div class="avatar">${esc(initials)}</div><div><strong>${esc(name)}</strong><div class="muted">${esc(email)}</div></div></div>${profile.bio ? `<p class="muted" style="margin-top:12px">${esc(profile.bio)}</p>` : ""}</div>
        <div class="panel"><h2>Reputation</h2><div style="font-size:28px;font-weight:900">${reputation}/100</div><div class="muted">Buyer reputation score</div></div>
        <div class="panel"><h2>Wallet</h2><div style="font-size:18px;font-weight:900">${esc(walletLabel)}</div><p class="muted">${wallet ? "Connected to this buyer profile." : "No wallet connected yet."}</p><a class="btn ${wallet ? "" : "primary"}" href="verification.html">${wallet ? "Manage Wallet" : "Connect Wallet"}</a></div>
        <div class="panel"><h2>Quick Actions</h2><div class="links"><a href="marketplace.html">Browse Projects</a><a href="deal-room.html">Deal Room</a><a href="verification.html">Verification</a><a href="escrow-testnet.html">Escrow</a></div></div>
      </aside>
    </section>`;
})();
