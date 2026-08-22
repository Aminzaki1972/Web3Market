"use strict";
(async function(){
 const root=document.querySelector('#sellerGrid');
 const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 if(!root)return;
 if(!sb){root.innerHTML='<div class="status">Database connection unavailable.</div>';return;}
 const {data:{user},error:authError}=await sb.auth.getUser();
 if(authError||!user){root.innerHTML='<div class="status">Please sign in to view your seller dashboard.</div>';return;}
 const esc=v=>String(v??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[m]));
 const money=(v,c)=>v==null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:c||'USD',maximumFractionDigits:0}).format(Number(v));
 const [profileResult, projectsResult, walletsResult]=await Promise.all([
   sb.from('profiles').select('display_name,email,bio,wallet_address,role,updated_at').eq('id',user.id).maybeSingle(),
   sb.from('projects').select('id,title,status,price,currency,created_at').eq('owner_id',user.id).order('created_at',{ascending:false}),
   sb.from('wallets').select('id,address,chain_id,network,is_verified,verified_at').eq('user_id',user.id).order('created_at',{ascending:false})
 ]);
 if(profileResult.error){console.error(profileResult.error);root.innerHTML='<div class="status">Unable to load your seller profile.</div>';return;}
 if(projectsResult.error){console.error(projectsResult.error);root.innerHTML='<div class="status">Unable to load your projects.</div>';return;}
 const profile=profileResult.data||{};
 const projects=projectsResult.data||[];
 const wallets=walletsResult.error?[]:(walletsResult.data||[]);
 const ids=projects.map(p=>p.id);let deals=[];
 if(ids.length){const r=await sb.from('deals').select('id,project_id,buyer_id,amount,currency,status,created_at').in('project_id',ids).order('created_at',{ascending:false});if(r.error)console.error(r.error);else deals=r.data||[];}
 const completed=deals.filter(d=>['completed','released','closed'].includes(String(d.status||'').toLowerCase()));
 const pending=deals.filter(d=>!['completed','released','closed','cancelled','rejected'].includes(String(d.status||'').toLowerCase()));
 const revenueUsd=completed.filter(d=>String(d.currency||'USD').toUpperCase()==='USD').reduce((s,d)=>s+Number(d.amount||0),0);
 const active=projects.filter(p=>['published','active','live'].includes(String(p.status||'').toLowerCase())).length;
 const initials=(profile.display_name||user.email||'S').split(/[\s@._-]+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();
 const name=esc(profile.display_name||'Web3 Seller');
 const email=esc(profile.email||user.email||'');
 const reputation=completed.length?Math.min(100,70+completed.length*3):70;
 const byId=new Map(projects.map(p=>[p.id,p]));
 const wallet=wallets[0];
 const walletLabel=wallet?.address ? `${wallet.address.slice(0,6)}…${wallet.address.slice(-4)}` : 'Not connected';
 const walletStatus=wallet?.is_verified?'Verified':'Not verified';
 root.innerHTML=`
 <section class="seller-hero"><div><div class="eyebrow">SELLER WORKSPACE</div><h1>Your <span>Web3 business.</span></h1><p>Manage listings, offers, reputation and earnings from one place.</p></div><div class="seller-actions"><a class="seller-btn primary" href="sell-project.html">+ List a Project</a><a class="seller-btn" href="marketplace.html">View Marketplace</a></div></section>
 <section class="stats"><div class="stat"><div class="label">Total Revenue</div><div class="value">${money(revenueUsd,'USD')}</div><div class="sub">Completed USD deals</div></div><div class="stat"><div class="label">Active Listings</div><div class="value">${active}</div><div class="sub">${projects.length} total listings</div></div><div class="stat"><div class="label">Incoming Offers</div><div class="value">${pending.length}</div><div class="sub">Awaiting action</div></div><div class="stat"><div class="label">Completed Deals</div><div class="value">${completed.length}</div><div class="sub">Successful transactions</div></div></section>
 <section class="seller-grid"><div>
 <div class="panel"><h2>Your Listings</h2>${projects.length?projects.slice(0,8).map(p=>`<article class="listing"><div><h3><a href="project.html?id=${encodeURIComponent(p.id)}">${esc(p.title||'Untitled project')}</a></h3><div class="muted">${money(p.price,p.currency)} · ${esc(p.created_at?new Date(p.created_at).toLocaleDateString():'')}</div></div><span class="status-pill">${esc(p.status||'draft')}</span></article>`).join(''):'<div class="empty">No projects yet. Create your first Web3 listing and start receiving offers.</div>'}</div>
 <div class="panel"><h2>Incoming Offers & Deals</h2>${deals.length?deals.slice(0,8).map(d=>`<article class="listing"><div><h3><a href="project.html?id=${encodeURIComponent(d.project_id)}">${esc(byId.get(d.project_id)?.title||'Project')}</a></h3><div class="muted">${money(d.amount,d.currency)} · ${d.created_at?new Date(d.created_at).toLocaleDateString():''}</div></div><span class="status-pill">${esc(d.status||'pending')}</span></article>`).join(''):'<div class="empty">No incoming offers yet.</div>'}</div>
 </div><aside>
 <div class="panel"><h2>Seller Profile</h2><div class="profile"><div class="avatar">${esc(initials)}</div><div><h3>${name}</h3><div class="muted">${email}</div><span class="badge">Seller Account</span></div></div>${profile.bio?`<p class="muted" style="margin-top:14px">${esc(profile.bio)}</p>`:''}</div>
 <div class="panel"><h2>Reputation</h2><div class="score">${reputation}/100</div><div class="muted">Seller Reputation Score</div><div class="progress"><span style="width:${reputation}%"></span></div><div class="muted">Based on completed deals and account activity. Verified reviews can be added as the marketplace grows.</div></div>
 <div class="panel"><h2>Seller Tools</h2><div class="quick-links"><a href="sell-project.html">➕ New Listing</a><a href="marketplace.html">🛍 Marketplace</a><a href="verification.html">✓ Verification</a><a href="escrow-testnet.html">🔐 Escrow</a></div></div>
 <div class="panel"><h2>Wallet & Payouts</h2><p class="muted">${esc(walletLabel)} · ${esc(walletStatus)}</p><p class="muted">${wallet?.network?`Network: ${esc(wallet.network)}`:'Connect and verify a wallet before enabling live withdrawals.'}</p><a class="seller-btn" href="verification.html">Manage Verification</a></div>
 </aside></section>`;
})();
