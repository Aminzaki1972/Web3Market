"use strict";
(function(){
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
    try{
      var sb=await ensureSupabase();
      if(!sb){console.warn('Web3Market: Supabase client unavailable');return;}
      var q=await sb.from('projects').select('id,title,description,short_description,price,currency,category,status,created_at,ai_score,ai_status,logo_url,cover_image_url').eq('status','active').order('created_at',{ascending:false});
      if(q.error)throw q.error;
      var data=Array.isArray(q.data)?q.data:[];
      var old=document.getElementById('wm-live-projects-heading');
      if(!old){
        old=document.createElement('div');old.id='wm-live-projects-heading';
        old.innerHTML='<div style="display:flex;align-items:end;justify-content:space-between;gap:16px;margin:0 0 18px"><div><div style="font-size:11px;font-weight:950;letter-spacing:1px;color:#635bff">LIVE ACTIVE LISTINGS</div><h2 style="margin:5px 0 4px;font-size:32px;letter-spacing:-1px">Projects currently for sale</h2><p style="margin:0;color:#737b88;font-size:13px">Every approved project with <b>status = active</b> is displayed below.</p></div><div style="font-size:13px;font-weight:900;color:#5149db">'+data.length+' active project'+(data.length===1?'':'s')+'</div></div>';
        grid.parentNode.insertBefore(old,grid);
      }else{
        var count=old.querySelector('div[style*="color:#5149db"]');if(count)count.textContent=data.length+' active project'+(data.length===1?'':'s');
      }
      if(!data.length){grid.innerHTML='<div class="empty">No active projects are currently listed for sale.</div>';return;}
      var esc=function(v){return String(v??'').replace(/[&<>"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]})};
      var money=function(v,c){var n=Number(v);if(!Number.isFinite(n)||n<=0)return 'Price on request';return esc(c||'USD')+' '+new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n)};
      var html=data.map(function(p,i){
        var image=p.cover_image_url||p.logo_url||'';
        var art=image?'<div class="listingArt" style="background-image:url(\''+esc(image)+'\');background-size:cover;background-position:center"></div>':'<div class="listingArt '+(i%4===1?'a2':i%4===2?'a3':i%4===3?'a4':'')+'"></div>';
        var desc=String(p.short_description||p.description||'Active Web3 project available for acquisition.').slice(0,140);
        var ai=String(p.ai_status||'').toLowerCase()==='approved'?'<span class="ai-badge">AI '+(Number.isFinite(Number(p.ai_score))?esc(p.ai_score)+'/100':'Reviewed')+'</span>':'';
        return '<article class="listing" data-project-id="'+esc(p.id)+'"><a href="project.html?id='+encodeURIComponent(p.id)+'">'+art+'</a><div class="listingBody"><div class="seller"><span class="avatar"></span><span>Web3 Project</span>'+ai+'</div><h3><a href="project.html?id='+encodeURIComponent(p.id)+'">'+esc(p.title||'Untitled Web3 Project')+'</a></h3><div class="desc">'+esc(desc)+'</div><div class="meta"><div class="price2"><strong>'+money(p.price,p.currency)+'</strong><span>'+esc(p.category||'Web3 Project')+'</span></div><a class="buy" href="project.html?id='+encodeURIComponent(p.id)+'">View project →</a></div></div></article>';
      }).join('');
      grid.innerHTML=html;
      grid.style.visibility='visible';
      if(!document.getElementById('web3market-live-project-style')){var st=document.createElement('style');st.id='web3market-live-project-style';st.textContent='.listingGrid{opacity:1!important;visibility:visible!important}.listingGrid .listing{min-height:100%}.listingGrid .listing h3 a{color:#141820;text-decoration:none}.listingGrid .listingArt:after{content:none}.ai-badge{display:inline-flex;align-items:center;margin-left:4px;padding:3px 6px;border-radius:999px;background:#eeedff;color:#5149db;font-size:9px;font-weight:900}';document.head.appendChild(st)}
      window.dispatchEvent(new CustomEvent('web3market:projects-rendered',{detail:{count:data.length}}));
    }catch(e){console.warn('Web3Market live marketplace unavailable',e)}
  }
  function boot(){render();setTimeout(render,1200);setTimeout(render,3000)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
