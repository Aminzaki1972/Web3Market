"use strict";
(async function(){
 const root=document.querySelector('#buyerGrid');
 if(!root)return;
 async function getClient(){for(let i=0;i<40;i++){const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;if(sb?.auth)return sb;await new Promise(r=>setTimeout(r,100))}return null;}
 const sb=await getClient();
 if(!sb){root.innerHTML='<div class="seller-banner">⚠ Unable to connect to the database. Please reload and try again.</div>';return;}
 const {data:{user},error:authError}=await sb.auth.getUser();
 if(authError||!user){location.replace('login.html?next=buyer-dashboard.html');return;}
 const esc=v=>String(v??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[m]));
 const money=(v,c)=>v==null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:c||'USD',maximumFractionDigits:2}).format(Number(v));
 const {data:profile,error:profileError}=await sb.from('profiles').select('id,display_name,email,bio,wallet_address,wallet_verified,wallet_verified_at,role').eq('id',user.id).maybeSingle();
 if(profileError||String(profile?.role||'').toLowerCase()!=='buyer'){location.replace('marketplace.html');return;}
 const wallet=profile.wallet_address||''; const walletVerified=profile.wallet_verified===true; const walletLabel=wallet?wallet.slice(0,6)+'…'+wallet.slice(-4):'Not connected';
 const walletText=walletVerified?'Connected and ownership verified.':wallet?'Wallet connected, but ownership is not verified. Verify the wallet to continue.':'Connect and verify a Web3 wallet for buyer activity.';
 const walletButton=walletVerified?'Manage Wallet':wallet?'Verify Wallet':'Connect Wallet';
 /* Existing buyer dashboard rendering continues below; wallet state is now DB-backed. */
 const initials=(profile.display_name||user.email||'B').split(/[\s@._-]+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();
 const name=esc(profile.display_name||'Web3 Buyer'); const email=esc(profile.email||user.email||'');
 root.innerHTML=`<div class="dash-top"><div><h1>Buyer Dashboard</h1><p>Manage your Web3 project purchases and protected deal workflow.</p></div><div class="dash-actions"><a class="dash-btn" href="marketplace.html">View Marketplace</a></div></div><section class="profile-card"><div class="avatar">${esc(initials||'B')}</div><div class="profile"><h2>${name}<span class="verified">✓ Verified role</span></h2><p>${email}</p></div></section><section class="seller-grid"><div><div class="panel"><h2>Buyer Workspace</h2><div class="empty">Your purchases, offers and Deal Rooms will appear here.</div></div></div><aside><div class="panel" id="wallet"><h2>Wallet & Purchases</h2><p class="muted">${esc(walletLabel)}</p><p class="muted">${esc(walletText)}</p>${walletVerified?'<div class="status-pill" style="background:#ecfdf3;color:#166534;margin-bottom:10px">✓ Ownership verified</div>':''}<a class="dash-btn primary full" href="verification.html">${walletButton}</a></div></aside></section>`;
 const sideWallet=document.getElementById('sideWallet');if(sideWallet)sideWallet.textContent=walletLabel;
})();