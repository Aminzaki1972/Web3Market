"use strict";
(async function(){
 const root=document.querySelector('#buyerGrid');
 const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 if(!sb){root.innerHTML='<div class="status">Database connection unavailable.</div>';return;}
 const {data:{user}}=await sb.auth.getUser();
 if(!user){root.innerHTML='<div class="status">Please sign in to view your buyer dashboard.</div>';return;}
 const [{data:offers,error:oe},{data:favorites,error:fe}]=await Promise.all([
  sb.from('marketplace_offers').select('id,project_id,amount,currency,status,created_at').eq('buyer_id',user.id).order('created_at',{ascending:false}),
  sb.from('marketplace_favorites').select('id,project_id,created_at').eq('user_id',user.id).order('created_at',{ascending:false})
 ]);
 if(oe||fe){root.innerHTML='<div class="status">Unable to load your dashboard.</div>';return;}
 const ids=[...(offers||[]).map(x=>x.project_id),...(favorites||[]).map(x=>x.project_id)].filter(Boolean);
 let projects=[]; if(ids.length){const unique=[...new Set(ids)];const r=await sb.from('marketplace_projects').select('id,title,slug,status,asking_price,price_currency,score,verified').in('id',unique);projects=r.data||[];}
 const byId=new Map(projects.map(p=>[p.id,p]));
 root.innerHTML=`<div class="card"><h2>Offers (${(offers||[]).length})</h2>${(offers||[]).map(o=>{const p=byId.get(o.project_id);return `<p><a href="project.html?id=${o.project_id}">${p?.title||'Project'}</a> — ${Number(o.amount).toLocaleString()} ${o.currency||'USD'} — <strong>${o.status}</strong></p>`}).join('')||'<p>No offers yet.</p>'}</div><div class="card"><h2>Saved projects (${(favorites||[]).length})</h2>${(favorites||[]).map(f=>{const p=byId.get(f.project_id);return `<p><a href="project.html?id=${f.project_id}">${p?.title||'Project'}</a></p>`}).join('')||'<p>No saved projects yet.</p>'}</div>`;
})();
