"use strict";
(async function(){
  const root=document.getElementById("buyerRoot");
  if(!root)return;
  const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
  if(!sb){root.innerHTML='<div class="notice">Database connection unavailable.</div>';return;}

  const esc=v=>String(v??"").replace(/[&<>\"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
  const {data:auth,error:authError}=await sb.auth.getUser();
  const user=auth?.user;
  if(authError||!user){location.replace("login.html?next=buyer-dashboard.html");return;}

  // Authorization is based ONLY on the server-backed profiles.role.
  const {data:profile,error:profileError}=await sb.from("profiles").select("id,display_name,email,bio,wallet_address,role").eq("id",user.id).maybeSingle();
  const role=String(profile?.role||"").toLowerCase();
  if(profileError||!profile||role!=="buyer"){
    root.innerHTML='<div class="notice">This account is not a Buyer account. Redirecting…</div>';
    setTimeout(()=>location.replace(role==="seller"?"seller-dashboard.html":"marketplace.html"),700);
    return;
  }

  const name=profile.display_name||"Web3 Buyer";
  const email=profile.email||user.email||"";
  const initials=(name.match(/[A-Za-z0-9]/g)||["B"]).slice(0,2).join("").toUpperCase();
  const wallet=profile.wallet_address||"";

  // Buyer data is always scoped to this authenticated user's id.
  const {data:deals,error:dealsError}=await sb.from("deals").select("id,project_id,amount,currency,status,created_at").eq("buyer_id",user.id).order("created_at",{ascending:false});
  const rows=dealsError?[]:(deals||[]);
  const ids=[...new Set(rows.map(x=>x.project_id).filter(Boolean))];
  let projects=[];
  if(ids.length){const q=await sb.from("projects").select("id,title,status").in("id",ids);if(!q.error)projects=q.data||[];}
  const pmap=new Map(projects.map(p=>[p.id,p]));
  const done=rows.filter(x=>["completed","released","closed"].includes(String(x.status||"").toLowerCase()));
  const active=rows.filter(x=>!["completed","released","closed","cancelled","rejected"].includes(String(x.status||"").toLowerCase()));
  const spent=done.reduce((n,x)=>n+Number(x.amount||0),0);
  const money=n=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(n||0);
  const row=x=>{const p=pmap.get(x.project_id);return `<div class="row"><div><strong>${esc(p?.title||"Web3 Project")}</strong><div class="muted">${money(x.amount)} · ${x.created_at?new Date(x.created_at).toLocaleDateString():""}</div></div><span class="badge">${esc(String(x.status||"pending").replace(/[_-]+/g," "))}</span></div>`};

  root.innerHTML=`<section class="hero"><div class="eyebrow">Buyer Center</div><h1>Welcome, ${esc(name)}</h1><p>This is your independent Web3Market buyer account.</p><div class="actions"><a class="btn primary" href="marketplace.html">Browse Marketplace</a><a class="btn" href="verification.html">Manage Profile</a></div></section>
  <div class="notice">✓ Verified Buyer · ${esc(email)} · Data below belongs only to this authenticated Buyer ID.</div>
  <section class="grid"><div class="card"><div class="label">TOTAL SPENT</div><div class="value">${money(spent)}</div></div><div class="card"><div class="label">PURCHASES</div><div class="value">${done.length}</div></div><div class="card"><div class="label">ACTIVE DEALS</div><div class="value">${active.length}</div></div></section>
  <section class="layout"><div><div class="panel"><h2>Active Deals</h2>${active.slice(0,8).map(row).join("")||'<div class="empty">No active purchases yet.</div>'}</div><div class="panel"><h2>Purchase History</h2>${done.slice(0,8).map(row).join("")||'<div class="empty">No completed purchases yet.</div>'}</div></div>
  <aside><div class="panel"><h2>Buyer Identity</h2><strong>${esc(name)}</strong><div class="muted" style="margin-top:5px">${esc(email)}</div><div class="badge" style="display:inline-block;margin-top:10px">BUYER</div></div><div class="panel"><h2>Wallet</h2><strong>${esc(wallet?wallet.slice(0,6)+"…"+wallet.slice(-4):"Not connected")}</strong><div class="muted" style="margin:7px 0 12px">${wallet?"Connected to this Buyer profile.":"No wallet connected yet."}</div><a class="btn primary" href="verification.html">${wallet?"Manage Wallet":"Connect Wallet"}</a></div><div class="panel"><h2>Quick Access</h2><div class="actions" style="flex-direction:column"><a class="btn" href="marketplace.html">Marketplace</a><a class="btn" href="deal-room.html">Deal Room</a><a class="btn" href="escrow-testnet.html">Escrow</a></div></div></aside></section>`;
})();
