"use strict";
(async function(){
 const root=document.querySelector('#buyerGrid');
 const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 if(!root)return;
 if(!sb){root.innerHTML='<div class="buyer-banner">⚠ Database connection unavailable.</div>';return;}
 const {data:{user},error:authError}=await sb.auth.getUser();
 if(authError||!user){location.replace('login.html?next=buyer-dashboard.html');return;}
 const esc=v=>String(v??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[m]));
 const money=(v,c)=>v==null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:c||'USD',maximumFractionDigits:0}).format(Number(v));
 const {data:profile,error:profileError}=await sb.from('profiles').select('display_name,email,bio,wallet_address,role').eq('id',user.id).maybeSingle();
 if(profileError||String(profile?.role||'').toLowerCase()!=='buyer'){location.replace('marketplace.html');return;}
 const dealsResult=await sb.from('deals').select('id,project_id,seller_id,amount,currency,status,created_at').eq('buyer_id',user.id).order('created_at',{ascending:false});
 const deals=dealsResult.error?[]:(dealsResult.data||[]);
 const ids=[...new Set(deals.map(d=>d.project_id).filter(Boolean))];let projects=[];
 if(ids.length){const r=await sb.from('projects').select('id,title,status,price,currency,created_at').in('id',ids);if(!r.error)projects=r.data||[];}
 const completed=deals.filter(d=>['completed','released','closed'].includes(String(d.status||'').toLowerCase()));
 const pending=deals.filter(d=>!['completed','released','closed','cancelled','rejected'].includes(String(d.status||'').toLowerCase()));
 const spent=completed.reduce((s,d)=>s+Number(d.amount||0),0);
 const purchased=completed.length;
 const initials=(profile.display_name||user.email||'B').split(/[\s@._-]+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();
 const name=esc(profile.display_name||'Web3 Buyer');
 const email=esc(profile.email||user.email||'');
 const wallet=profile.wallet_address||'';
 const walletLabel=wallet?wallet.slice(0,6)+'…'+wallet.slice(-4):'Not connected';
 const reputation=Math.min(100,70+purchased*3);
 const byId=new Map(projects.map(p=>[p.id,p]));
 const statusLabel=s=>esc(String(s||'pending').replace(/[_-]+/g,' '));
 root.innerHTML=`
 <div class="dash-top"><div><div style="font-size:11px;font-weight:900;color:#7c3aed;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:7px">Buyer Center</div><h1>Welcome back, ${name}</h1><p>Discover, evaluate and purchase premium Web3 businesses from one secure workspace.</p></div><div class="dash-actions"><a class="dash-btn" href="marketplace.html">View Marketplace</a><a class="dash-btn primary" href="marketplace.html">⌕ Find a Project</a></div></div>
 <div class="buyer-banner">✦ <span>Your buyer workspace is ready</span> — manage purchases, offers, deals, reputation and payments securely.</div>
 <section class="profile-card"><div class="avatar">${esc(initials||'B')}</div><div class="profile"><h2>${name}<span class="verified">✓ Verified Buyer</span></h2><p>${email}</p><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><span class="status-pill" style="background:#f5f3ff;color:#6d28d9">Buyer Protection</span><span class="status-pill" style="background:#ecfeff;color:#0369a1">${wallet?'Wallet Connected':'Wallet Not Connected'}</span></div></div><a class="dash-btn" href="verification.html">Manage profile</a></section>
 <section class="stats"><div class="stat"><div class="label">TOTAL SPENT</div><div class="value">${money(spent,'USD')}</div><div class="sub">Completed purchases</div></div><div class="stat"><div class="label">PURCHASED PROJECTS</div><div class="value">${purchased}</div><div class="sub">${deals.length} total deals</div></div><div class="stat"><div class="label">ACTIVE DEALS</div><div class="value">${pending.length}</div><div class="sub">Awaiting your action</div></div><div class="stat"><div class="label">REPUTATION</div><div class="value">${reputation}<span style="font-size:13px;color:#94a3b8">/100</span></div><div class="sub">Trusted buyer score</div></div></section>
 <section class="buyer-grid"><div>
 <div class="panel" id="deals"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2>Active Deals</h2><span class="status-pill" style="background:#f5f3ff;color:#6d28d9">${pending.length} active</span></div>${pending.length?pending.slice(0,6).map(d=>{const p=byId.get(d.project_id);return `<article class="listing"><div><h3><a href="project.html?id=${encodeURIComponent(d.project_id||'')}">${esc(p?.title||'Web3 Project')}</a></h3><div class="muted">${money(d.amount,d.currency)} · ${d.created_at?new Date(d.created_at).toLocaleDateString():''}</div></div><span class="status-pill">${statusLabel(d.status)}</span></article>`}).join(''):'<div class="empty">No active deals. Browse the marketplace to start your first secure purchase.</div>'}</div>
 <div class="panel" id="purchases"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2>Recent Purchases</h2><a class="muted" href="marketplace.html" style="text-decoration:none;font-weight:800">Browse more →</a></div>${completed.length?completed.slice(0,6).map(d=>{const p=byId.get(d.project_id);return `<article class="listing"><div><h3><a href="project.html?id=${encodeURIComponent(d.project_id||'')}">${esc(p?.title||'Web3 Project')}</a></h3><div class="muted">${money(d.amount,d.currency)} · ${d.created_at?new Date(d.created_at).toLocaleDateString():''}</div></div><span class="status-pill" style="background:#ecfdf3;color:#15803d">✓ Completed</span></article>`}).join(''):'<div class="empty">No purchases yet.<br><br><a class="dash-btn primary" href="marketplace.html">Find your first project</a></div>'}</div>
 <div class="panel" id="spending"><h2>Spending Overview</h2><div style="display:flex;justify-content:space-between;align-items:end;gap:20px"><div><div class="value" style="font-size:30px;font-weight:900">${money(spent,'USD')}</div><p class="muted" style="margin:5px 0 0">Completed purchase volume</p></div><div style="text-align:right"><div style="font-size:20px;font-weight:900">${deals.length}</div><div class="muted">Total transactions</div></div></div></div>
 </div><aside>
 <div class="panel"><h2>Buyer Profile</h2><div class="profile-row"><div class="avatar">${esc(initials||'B')}</div><div><strong>${name}</strong><div class="muted">${email}</div></div></div>${profile.bio?`<p class="muted" style="margin-top:13px">${esc(profile.bio)}</p>`:''}</div>
 <div class="panel" id="reviews"><h2>Reputation</h2><div class="score">${reputation}/100</div><div class="muted">Trusted buyer score</div><div class="progress"><span style="width:${reputation}%"></span></div><div class="muted">Build reputation through successful transactions and verified reviews.</div></div>
 <div class="panel"><h2>Quick Actions</h2><div class="quick-links"><a href="marketplace.html">⌕ Browse Projects</a><a href="deal-room.html">◈ Deal Room</a><a href="verification.html">✓ Verification</a><a href="escrow-testnet.html">🔐 Escrow</a></div></div>
 <div class="panel" id="wallet"><h2>Wallet & Payments</h2><div style="font-size:18px;font-weight:900;margin-bottom:5px">${esc(walletLabel)}</div><p class="muted">${wallet?'Connected to your buyer profile.':'Connect a wallet before making a blockchain payment.'}</p><a class="dash-btn ${wallet?'':'primary'}" href="verification.html">${wallet?'Manage Wallet':'Connect Wallet'}</a></div>
 <div class="panel" id="messages"><div style="display:flex;justify-content:space-between;align-items:center"><h2>Messages</h2><span class="status-pill">0 new</span></div><div class="empty">No new messages. Seller conversations will appear here.</div></div>
 </aside></section>`;
 const sideWallet=document.getElementById('sideWallet');if(sideWallet)sideWallet.textContent=walletLabel;
})();
