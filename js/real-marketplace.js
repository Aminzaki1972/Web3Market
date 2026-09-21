"use strict";
(function(){
  function isHomepage(){
    var p=(location.pathname||"").replace(/\/+$/,'');
    return p===""||p==="/index.html"||p.endsWith("/index.html");
  }
  function ensureHomepageUsesLiveListings(grid){
    if(!isHomepage()||!grid||grid.dataset.wmLiveCleaned==="1")return;
    grid.dataset.wmLiveCleaned="1";
    grid.innerHTML='<div class="empty">Loading active Web3 projects…</div>';
  }
  async function ensureSupabase(){
    if(window.Web3MarketSupabase?.getClient)return window.Web3MarketSupabase.getClient();
    if(window.supabaseClient)return window.supabaseClient;
    if(window.web3marketSupabase)return window.web3marketSupabase;
    if(!window.supabase){
      await new Promise(function(resolve,reject){
        var s=document.createElement('script');
        s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
        s.onload=resolve;s.onerror=reject;
        document.head.appendChild(s);
      });
    }
    if(!window.supabase?.createClient)return null;
    var c=window.supabase.createClient('https://hzhqlexnhtukfljcvnyd.supabase.co','sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI');
    window.supabaseClient=c;window.web3marketSupabase=c;
    window.Web3MarketSupabase={client:c,supabase:c,getClient:function(){return c}};
    return c;
  }
  async function render(){
    var grid=document.querySelector('.listingGrid');
    if(!grid)return;
    ensureHomepageUsesLiveListings(grid);
    try{
      var sb=await ensureSupabase();
      if(!sb){grid.innerHTML='<div class="empty">No active projects are currently listed for sale.</div>';return;}
      var q=await sb.from('projects').select('id,title,description,short_description,price,currency,category,status,project_status,created_at,ai_score,ai_status,logo_url,cover_image_url').in('status',['active','sold']).eq('project_status','approved').eq('ai_status','approved').order('created_at',{ascending:false}).limit(20);
      if(q.error)throw q.error;
      var data=(Array.isArray(q.data)?q.data:[]).filter(function(p){var s=String(p?.status||'').trim().toLowerCase();var isWeb3Jobs=String(p?.id||'').toLowerCase()==='f4547d2a-073d-483a-9842-4f575c7be4fb'||String(p?.title||'').trim().toLowerCase()==='web3jobs';return (s==='active'||(s==='sold'&&isWeb3Jobs))&&String(p?.project_status||'').trim().toLowerCase()==='approved'&&String(p?.ai_status||'').trim().toLowerCase()==='approved';}).slice(0,2);
      var old=document.getElementById('wm-live-projects-heading');
      if(!old){old=document.createElement('div');old.id='wm-live-projects-heading';old.innerHTML='<div style="display:flex;align-items:end;justify-content:space-between;gap:16px;margin:0 0 18px"><div><div style="font-size:11px;font-weight:950;letter-spacing:1px;color:#635bff">LIVE ACTIVE LISTINGS</div><h2 style="margin:5px 0 4px;font-size:32px;letter-spacing:-1px">Projects currently for sale</h2><p style="margin:0;color:#737b88;font-size:13px">Only approved, AI-reviewed projects with <b>status = active</b> are displayed below.</p></div><div style="font-size:13px;font-weight:900;color:#5149db">'+data.length+' active project'+(data.length===1?'':'s')+'</div></div>';grid.parentNode.insertBefore(old,grid);}else{var count=old.querySelector('div[style*="color:#5149db"]');if(count)count.textContent=data.length+' active project'+(data.length===1?'':'s');}
      if(!data.length){grid.innerHTML='<div class="empty">No active projects are currently listed for sale.</div>';return;}
      var esc=function(v){return String(v??'').replace(/[&<>"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]})};
      var money=function(v,c){var n=Number(v);if(!Number.isFinite(n)||n<=0)return 'Price on request';return esc(c||'USD')+' '+new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n)};
      var html=data.map(function(p,i){var image=p.cover_image_url||p.logo_url||'';var art=image?'<div class="listingArt" style="background-image:url(\''+esc(image)+'\');background-size:cover;background-position:center"></div>':'<div class="listingArt '+(i%4===1?'a2':i%4===2?'a3':i%4===3?'a4':'')+'"></div>';var desc=String(p.short_description||p.description||'Active Web3 project available for acquisition.').slice(0,140);var sold=String(p.id||'').toLowerCase()==='f4547d2a-073d-483a-9842-4f575c7be4fb'||String(p.title||'').trim().toLowerCase()==='web3jobs';var soldBadge=sold?'<span class="wm-sold-badge" aria-label="Sold">Sold</span>':'';var ai='<span class="ai-badge">AI '+(Number.isFinite(Number(p.ai_score))?esc(p.ai_score)+'/100':'Approved')+'</span>';return '<article class="listing" data-project-id="'+esc(p.id)+'"><a href="project.html?id='+encodeURIComponent(p.id)+'">'+art+'</a><div class="listingBody"><div class="seller"><span class="avatar"></span><span>Verified project</span>'+ai+'</div><h3 class="wm-project-title"><a href="project.html?id='+encodeURIComponent(p.id)+'">'+esc(p.title||'Untitled Web3 Project')+'</a>'+soldBadge+'</h3><div class="desc">'+esc(desc)+'</div><div class="meta"><div class="price2"><strong>'+money(p.price,p.currency)+'</strong><span>'+esc(p.category||'Web3 Project')+'</span></div><a class="buy" href="project.html?id='+encodeURIComponent(p.id)+'">'+(sold?'View record →':'View project →')+'</a></div></div></article>';}).join('');
      grid.innerHTML=html;grid.style.visibility='visible';
      if(!document.getElementById('web3market-live-project-style')){var st=document.createElement('style');st.id='web3market-live-project-style';st.textContent='.listingGrid{opacity:1!important;visibility:visible!important}.listingGrid .listing{min-height:100%}.listingGrid .listing h3 a{color:#141820;text-decoration:none}.listingGrid .listingArt:after{content:none}.ai-badge{display:inline-flex;align-items:center;margin-left:4px;padding:3px 6px;border-radius:999px;background:#eeedff;color:#5149db;font-size:9px;font-weight:900}.wm-project-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.wm-project-title a{color:#141820;text-decoration:none}.wm-sold-badge{display:inline-flex;align-items:center;padding:4px 9px;border-radius:7px;background:#16a34a;color:#fff;font-size:11px;font-weight:900;line-height:1;white-space:nowrap;box-shadow:0 2px 7px rgba(22,163,74,.18)}';document.head.appendChild(st)}
      window.dispatchEvent(new CustomEvent('web3market:projects-rendered',{detail:{count:data.length}}));
    }catch(e){grid.innerHTML='<div class="empty">No active projects are currently listed for sale.</div>';console.warn('Web3Market live marketplace unavailable',e);}
  }
  function boot(){render();setTimeout(render,1200);setTimeout(render,3000)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();

(function(){
  'use strict';
  function loadGuide(){
    var p=(location.pathname||'').replace(/\/+$/,'');
    var home=p===''||p==='/index.html'||p.endsWith('/index.html');
    if(!home||document.getElementById('wmx-homepage-enhancements'))return;
    var s=document.createElement('script');s.id='wmx-homepage-enhancements';s.src='/js/homepage-enhancements.js?v=20260914-restore-ai';s.async=true;
    (document.head||document.body||document.documentElement).appendChild(s);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',loadGuide,{once:true});else loadGuide();
  window.addEventListener('load',loadGuide,{once:true});setTimeout(loadGuide,500);
})();

/* Seller entry architecture: every seller CTA on the homepage goes to account creation first. */
(function(){
  'use strict';
  function sellerRegisterUrl(){return 'register.html?role=seller';}
  function normalizeSellerLinks(){
    if(!isHomepage())return;
    document.querySelectorAll('a').forEach(function(a){
      var href=(a.getAttribute('href')||'').trim().toLowerCase();
      var text=(a.textContent||'').trim().toLowerCase();
      if(href==='sell-project.html' || text==='list your project' || text==='create seller account'){
        a.setAttribute('href',sellerRegisterUrl());
        a.setAttribute('aria-label','Create seller account');
        a.dataset.wmSellerEntryFixed='1';
      }
    });
  }
  function isHomepage(){
    var p=(location.pathname||'').replace(/\/+$/,'');
    return p===''||p==='/index.html'||p.endsWith('/index.html');
  }
  function installClickGuard(){
    if(!isHomepage()||document.documentElement.dataset.wmSellerClickGuard==='1')return;
    document.documentElement.dataset.wmSellerClickGuard='1';
    document.addEventListener('click',function(ev){
      var a=ev.target&&ev.target.closest?ev.target.closest('a'):null;
      if(!a)return;
      var href=(a.getAttribute('href')||'').trim().toLowerCase();
      var text=(a.textContent||'').trim().toLowerCase();
      if(href==='sell-project.html' || text==='list your project' || text==='create seller account'){
        ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();
        window.location.assign(sellerRegisterUrl());
      }
    },true);
  }
  function bootSellerGuard(){installClickGuard();normalizeSellerLinks();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootSellerGuard,{once:true});else bootSellerGuard();
  window.addEventListener('load',bootSellerGuard,{once:true});
  [100,500,1000,2000,4000,7000].forEach(function(ms){setTimeout(bootSellerGuard,ms)});
})();
