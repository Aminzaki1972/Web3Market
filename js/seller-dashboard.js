"use strict";
(async function(){
 const root=document.querySelector('#sellerGrid');
 const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 if(!sb){root.innerHTML='<div class="status">Database connection unavailable.</div>';return;}
 const {data:{user}}=await sb.auth.getUser();
 if(!user){root.innerHTML='<div class="status">Please sign in to view your seller dashboard.</div>';return;}
 const {data:projects,error}=await sb.from('marketplace_projects').select('id,title,slug,status,asking_price,price_currency,score,verified,created_at').eq('owner_id',user.id).order('created_at',{ascending:false});
 if(error){root.innerHTML='<div class="status">Unable to load your projects.</div>';return;}
 const ids=(projects||[]).map(p=>p.id);
 let offers=[]; if(ids.length){const r=await sb.from('marketplace_offers').select('id,project_id,amount,currency,status,created_at').in('project_id',ids).order('created_at',{ascending:false});offers=r.data||[];}
 const byId=new Map((projects||[]).map(p=>[p.id,p]));
 root.innerHTML=`<div class="card"><h2>Your listings (${(projects||[]).length})</h2>${(projects||[]).map(p=>`<article><h3><a href="project.html?id=${p.id}">${p.title}</a></h3><p>${p.status} · ${p.verified?'Verified · ':''}Score ${p.score??'—'} · ${p.asking_price?Number(p.asking_price).toLocaleString()+' '+(p.price_currency||'USD'):'Price on request'}</p></article>`).join('')||'<p>No projects listed yet.</p>'}</div><div class="card"><h2>Incoming offers (${offers.length})</h2>${offers.map(o=>`<p><a href="project.html?id=${o.project_id}">${byId.get(o.project_id)?.title||'Project'}</a> — ${Number(o.amount).toLocaleString()} ${o.currency||'USD'} — <strong>${o.status}</strong></p>`).join('')||'<p>No offers yet.</p>'}</div>`;
})();
