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
 root.innerHTML=`
 <div class="dash-top"><div><h1>Buyer Dashboard</h1><p>Manage your Web3 acquisitions from one professional workspace.</p></div><div class="dash-actions"><a class="dash-btn" href="marketplace.html">View Marketplace</a><a class="dash-btn primary" href="marketplace.html">⌕ Find a Project</a></div></div>
 <div class="buyer-banner">✦ Your buyer workspace is ready — manage purchases, offers, deals, reputation and payments securely.</div>
 <section class="profile-card"><div class="avatar">${esc(initials||'B')}</div><div class="profile"><h2>${name}<span class="verified">✓ Verified role</span></h2><p>${email}</p></div><a class="dash-btn" href="verification.html">Manage profile</a></section>
 <section class="stats"><div class="stat"><div class="label">TOTAL SPENT</div><div class="value">${money(spent,'USD')}</div><div class="sub">Completed purchases</div></div><div class="stat"><div class="label">PURCHASED PROJECTS</div><div class="value">${purchased}</div><div class="sub">${deals.length} total deals</div></div><div class="stat"><div class="label">ORDERS & OFFERS</div><div class="value">${deals.length}</div><div class="sub">${pending.length} awaiting action</div></div><div class="stat"><div class="label">COMPLETED DEALS</div><div class="value">${completed.length}</div><div class="sub">Successful transactions</div></div></section>
 <section class="buyer-grid"><div>
 <div class="panel" id="purchases"><h2>My Purchases</h2>${deals.length?deals.slice(0,8).map(d=>{const p=byId.get(d.project_id);return `<article class="listing"><div><h3><a href="project.html?id=${encodeURIComponent(d.project_id||'')}">${esc(p?.title||'Project')}</a></h3><div class="muted">${money(d.amount,d.currency)} · ${d.created_at?new Date(d.created_at).toLocaleDateString():''}</div></div><span class="status-pill">${esc(d.status||'pending')}</span></article>`}).join(''):'<div class="empty">No purchases yet.<br><br><a class="dash-btn primary" href="marketplace.html">Find your first project</a></div>'}</div>
 <div class="panel" id="deals"><h2>Orders & Deals</h2>${deals.length?deals.slice(0,8).map(d=>`<article class="listing"><div><h3><a href="project.html?id=${encodeURIComponent(d.project_id||'')}">${esc(byId.get(d.project_id)?.title||'Project')}</a></h3><div class="muted">${money(d.amount,d.currency)} · ${d.created_at?new Date(d.created_at).toLocaleDateString():''}</div></div><span class="status-pill">${esc(d.status||'pending')}</span></article>`).join(''):'<div class="empty">No orders or offers yet. New activity will appear here.</div>'}</div>
 <div class="panel" id="spending"><h2>Spending</h2><div class="value" style="font-size:28px;font-weight:900">${money(spent,'USD')}</div><p class="muted">Completed purchase volume tracked by Web3Market.</p></div>
 </div><aside>
 <div class="panel"><h2>Buyer Profile</h2><div class="profile-row"><div class="avatar">${esc(initials||'B')}</div><div><strong>${name}</strong><div class="muted">${email}</div></div></div>${profile.bio?`<p class="muted" style="margin-top:13px">${esc(profile.bio)}</p>`:''}</div>
 <div class="panel" id="reviews"><h2>Reputation</h2><div class="score">${reputation}/100</div><div class="muted">Buyer reputation</div><div class="progress"><span style="width:${reputation}%"></span></div><div class="muted">Your reputation grows with successful transactions and verified reviews.</div></div>
 <div class="panel"><h2>Buyer Tools</h2><div class="quick-links"><a href="marketplace.html">⌕ Browse Projects</a><a href="deal-room.html">◈ Deal Room</a><a href="verification.html">✓ Verification</a><a href="escrow-testnet.html">🔐 Escrow</a></div></div>
 <div class="panel" id="wallet"><h2>Wallet & Payments</h2><p class="muted">${esc(walletLabel)}</p><p class="muted">${wallet?'Wallet connected to your buyer profile.':'Connect a wallet before making a blockchain payment.'}</p><a class="dash-btn" href="verification.html">Manage Wallet</a></div>
 <div class="panel" id="messages"><h2>Messages</h2><div class="empty">No new messages.</div></div>
 </aside></section>`;
 const sideWallet=document.getElementById('sideWallet');if(sideWallet)sideWallet.textContent=walletLabel;
})();
