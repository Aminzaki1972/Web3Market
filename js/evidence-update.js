"use strict";
(async function(){
 const form=document.querySelector('#evidenceForm'),status=document.querySelector('#status'),saveStatus=document.querySelector('#saveStatus'),history=document.querySelector('#history'),title=document.querySelector('#title');
 if(!form)return;
 const URL='https://hzhqlexnhtukfljcvnyd.supabase.co',KEY='sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI';
 const esc=v=>String(v??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[m]));
 async function getClient(){for(let i=0;i<50;i++){const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;if(sb?.auth)return sb;await new Promise(r=>setTimeout(r,100));}if(window.supabase?.createClient)return window.supabase.createClient(URL,KEY,{auth:{persistSession:true,autoRefreshToken:true,storageKey:'web3market-auth'}});return null;}
 const sb=await getClient(); if(!sb){status.textContent='Unable to connect to the database.';return;}
 const {data:{user},error:ae}=await sb.auth.getUser(); if(ae||!user){location.replace('login.html?next='+encodeURIComponent(location.href));return;}
 const pid=new URLSearchParams(location.search).get('project_id'); if(!pid){status.textContent='Missing project_id.';return;}
 const pr=await sb.from('projects').select('id,title,owner_id,status,project_status,project_url,website_url,github_url,documentation_url,demo_url,domain_ownership,github_ownership').eq('id',pid).eq('owner_id',user.id).maybeSingle();
 if(pr.error||!pr.data){status.textContent='Project not found or you do not have access.';return;}
 const p=pr.data; title.textContent='Update Evidence — '+(p.title||'Project'); status.textContent='Current status: '+(p.project_status||p.status||'draft'); form.hidden=false;
 ['project_url','github_url','documentation_url','demo_url','domain_ownership','github_ownership'].forEach(k=>{const e=form.elements.namedItem(k);if(e)e.value=p[k]||'';});
 async function loadHistory(){const r=await sb.from('project_evidence_history').select('evidence_type,evidence_value,evidence_status,source,created_at,verified_at,verification_notes').eq('project_id',pid).order('created_at',{ascending:false}).limit(30);if(r.error){history.innerHTML='<div class="status">Unable to load evidence history.</div>';return;}const rows=r.data||[];history.innerHTML=rows.length?rows.map(x=>`<div class="item"><b>${esc(x.evidence_type)}</b> <span class="pill">${esc(x.evidence_status)}</span><div style="font-size:11px;margin-top:5px;word-break:break-word">${esc(x.evidence_value||'')}</div><div class="status">Added ${new Date(x.created_at).toLocaleString()}${x.verified_at?' · Verified '+new Date(x.verified_at).toLocaleString():''}</div></div>`).join(''):'<div class="status">No evidence history yet.</div>';}
 await loadHistory();
 form.addEventListener('submit',async e=>{e.preventDefault();const entries=[['project_url','Project Website'],['github_url','GitHub Repository'],['documentation_url','Documentation'],['demo_url','Demo'],['domain_ownership','Domain Ownership Evidence'],['github_ownership','GitHub Ownership Evidence'],['bsc_evidence','BSC Contract / Wallet Evidence'],['other_evidence','Other Evidence']].map(([k,t])=>({k,t,v:String(form.elements.namedItem(k)?.value||'').trim()})).filter(x=>x.v);
  if(!entries.length){saveStatus.textContent='Add at least one new piece of evidence.';return;}
  saveStatus.textContent='Saving evidence…';form.querySelector('button[type=submit]').disabled=true;
  try{
   const updates={}; if(form.elements.project_url.value.trim()){updates.project_url=form.elements.project_url.value.trim();updates.website_url=updates.project_url;} if(form.elements.github_url.value.trim())updates.github_url=form.elements.github_url.value.trim(); if(form.elements.documentation_url.value.trim())updates.documentation_url=form.elements.documentation_url.value.trim(); if(form.elements.demo_url.value.trim())updates.demo_url=form.elements.demo_url.value.trim(); if(form.elements.domain_ownership.value.trim())updates.domain_ownership=form.elements.domain_ownership.value.trim(); if(form.elements.github_ownership.value.trim())updates.github_ownership=form.elements.github_ownership.value.trim();
   updates.status='draft';updates.project_status='pending_reverification';updates.ai_status='pending_reverification';updates.updated_at=new Date().toISOString();
   const ur=await sb.from('projects').update(updates).eq('id',pid).eq('owner_id',user.id).select('id'); if(ur.error||!ur.data?.length)throw new Error(ur.error?.message||'Unable to update project.');
   const rows=entries.map(x=>({project_id:pid,submitted_by:user.id,evidence_type:x.t,evidence_value:x.v,source:'seller'})); const ir=await sb.from('project_evidence_history').insert(rows); if(ir.error)throw new Error(ir.error.message);
   saveStatus.textContent='Evidence added. Project is now Pending Re-verification.';status.textContent='Pending Re-verification — AI Due Diligence must be run again.';await loadHistory();
  }catch(err){console.error(err);saveStatus.textContent='Could not save evidence: '+(err.message||'Unknown error');}finally{form.querySelector('button[type=submit]').disabled=false;}
 });
})();