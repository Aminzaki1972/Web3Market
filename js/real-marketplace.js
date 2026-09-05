"use strict";
(async function(){
  const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
  const grid=document.querySelector('.listingGrid');
  if(!sb||!grid)return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const money=(v,c='USD')=>{const n=Number(v);if(!Number.isFinite(n)||n<=0)return 'Price on request';return `${esc(c||'USD')} ${new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n)}`};
  const aiBadge=(score,status)=>{const n=Number(score);if(Number.isFinite(n))return `<span class="ai-badge">AI ${esc(n)}/100</span>`;if(String(status||'').trim())return `<span class="ai-badge">AI Reviewed</span>`;return `<span class="ai-badge">AI Review</span>`};
  try{
    const {data,error}=await sb.from('projects').select('id,title,description,short_description,price,currency,category,status,created_at,ai_score,ai_status,logo_url,cover_image_url').eq('status','active').order('created_at',{ascending:false}).limit(12);
    if(error)throw error;
    if(!Array.isArray(data)||!data.length)return;
    const html=data.map((p,i)=>{const image=p.cover_image_url||p.logo_url||'';const art=image?`<div class="listingArt" style="background-image:url('${esc(image)}');background-size:cover;background-position:center"></div>`:`<div class="listingArt ${i%4===1?'a2':i%4===2?'a3':i%4===3?'a4':''}"></div>`;const description=(p.short_description||p.description||'Active Web3 project available for acquisition.').slice(0,120);const approved=String(p.ai_status||'').toLowerCase()==='approved';return `<article class="listing" data-project-id="${esc(p.id)}"><a href="project.html?id=${encodeURIComponent(p.id)}">${art}</a><div class="listingBody"><div class="seller"><span class="avatar"></span><span>Web3 Project</span>${approved?' '+aiBadge(p.ai_score,p.ai_status):''}</div><h3><a href="project.html?id=${encodeURIComponent(p.id)}">${esc(p.title||'Untitled Web3 Project')}</a></h3><div class="desc">${esc(description)}</div><div class="meta"><div class="price2"><strong>${money(p.price,p.currency)}</strong><span>${esc(p.category||'Web3 Project')}</span></div><a class="buy" href="project.html?id=${encodeURIComponent(p.id)}">View project →</a></div></div></article>`}).join('');
    grid.innerHTML=html;
    if(!document.getElementById('web3market-ai-card-style')){const style=document.createElement('style');style.id='web3market-ai-card-style';style.textContent='.ai-badge{display:inline-flex;align-items:center;margin-left:4px;padding:3px 6px;border-radius:999px;background:#eeedff;color:#5149db;font-size:9px;font-weight:900}';document.head.appendChild(style)}
    window.dispatchEvent(new CustomEvent('web3market:projects-rendered',{detail:{count:data.length}}));
  }catch(e){console.warn('Web3Market real marketplace unavailable',e)}
})();
