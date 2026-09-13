"use strict";
(async function(){
  const root=document.getElementById("buyerRoot");
  if(!root)return;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const error=m=>{root.innerHTML='<div class="notice">'+m+'</div>';};
  try{
    let sb=null;
    for(let i=0;i<50&&!sb;i++){
      sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase||null;
      if(!sb?.auth){sb=null;await sleep(100);}
    }
    if(!sb){error("Unable to connect to the database. Please reload the page.");return;}
    let user=null;
    for(let i=0;i<20&&!user;i++){
      try{user=(await sb.auth.getSession())?.data?.session?.user||null;}catch(e){}
      if(!user){try{await window.Web3MarketSupabaseRestoreSession?.();}catch(e){}}
      if(!user)await sleep(200);
    }
    if(!user){error("No active session was found. Please sign in again.");return;}
    const pr=await sb.from("profiles").select("id,display_name,email,bio,wallet_address,role").eq("id",user.id).maybeSingle();
    if(pr.error||!pr.data){error("Unable to load your Buyer profile.");return;}
    const profile=pr.data;
    if(String(profile.role||"").toLowerCase()!=="buyer"){error("This account is not a Buyer account.");return;}
    const dq=await sb.from("deals").select("id,project_id,amount,currency,status,created_at,platform_fee_percent,platform_fee_amount,seller_net_amount,payment_tx_hash").eq("buyer_id",user.id).order("created_at",{ascending:false});
    if(dq.error){error("Unable to load your deals.");return;}
    const deals=dq.data||[];
    const ids=[...new Set(deals.map(x=>x.project_id).filter(Boolean))];
    let projects=[];
    if(ids.length){const pq=await sb.from("projects").select("id,title,status,asking_price,currency").in("id",ids);if(!pq.error)projects=pq.data||[];}
    const pmap=new Map(projects.map(p=>[p.id,p]));
    const done=deals.filter(x=>["completed","released","closed"].includes(String(x.status||"").toLowerCase()));
    const active=deals.filter(x=>!["completed","released","closed","cancelled","rejected"].includes(String(x.status||"").toLowerCase()));
    const spent=done.reduce((n,x)=>n+Number(x.amount||0),0);
    const money=(n,c)=>`${Number(n||0).toLocaleString(undefined,{maximumFractionDigits:2})} ${c||"USD"}`;
    const esc=v=>String(v??"").replace(/[&<>\"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
    const statusClass=s=>{s=String(s||"pending").toLowerCase();return s.includes("complete")||s==="released"||s==="closed"?"success":s.includes("cancel")||s.includes("reject")||s.includes("dispute")?"danger":"pending";};
    const row=x=>{const p=pmap.get(x.project_id);return `<a href="deal-room.html?deal=${encodeURIComponent(x.id)}" style="display:block;text-decoration:none;color:inherit"><div class="deal-row"><div class="deal-icon">◈</div><div class="deal-info"><strong>${esc(p?.title||"Web3 Project")}</strong><div class="muted">${money(x.amount,x.currency)} · ${x.created_at?new Date(x.created_at).toLocaleDateString():""}</div><div class="muted">${x.payment_tx_hash?"Payment verified":"Payment pending"} · Fee ${money(x.platform_fee_amount,x.currency)}</div></div><span class="status ${statusClass(x.status)}">${esc(String(x.status||"pending").replace(/[_-]+/g," "))}</span><span class="arrow">›</span></div></a>`;};
    const name=profile.display_name||"Web3 Buyer";
    const email=profile.email||user.email||"";
    const wallet=profile.wallet_address||"";
    root.innerHTML=`<section class="dash-head"><div><div class="eyebrow">BUYER DASHBOARD</div><h1>Good to see you, ${esc(name)} ✦</h1><p>Manage purchases, payment verification and every deal in one place.</p></div></section><div class="notice">● <b>Buyer account verified</b> · ${esc(email)} <span class="secure">🔒 Account-scoped data</span></div><section class="grid"><div class="card stat"><div class="stat-top"><span class="stat-label">TOTAL SPENT</span><span class="stat-icon purple">$</span></div><div class="value">${money(spent)}</div><small>Completed purchases</small></div><div class="card stat"><div class="stat-top"><span class="stat-label">PURCHASES</span><span class="stat-icon blue">✓</span></div><div class="value">${done.length}</div><small>Successfully completed</small></div><div class="card stat"><div class="stat-top"><span class="stat-label">ACTIVE DEALS</span><span class="stat-icon violet">↗</span></div><div class="value">${active.length}</div><small>Currently in progress</small></div></section><section class="layout"><div class="main-column"><div class="panel section-panel"><div class="section-title"><div><h2>Active Deals</h2><p>Track purchases and payment verification</p></div></div>${active.slice(0,8).map(row).join("")||'<div class="empty"><b>No active purchases</b><span>Your accepted deals will appear here.</span><a class="btn primary" href="marketplace.html">Browse Marketplace</a></div>'}</div><div class="panel section-panel"><div class="section-title"><div><h2>Purchase History</h2><p>Your completed transactions</p></div><span class="count-pill">'+done.length+'</span></div>${done.slice(0,8).map(row).join("")||'<div class="empty"><b>No completed purchases yet</b></div>'}</div></div><aside><div class="panel profile-card"><div class="side-title"><span>BUYER IDENTITY</span></div><div class="identity"><div class="big-avatar">${esc((name.match(/[A-Za-z0-9]/g)||["B"]).slice(0,2).join("").toUpperCase())}</div><div><strong>${esc(name)}</strong><div class="muted">${esc(email)}</div></div></div><div class="buyer-badge">✓ VERIFIED BUYER</div><a class="side-link" href="verification.html">Edit profile →</a></div><div class="panel wallet-card"><div class="side-title"><span>WALLET</span></div><div class="wallet-address">${esc(wallet?wallet.slice(0,8)+"…"+wallet.slice(-6):"Not connected")}</div><div class="muted wallet-text">${wallet?"Connected to your Buyer profile.":"Connect a wallet when ready to transact."}</div><a class="btn primary full" href="verification.html">${wallet?"Manage Wallet":"Connect Wallet"}</a></div><div class="panel"><div class="side-title"><span>TRANSACTION PROTECTION</span></div><div class="feature-row"><div class="fi">✓</div><div><strong>On-chain payment verification</strong><small>Payments are verified against the locked deal, buyer wallet, Safe and token.</small></div></div><div class="feature-row"><div class="fi">7.5%</div><div><strong>Transparent platform fee</strong><small>The fee is locked when the deal is created.</small></div></div></div></aside></section>`;
  }catch(e){console.error("Buyer dashboard:",e);error("Unable to load the Buyer dashboard. Please reload the page.");}
})();