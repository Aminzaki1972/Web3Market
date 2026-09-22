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
    if(!window.supabase?.createClient){
      await new Promise(function(resolve,reject){
        var s=document.createElement('script');
        s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
        s.onload=resolve;s.onerror=reject;document.head.appendChild(s);
      });
    }
    if(!window.supabase?.createClient)return null;
    var c=window.supabase.createClient('https://hzhqlexnhtukfljcvnyd.supabase.co','sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI');
    window.supabaseClient=c;window.web3marketSupabase=c;window.Web3MarketSupabase={client:c,supabase:c,getClient:function(){return c}};
    return c;
  }
  function esc(v){return String(v??'').replace(/[&<>"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]})}
  function money(v,c){var n=Number(v);if(!Number.isFinite(n)||n<=0)return 'Price on request';return esc(c||'USD')+' '+new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n)}
  function card(p,i,sold){
    var image=p.cover_image_url||p.logo_url||'';
    var art=image?'<div class="listingArt" style="background-image:url(\''+esc(image)+'\');background-size:cover;background-position:center"></div>':'<div class="listingArt '+(i%4===1?'a2':i%4===2?'a3':i%4===3?'a4':'')+'"></div>';
    var desc=String(p.short_description||p.description||(sold?'Project sold — transaction completed.':'Active Web3 project available for acquisition.')).slice(0,140);var target='project.html?id='+encodeURIComponent(p.id)+(sold?'&view=sold':'');
    var ai='<span class="ai-badge">AI '+(Number.isFinite(Number(p.ai_score))?esc(p.ai_score)+'/100':'Approved')+'</span>';
    var badge=sold?'<span class="wm-sold-badge" aria-label="Sold">SOLD</span>':'';
    return '<article class="listing" data-project-id="'+esc(p.id)+'"><a href="'+target+'">'+art+'</a><div class="listingBody"><div class="seller"><span class="avatar"></span><span>Verified project</span>'+ai+'</div><h3 class="wm-project-title"><a href="'+target+'">'+esc(p.title||'Untitled Web3 Project')+'</a>'+badge+'</h3><div class="desc">'+esc(desc)+'</div><div class="meta"><div class="price2"><strong>'+money(p.price,p.currency)+'</strong><span>'+esc(p.category||'Web3 Project')+'</span></div><a class="buy" href="'+target+'">'+(sold?'View completed transaction →':'View project →')+'</a></div></div></article>';
  }
  function ensureSoldSection(){
    var grid=document.querySelector('.listingGrid');
    if(!grid)return null;
    var sec=document.getElementById('wm-sold-section');
    if(sec)return sec;
    sec=document.createElement('section');sec.id='wm-sold-section';sec.hidden=true;sec.innerHTML='<div class="wm-section-head"><div><div class="eyebrow">COMPLETED TRANSACTIONS</div><h2>Sold / Completed Projects</h2><p>Permanent records of projects whose acquisition transactions have been completed.</p></div></div><div class="wm-sold-grid" aria-live="polite"><div class="empty">Loading sold projects…</div></div>';
    grid.parentNode.insertBefore(sec,grid.nextSibling);
    var tabs=document.createElement('div');tabs.className='wm-market-tabs';tabs.setAttribute('role','tablist');tabs.innerHTML='<button type="button" class="wm-market-tab active" data-market-view="active" role="tab" aria-selected="true">Active Listings</button><button type="button" class="wm-market-tab" data-market-view="sold" role="tab" aria-selected="false">Sold / Completed</button>';
    grid.parentNode.insertBefore(tabs,grid);
    tabs.addEventListener('click',function(e){
      var b=e.target.closest('[data-market-view]');if(!b)return;
      var view=b.dataset.marketView;
      tabs.querySelectorAll('.wm-market-tab').forEach(function(x){var on=x===b;x.classList.toggle('active',on);x.setAttribute('aria-selected',on?'true':'false')});
      grid.hidden=view!=='active';sec.hidden=view!=='sold';
    });
    if(!document.getElementById('wm-sold-section-style')){
      var st=document.createElement('style');st.id='wm-sold-section-style';st.textContent='.wm-market-tabs{display:flex;gap:8px;margin:18px 0 12px}.wm-market-tab{border:1px solid #dfe3ea;background:#fff;color:#5f6672;border-radius:10px;padding:10px 15px;font-weight:900;cursor:pointer}.wm-market-tab.active{background:#5149db;color:#fff;border-color:#5149db}.wm-section-head{margin:22px 0 14px}.wm-section-head h2{margin:5px 0 4px;font-size:30px}.wm-section-head p{margin:0;color:#737b88;font-size:13px}.wm-sold-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:10px 0 28px}.wm-sold-grid .listing{background:#fff}@media(max-width:950px){.wm-sold-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:620px){.wm-market-tabs{overflow:auto}.wm-market-tab{white-space:nowrap}.wm-sold-grid{grid-template-columns:1fr}}';
      document.head.appendChild(st);
    }
    return sec;
  }
  async function render(){
    var grid=document.querySelector('.listingGrid');if(!grid)return;
    ensureHomepageUsesLiveListings(grid);
    var sec=ensureSoldSection();var soldGrid=sec?.querySelector('.wm-sold-grid');
    try{
      var sb=await ensureSupabase();if(!sb){grid.innerHTML='<div class="empty">No active projects are currently listed for sale.</div>';if(soldGrid)soldGrid.innerHTML='<div class="empty">No sold projects are available.</div>';return;}
      /* Fetch Active and Sold separately so the two views can never cross-contaminate. */
      var baseSelect='id,title,description,short_description,price,currency,category,status,project_status,created_at,ai_score,ai_status,logo_url,cover_image_url';
      var activeQ=await sb.from('projects').select(baseSelect).eq('status','active').eq('project_status','approved').eq('ai_status','approved').order('created_at',{ascending:false}).limit(50);
      var soldQ=await sb.from('projects').select(baseSelect).eq('status','sold').eq('project_status','approved').eq('ai_status','approved').order('created_at',{ascending:false}).limit(50);
      if(activeQ.error)throw activeQ.error;
      if(soldQ.error)throw soldQ.error;
      var active=(Array.isArray(activeQ.data)?activeQ.data:[]).filter(function(p){return String(p?.status||'').trim().toLowerCase()==='active';});
      var sold=(Array.isArray(soldQ.data)?soldQ.data:[]).filter(function(p){return String(p?.status||'').trim().toLowerCase()==='sold';});
      var note=document.querySelector('.marketplace-note');if(note)note.innerHTML='🔐 Active listings are shown separately from <strong>Sold / Completed Projects</strong>. Sold projects remain visible as permanent transaction records.';
      grid.innerHTML=active.length?active.map(function(p,i){return card(p,i,false)}).join(''):'<div class="empty">No active projects are currently listed for sale.</div>';
      if(soldGrid)soldGrid.innerHTML=sold.length?sold.map(function(p,i){return card(p,i,true)}).join(''):'<div class="empty">No completed sales are available yet.</div>';
      grid.style.visibility='visible';
      if(!document.getElementById('web3market-live-project-style')){var st=document.createElement('style');st.id='web3market-live-project-style';st.textContent='.listingGrid{opacity:1!important;visibility:visible!important}.listingGrid .listing,.wm-sold-grid .listing{min-height:100%}.listingGrid .listing h3 a,.wm-sold-grid .listing h3 a{color:#141820;text-decoration:none}.listingGrid .listingArt:after,.wm-sold-grid .listingArt:after{content:none}.ai-badge{display:inline-flex;align-items:center;margin-left:4px;padding:3px 6px;border-radius:999px;background:#eeedff;color:#5149db;font-size:9px;font-weight:900}.wm-project-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.wm-project-title a{color:#141820;text-decoration:none}.wm-sold-badge{display:inline-flex;align-items:center;padding:4px 9px;border-radius:7px;background:#16a34a;color:#fff;font-size:11px;font-weight:900;line-height:1;white-space:nowrap;box-shadow:0 2px 7px rgba(22,163,74,.18)}';document.head.appendChild(st)}
      window.dispatchEvent(new CustomEvent('web3market:projects-rendered',{detail:{active:active.length,sold:sold.length}}));
    }catch(e){grid.innerHTML='<div class="empty">No active projects are currently listed for sale.</div>';if(soldGrid)soldGrid.innerHTML='<div class="empty">Sold / Completed Projects are temporarily unavailable.</div>';console.warn('Web3Market live marketplace unavailable',e);}
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
