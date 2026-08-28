"use strict";
(async function(){
 const root=document.querySelector('#verificationApp');
 if(!root)return;
 const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 if(!sb){root.innerHTML='<div class="status">Database connection unavailable.</div>';return;}
 const {data:{user},error:authError}=await sb.auth.getUser();
 if(authError||!user){root.innerHTML='<div class="status">Please sign in before requesting verification.</div>';return;}
 const esc=v=>String(v??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[m]));
 const {data:projects,error}=await sb.from('projects').select('id,title,status,project_status,ai_score,ai_status,website_url,github_url,verification,created_at').eq('owner_id',user.id).order('created_at',{ascending:false});
 if(error){root.innerHTML='<div class="status">Unable to load your projects.</div>';return;}
 root.innerHTML=`<h2>Verification status</h2><p>Verification confirms that submitted ownership and project evidence has been reviewed. It does not certify profitability or guarantee an investment.</p>${(projects||[]).map(p=>{const v=p.verification&&typeof p.verification==='object'?p.verification:{};const req=v.verification_request||{};const state=p.ai_status||p.project_status||p.status||'draft';const canRequest=!v.verified&&req.status!=='pending';return `<article class="card"><h3>${esc(p.title||'Untitled project')}</h3><p>Status: <strong>${esc(v.verified?'Verified':req.status==='pending'?'Verification requested':'Not verified')}</strong> · AI score: ${esc(p.ai_score??'—')} · Workflow: ${esc(state)}</p><p>${p.website_url?`<a href="${esc(p.website_url)}" target="_blank" rel="noopener noreferrer">Website</a>`:''} ${p.github_url?` · <a href="${esc(p.github_url)}" target="_blank" rel="noopener noreferrer">GitHub</a>`:''}</p><button class="btn" data-project="${esc(p.id)}" ${canRequest?'':'disabled'}>${v.verified?'Verified ✓':req.status==='pending'?'Request pending…':'Request verification'}</button></article>`}).join('')||'<p>No projects found. Create a listing first.</p>'}`;
 root.querySelectorAll('[data-project]').forEach(btn=>btn.addEventListener('click',async()=>{
  btn.disabled=true;btn.textContent='Submitting…';
  const projectId=btn.dataset.project;
  const {data:current}=await sb.from('projects').select('verification').eq('id',projectId).eq('owner_id',user.id).maybeSingle();
  const verification=current?.verification&&typeof current.verification==='object'?current.verification:{};
  const {error}=await sb.from('project_verification_requests').insert({project_id:projectId,requested_by:user.id,status:'pending'});
  if(error){btn.disabled=false;btn.textContent='Request verification';alert(error.message||'Could not submit verification request.');return;}
  const next={...verification,verification_request:{status:'pending',requested_at:new Date().toISOString()}};
  const {error:updateError}=await sb.from('projects').update({verification:next}).eq('id',projectId).eq('owner_id',user.id);
  if(updateError)alert('Request was submitted, but project status could not be updated.');
  btn.textContent='Request submitted ✓';
 }));
})();
