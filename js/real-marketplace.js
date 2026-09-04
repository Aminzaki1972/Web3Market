"use strict";
(async function(){
  const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
  if(!sb)return;
  const grid=document.querySelector('.listingGrid');
  if(!grid)return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const money=(v,c='USD')=>{const n=Number(v);if(!Number.isFinite(n)||n<=0)return 'Price on request';return `${esc(c)} ${new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n)}`};
  try{
    const {data,error}=await sb.from('projects').select('id,title,description,price,currency,category,status,created_at').eq('status','active').order('created_at',{ascending:false}).limit(12);
    if(error||!Array.isArray(data)||!data.length)return;
    const html=data.map((p,i)=>`<article class="listing" data-project-id="${esc(p.id)}"><a href="project.html?id=${encodeURIComponent(p.id)}"><div class="listingArt ${i%4===1?'a2':i%4===2?'a3':i%4===3?'a4':''}"></div></a><div class="listingBody"><div class="seller"><span class="avatar"></span><span>Web3 Project</span></div><h3><a href="project.html?id=${encodeURIComponent(p.id)}">${esc(p.title||'Untitled Web3 Project')}</a></h3><div class="desc">${esc((p.description||'Active Web3 project available for acquisition.').slice(0,120))}</div><div class="meta"><div class="price2"><strong>${money(p.price,p.currency)}</strong><span>${esc(p.category||'Web3 Project')}</span></div><a class="buy" href="project.html?id=${encodeURIComponent(p.id)}">View project →</a></div></div></article>`).join('');
    grid.innerHTML=html;
    window.dispatchEvent(new CustomEvent('web3market:projects-rendered',{detail:{count:data.length}}));
  }catch(e){console.warn('Web3Market real marketplace unavailable',e);}
})();
