window.w3mDirectPassportSearch=async function(){
 const input=document.getElementById('projectId');
 const root=document.getElementById('passport');
 const query=(input?.value||'').trim();
 if(!query){input?.focus();return;}
 const genericQueries=new Set(['finance','financial','finances','crypto','cryptocurrency','cryptocurrencies','blockchain','web3','defi','decentralized finance','nft','nfts','dao','wallet','wallets','exchange','exchanges','dex','dexes','market','marketplace','trading','ai','artificial intelligence','metaverse','token','tokens','protocol','protocols','payments','payment']);
 const normalized=query.toLowerCase().replace(/\s+/g,' ').trim();
 if(normalized.length<3){root.innerHTML='<p class="muted">Enter a specific Web3 project name or its official website.</p>';return;}
 if(genericQueries.has(normalized)){root.innerHTML='<p class="muted"><strong>Search is too broad.</strong> Enter a specific Web3 project name or its official HTTPS website. Generic names cannot receive a W3M Passport by themselves.</p>';return;}
 if(/^(W3M-\d{4}-\d{6}|W3M\s*Passport)/i.test(query)){root.innerHTML='<p class="muted">W3M Passport serials must be resolved through the Passport Directory.</p>';return;}
 const key='sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI';
 const base='https://hzhqlexnhtukfljcvnyd.supabase.co';
 const btn=document.getElementById('externalBtn');
 if(btn){btn.disabled=true;btn.textContent='Verifying…';}
 root.innerHTML='<p>Checking evidence, eligibility, identity conflicts, and saved Passport status…</p>';
 const esc=v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 try{
   // One authoritative server operation: this endpoint researches, validates, persists,
   // and returns the identity in one response. Do not research a second time in the browser.
   const res=await fetch(base+'/functions/v1/external-passport-persist',{
     method:'POST',headers:{apikey:key,'Content-Type':'application/json',Accept:'application/json'},
     body:JSON.stringify({query}),cache:'no-store'
   });
   const raw=await res.text(); let data={}; try{data=raw?JSON.parse(raw):{}}catch{}
   const p=data?.passport||{};
   const code=String(p.w3m_identity_code||'').trim();
   const serial=String(data.serial||'').trim();
   if(res.ok && data.success===true && data.eligible===true && code && serial===code && p.snapshot_id && p.passport_id){
     let html='<div class="passport-card"><h2>'+esc(p.project_name||query)+'</h2>';
     html+='<p><strong>Website:</strong> '+esc(p.website||'Not available')+'</p>';
     html+='<p><strong>Evidence Score:</strong> '+esc(p.evidence_score??'—')+'/100</p>';
     html+='<p><strong>Identity Score:</strong> '+esc(p.identity_score??p.confidence_score??'—')+'/100</p>';
     html+='<p><strong>W3M Passport:</strong> '+esc(code)+'</p>';
     html+='<p><strong>Identity status:</strong> '+esc(p.w3m_identity_status||'unverified')+'</p>';
     html+='<p><strong>Saved snapshot:</strong> '+esc(p.snapshot_id)+'</p>';
     html+='<p class="muted">The server confirmed the saved identity and snapshot.</p></div>';
     const sources=Array.isArray(p.sources)?p.sources:[];
     if(sources.length){html+='<div class="passport-card"><h2>Evidence sources ('+sources.length+')</h2>';for(const s of sources){const url=String(s?.url||'');if(!/^https?:\/\//i.test(url))continue;html+='<div class="source"><a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(s.title||url)+'</a><p class="muted">'+esc(s.type||'public source')+'</p></div>';}html+='</div>';}
     root.innerHTML=html;
   }else{
     const eligibility=data?.eligibility||{};
     const reasons=Array.isArray(eligibility.reasons)?eligibility.reasons:[];
     let html='<div class="passport-card"><h2>'+esc(data?.error||'No W3M Passport issued')+'</h2>';
     html+='<p class="muted">The authoritative server did not confirm an eligible, saved Passport. No serial is displayed.</p>';
     if(reasons.length){html+='<ul>';for(const reason of reasons)html+='<li>'+esc(reason)+'</li>';html+='</ul>';}
     if(data?.conflict_status)html+='<p><strong>Identity conflict:</strong> '+esc(data.conflict_status)+'</p>';
     if(!reasons.length&&!data?.error)html+='<p>Please retry after the underlying server response has been investigated.</p>';
     html+='</div>';root.innerHTML=html;
   }
 }catch(e){
   root.innerHTML='<p class="muted">Passport verification failed: '+esc(e?.message||e)+'</p>';
 }finally{
   if(btn){btn.disabled=false;btn.textContent='Search Any Website / Web3 Project';}
 }
};


document.addEventListener('DOMContentLoaded',function(){
 const btn=document.getElementById('externalBtn');
 const input=document.getElementById('projectId');
 if(btn) btn.addEventListener('click',function(){ if(typeof window.w3mDirectPassportSearch==='function') window.w3mDirectPassportSearch(); else { const root=document.getElementById('passport'); if(root) root.innerHTML='<p class="muted">Passport search script did not load. Reload the page and try again.</p>'; }});
 if(input) input.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault(); if(typeof window.w3mDirectPassportSearch==='function') window.w3mDirectPassportSearch();}});
});
