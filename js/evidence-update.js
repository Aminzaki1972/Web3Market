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
 const original={}; ['project_url','github_url','documentation_url','demo_url','domain_ownership','github_ownership'].forEach(k=>{const e=form.elements.namedItem(k);if(e){e.value=p[k]||'';original[k]=String(p[k]||'').trim();}});
 const bscField=form.elements.namedItem('bsc_evidence'),otherField=form.elements.namedItem('other_evidence');
 async function loadHistory(){const r=await sb.from('project_evidence_history').select('evidence_type,evidence_value,evidence_status,source,created_at,verified_at,verification_notes').eq('project_id',pid).order('created_at',{ascending:false}).limit(30);if(r.error){history.innerHTML='<div class="status">Unable to load evidence history.</div>';return;}const rows=r.data||[];history.innerHTML=rows.length?rows.map(x=>`<div class="item"><b>${esc(x.evidence_type)}</b> <span class="pill">${esc(x.evidence_status)}</span><div style="font-size:11px;margin-top:5px;word-break:break-word">${esc(x.evidence_value||'')}</div><div class="status">Added ${new Date(x.created_at).toLocaleString()}${x.verified_at?' · Verified '+new Date(x.verified_at).toLocaleString():''}</div></div>`).join(''):'<div class="status">No evidence history yet.</div>';}
 await loadHistory();
 form.addEventListener('submit',async e=>{e.preventDefault();
  const all=[['project_url','Project Website'],['github_url','GitHub Repository'],['documentation_url','Documentation'],['demo_url','Demo'],['domain_ownership','Domain Ownership Evidence'],['github_ownership','GitHub Ownership Evidence'],['bsc_evidence','BSC Contract / Wallet Evidence'],['other_evidence','Other Evidence']].map(([k,t])=>({k,t,v:String(form.elements.namedItem(k)?.value||'').trim()})).filter(x=>x.v);
  const changed=all.filter(x=>x.k in original ? x.v!==original[x.k] : true);
  if(!changed.length){saveStatus.textContent='No new evidence was added. Change or add at least one item.';return;}
  saveStatus.textContent='Saving evidence and requesting re-verification…';form.querySelector('button[type=submit]').disabled=true;
  try{
   const updates={}; if(form.elements.project_url.value.trim()&&form.elements.project_url.value.trim()!==original.project_url){updates.project_url=form.elements.project_url.value.trim();updates.website_url=updates.project_url;} if(form.elements.github_url.value.trim()&&form.elements.github_url.value.trim()!==original.github_url)updates.github_url=form.elements.github_url.value.trim(); if(form.elements.documentation_url.value.trim()&&form.elements.documentation_url.value.trim()!==original.documentation_url)updates.documentation_url=form.elements.documentation_url.value.trim(); if(form.elements.demo_url.value.trim()&&form.elements.demo_url.value.trim()!==original.demo_url)updates.demo_url=form.elements.demo_url.value.trim(); if(form.elements.domain_ownership.value.trim()&&form.elements.domain_ownership.value.trim()!==original.domain_ownership)updates.domain_ownership=form.elements.domain_ownership.value.trim(); if(form.elements.github_ownership.value.trim()&&form.elements.github_ownership.value.trim()!==original.github_ownership)updates.github_ownership=form.elements.github_ownership.value.trim();
   updates.status='draft';updates.project_status='pending_reverification';updates.ai_status='pending_reverification';updates.updated_at=new Date().toISOString();
   const ur=await sb.from('projects').update(updates).eq('id',pid).eq('owner_id',user.id).select('id'); if(ur.error||!ur.data?.length)throw new Error(ur.error?.message||'Unable to update project.');
   const rows=changed.map(x=>({project_id:pid,submitted_by:user.id,evidence_type:x.t,evidence_value:x.v,source:'seller'})); const ir=await sb.from('project_evidence_history').insert(rows); if(ir.error)throw new Error(ir.error.message);
   saveStatus.textContent='Evidence added. Starting AI Due Diligence re-verification…';
   const sessionResult=await sb.auth.getSession();const token=sessionResult.data?.session?.access_token;if(!token)throw new Error('Please sign in again before re-verification.');
   const ar=await fetch(URL+'/functions/v1/ai-due-diligence',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token,'apikey':KEY},body:JSON.stringify({project_id:pid})});
   const aj=await ar.json().catch(()=>({error:'Invalid AI response'}));if(!ar.ok||!aj.success)throw new Error(aj.error||'AI Due Diligence re-verification failed.');
   saveStatus.textContent='Re-verification completed successfully. New evidence was analyzed.';status.textContent='Re-verification completed — latest AI Due Diligence result is now based on the updated evidence.';await loadHistory();
  }catch(err){console.error(err);saveStatus.textContent='Evidence was saved, but re-verification failed: '+(err.message||'Unknown error')+'. You can run it again safely.';}finally{form.querySelector('button[type=submit]').disabled=false;}
 });
})();