"use strict";
(async function(){
 const root=document.querySelector('#scoreApp');
 const id=new URLSearchParams(location.search).get('id');
 const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 if(!sb){root.innerHTML='<div class="status">Database connection unavailable.</div>';return;}
 if(!id){root.innerHTML='<div class="status">No project selected.</div>';return;}
 const {data:p,error}=await sb.from('marketplace_projects').select('*').eq('id',id).maybeSingle();
 if(error||!p){root.innerHTML='<div class="status">Project not found.</div>';return;}
 const checks=[['Project description',!!p.description,10],['Website',!!p.website_url,10],['GitHub',!!p.github_url,10],['Blockchain identified',!!p.blockchain,10],['Asking price',p.asking_price!=null,10],['Revenue data',p.monthly_revenue!=null,15],['User data',p.users_count!=null,10],['Verified',!!p.verified,20],['Public status',p.status==='published',5]];
 const score=checks.reduce((s,c)=>s+(c[1]?c[2]:0),0);
 root.innerHTML=`<h2>${p.title||'Project'}</h2><div class="score"><strong>${score}/100</strong></div><p>This score reflects completeness and available trust signals only.</p><ul>${checks.map(c=>`<li>${c[1]?'✓':'○'} ${c[0]} <small>${c[2]} pts</small></li>`).join('')}</ul>`;
})();
