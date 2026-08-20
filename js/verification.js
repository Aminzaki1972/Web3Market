"use strict";
(async function(){
 const root=document.querySelector('#verificationApp');
 const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 if(!sb){root.innerHTML='<div class="status">Database connection unavailable.</div>';return;}
 const {data:{user}}=await sb.auth.getUser();
 if(!user){root.innerHTML='<div class="status">Please sign in before requesting verification.</div>';return;}
 const {data:projects,error}=await sb.from('marketplace_projects').select('id,title,slug,status,verified,score,website_url,github_url').eq('owner_id',user.id).order('created_at',{ascending:false});
 if(error){root.innerHTML='<div class="status">Unable to load your projects.</div>';return;}
 root.innerHTML=`<h2>Verification status</h2><p>Verification is based on ownership, project information and supporting public evidence. It does not certify profitability or guarantee an investment.</p>${(projects||[]).map(p=>`<article class="card"><h3>${p.title||'Untitled project'}</h3><p>Status: <strong>${p.verified?'Verified':'Not verified'}</strong> · Score: ${p.score??'—'}</p><p>${p.website_url?`<a href="${p.website_url}" target="_blank" rel="noopener">Website</a>`:''} ${p.github_url?` · <a href="${p.github_url}" target="_blank" rel="noopener">GitHub</a>`:''}</p><button class="btn" data-project="${p.id}" ${p.verified?'disabled':''}>Request verification</button></article>`).join('')||'<p>No projects found.</p>'}`;
 root.querySelectorAll('[data-project]').forEach(btn=>btn.addEventListener('click',async()=>{
  btn.disabled=true; btn.textContent='Submitting…';
  const {error}=await sb.from('marketplace_verification_requests').insert({project_id:btn.dataset.project,requested_by:user.id,status:'pending'});
  if(error){btn.disabled=false;btn.textContent='Request verification';alert('Could not submit verification request.');return;}
  btn.textContent='Request submitted';
 }));
})();
