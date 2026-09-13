"use strict";
(async function(){
  const root=document.getElementById("sellerGrid"); if(!root)return;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const error=m=>{root.innerHTML='<div class="seller-banner">⚠ '+m+'</div>';};
  try{
    let sb=null;
    for(let i=0;i<50&&!sb;i++){
      sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase||null;
      if(!sb?.auth && window.supabase?.createClient){try{sb=window.supabase.createClient("https://hzhqlexnhtukfljcvnyd.supabase.co","sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI",{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:"web3market-auth"}});window.web3marketSupabase=sb;window.supabaseClient=sb;}catch(e){sb=null;}}
      if(!sb?.auth){sb=null;await sleep(100);}
    }
    if(!sb){error("تعذر الاتصال بقاعدة البيانات. يرجى تحديث الصفحة.");return;}
    let user=null;
    for(let i=0;i<20&&!user;i++){try{user=(await sb.auth.getSession())?.data?.session?.user||null;}catch(e){} if(!user){try{await window.Web3MarketSupabaseRestoreSession?.();}catch(e){}} if(!user)await sleep(200);}
    if(!user){error("لم يتم العثور على جلسة دخول فعالة. يرجى تسجيل الدخول مرة أخرى.");return;}
    const pr=await sb.from("profiles").select("id,display_name,email,bio,wallet_address,role").eq("id",user.id).maybeSingle();
    if(pr.error||!pr.data){error("تعذر تحميل بيانات حساب البائع.");return;}
    const profile=pr.data;
    if(String(profile.role||"").toLowerCase()!=="seller"){error("هذا الحساب ليس حساب بائع.");return;}
    const pq=await sb.from("projects").select("id,title,status,asking_price,currency,created_at").eq("owner_id",user.id).order("created_at",{ascending:false});
    if(pq.error){error("تعذر تحميل مشاريعك.");return;}
    const projects=pq.data||[];
    const dq=await sb.from("deals").select("id,project_id,buyer_id,seller_id,amount,currency,status,created_at,platform_fee_percent,platform_fee_amount,seller_net_amount,payment_tx_hash").eq("seller_id",user.id).order("created_at",{ascending:false});
    const deals=dq.data||[];
    const esc=v=>String(v??"").replace(/[&<>\"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
    const money=(v,c)=>`${Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2})} ${c||"USD"}`;
    const completed=deals.filter(d=>["completed","released","closed"].includes(String(d.status||"").toLowerCase()));
    const active=deals.filter(d=>!["completed","released","closed","cancelled","rejected"].includes(String(d.status||"").toLowerCase()));
    const gross=completed.reduce((s,d)=>s+Number(d.amount||0),0), fees=completed.reduce((s,d)=>s+Number(d.platform_fee_amount||0),0), net=completed.reduce((s,d)=>s+Number(d.seller_net_amount??(Number(d.amount||0)-Number(d.platform_fee_amount||0)),0);
    const initials=(profile.display_name||user.email||"S").split(/[\s@._-]+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();
    const listingHtml=projects.slice(0,8).map(p=>`<article class="listing"><div><h3>${esc(p.title||"Untitled project")}</h3><div class="muted">${money(p.asking_price,p.currency)} · ${esc(p.status||"draft")}</div></div></article>`).join("")||'<div class="empty">No listings yet.</div>';
    const dealHtml=deals.slice(0,10).map(d=>{const p=projects.find(x=>x.id===d.project_id);return `<article class="listing"><div style="flex:1"><h3><a href="deal-room.html?deal=${encodeURIComponent(d.id)}">${esc(p?.title||"Deal Room")}</a></h3><div class="muted">${money(d.amount,d.currency)} · ${esc(d.status||"pending")}</div><div class="muted">${d.payment_tx_hash?"Payment verified":"Payment pending"} · Fee ${money(d.platform_fee_amount,d.currency)}</div></div><span class="status-pill">${esc(d.status||"pending")}</span></article>`;}).join("")||'<div class="empty">No deals yet.</div>';
    root.innerHTML=`<div class="dash-top"><div><h1>Seller Dashboard</h1><p>Manage listings and verified deals.</p></div><div class="dash-actions"><a class="dash-btn" href="marketplace.html">View Marketplace</a><a class="dash-btn primary" href="sell-project.html">＋ Add Listing</a></div></div><div class="seller-banner">✦ Seller workflow: listing → deal → verified payment → delivery.</div><section class="profile-card"><div class="avatar">${esc(initials)}</div><div class="profile"><h2>${esc(profile.display_name||"Web3 Seller")} <span class="verified">✓ Seller</span></h2><p>${esc(profile.email||user.email||"")}</p></div></section><section class="stats"><div class="stat"><div class="label">SELLER NET REVENUE</div><div class="value">${money(net)}</div></div><div class="stat"><div class="label">ACTIVE LISTINGS</div><div class="value">${projects.filter(p=>["active","published","under_offer"].includes(String(p.status||"").toLowerCase())).length}</div></div><div class="stat"><div class="label">ACTIVE DEALS</div><div class="value">${active.length}</div></div><div class="stat"><div class="label">COMPLETED DEALS</div><div class="value">${completed.length}</div></div></section><section class="seller-grid"><div><div class="panel" id="listings"><h2>My Listings</h2>${listingHtml}</div><div class="panel" id="deals"><h2>Orders & Deals</h2>${dealHtml}</div><div class="panel" id="earnings"><h2>Earnings & Platform Fee</h2><div class="value" style="font-size:28px;font-weight:900">${money(net)}</div><p class="muted">Gross ${money(gross)} · Platform fee ${money(fees)}</p></div></div><aside><div class="panel"><h2>Seller Profile</h2><div class="profile-row"><div class="avatar">${esc(initials)}</div><div><strong>${esc(profile.display_name||"Web3 Seller")}</strong><div class="muted">${esc(profile.email||user.email||"")}</div></div></div></div><div class="panel"><h2>Wallet & Payouts</h2><p class="muted">${esc(profile.wallet_address||"Not connected")}</p><a class="dash-btn" href="verification.html">Manage Wallet</a></div></aside></section>`;
  }catch(e){console.error("Seller dashboard:",e);error("تعذر تحميل لوحة البائع. يرجى تحديث الصفحة.");}
})();