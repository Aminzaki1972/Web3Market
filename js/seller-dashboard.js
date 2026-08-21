"use strict";
(async function(){
 const root=document.querySelector('#sellerGrid');
 const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 if(!sb){root.innerHTML='<div class="status">Database connection unavailable.</div>';return;}
 const {data:{user},error:authError}=await sb.auth.getUser();
 if(authError||!user){root.innerHTML='<div class="status">Please sign in to view your seller dashboard.</div>';return;}
 const {data:projects,error}=await sb.from('marketplace_projects').select('id,title,slug,status,asking_price,price_currency,score,verification_status,created_at').eq('owner_id',user.id).order('created_at',{ascending:false});
 if(error){console.error(error);root.innerHTML='<div class="status">Unable to load your projects.</div>';return;}
 const ids=(projects||[]).map(p=>p.id);
 let offers=[];
 if(ids.length){
  const r=await sb.from('marketplace_offers').select('id,project_id,amount,currency,status,created_at').in('project_id',ids).order('created_at',{ascending:false});
  if(r.error) console.error(r.error); else offers=r.data||[];
 }
 const byId=new Map((projects||[]).map(p=>[p.id,p]));
 const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
 const money=(v,c)=>v==null?'Price on request':new Intl.NumberFormat('en-US',{style:'currency',currency:c||'USD',maximumFractionDigits:0}).format(Number(v));
 root.innerHTML=`<div class="card"><h2>Your listings (${(projects||[]).length})</h2>${(projects||[]).map(p=>`<article><h3><a href="project.html?id=${encodeURIComponent(p.id)}">${esc(p.title)}</a></h3><p>${esc(p.status)} · ${p.verification_status==='verified'?'Verified · ':''}Score ${Number(p.score??0)}/100 · ${money(p.asking_price,p.price_currency)}</p></article>`).join('')||'<p>No projects listed yet.</p>'}</div><div class="card"><h2>Incoming offers (${offers.length})</h2>${offers.map(o=>`<p><a href="project.html?id=${encodeURIComponent(o.project_id)}">${esc(byId.get(o.project_id)?.title||'Project')}</a> — ${money(o.amount,o.currency)} — <strong>${esc(o.status)}</strong></p>`).join('')||'<p>No offers yet.</p>'}</div>`;
})();
