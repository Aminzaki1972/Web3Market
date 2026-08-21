"use strict";
(async function(){
 const root=document.querySelector('#buyerGrid');
 const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 if(!root)return;
 if(!sb){root.innerHTML='<div class="status">Database connection unavailable.</div>';return;}
 const {data:{user},error:authError}=await sb.auth.getUser();
 if(authError||!user){root.innerHTML='<div class="status">Please sign in to view your buyer dashboard.</div>';return;}
 const {data:deals,error}=await sb.from('deals').select('id,project_id,amount,currency,status,created_at').eq('buyer_id',user.id).order('created_at',{ascending:false});
 if(error){console.error(error);root.innerHTML='<div class="status">Unable to load your dashboard.</div>';return;}
 const ids=[...(deals||[]).map(x=>x.project_id)].filter(Boolean);let projects=[];
 if(ids.length){const r=await sb.from('projects').select('id,title,status,price,currency').in('id',[...new Set(ids)]);if(r.error)console.error(r.error);projects=r.data||[];}
 const byId=new Map(projects.map(p=>[p.id,p]));
 const esc=v=>String(v??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[m]));
 root.innerHTML=`<div class="card"><h2>Your offers / deals (${(deals||[]).length})</h2>${(deals||[]).map(d=>{const p=byId.get(d.project_id);return `<p><a href="project.html?id=${encodeURIComponent(d.project_id)}">${esc(p?.title||'Project')}</a> — ${Number(d.amount).toLocaleString()} ${esc(d.currency||'USD')} — <strong>${esc(d.status)}</strong></p>`}).join('')||'<p>No offers or deals yet.</p>'}</div>`;
})();
