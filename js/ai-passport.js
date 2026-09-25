(() => {
'use strict';
const SUPABASE_URL="https://hzhqlexnhtukfljcvnyd.supabase.co";
const SUPABASE_KEY="sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI";
const esc=v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const val=(v,e='Not available')=>v===null||v===undefined||v===''?e:v;
const status=(k,l)=>'<span class="status '+k+'">'+l+'</span>';
async function session(){try{return await window.Web3MarketSupabase?.getSession?.()||null}catch{return null}}
function jsonValue(v){if(v===null||v===undefined)return '—';if(typeof v==='string')return v;try{return JSON.stringify(v)}catch{return String(v)}}
async function snapshotHistoryUI(p){
 if(!p.passport_id)return '<section class="passport-card"><h2>Snapshot History</h2><p class="muted">Snapshot history is unavailable.</p></section>';
 try{
  const u=SUPABASE_URL+'/rest/v1/external_passport_snapshots?select=id,captured_at,fingerprint,source_count,collection_status,error_message&passport_id=eq.'+encodeURIComponent(p.passport_id)+'&order=captured_at.desc&limit=20';
  const r=await fetch(u,{headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY}});
  const data=await r.json();if(!r.ok)throw new Error('REST '+r.status);
  if(!data?.length)return '<section class="passport-card"><h2>Snapshot History</h2><p class="muted">No snapshots recorded yet.</p></section>';
  let h='<section class="passport-card"><h2>Snapshot History</h2>';
  data.forEach(x=>{h+='<div class="finding"><strong>'+esc(x.captured_at||'')+'</strong> '+status('connected',String(x.collection_status||'recorded').toUpperCase())+'<p>Sources: '+esc(x.source_count??'0')+' • Fingerprint: '+esc(x.fingerprint||'—')+'</p></div>';});
  return h+'</section>';
 }catch(e){console.warn('Passport snapshots:',e);return '<section class="passport-card"><h2>Snapshot History</h2><p class="muted">History could not be loaded.</p></section>'}
}
async function historyUI(p){
 if(!p.passport_id)return '<section class="passport-card"><h2>Change History</h2><p class="muted">History is unavailable.</p></section>';
 try{
  const u=SUPABASE_URL+'/rest/v1/external_passport_changes?select=id,change_type,field_path,old_value,new_value,source_url,severity,detected_at&passport_id=eq.'+encodeURIComponent(p.passport_id)+'&order=detected_at.desc&limit=50';
  const r=await fetch(u,{headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY}});const data=await r.json();
  if(!r.ok)throw new Error('REST '+r.status);
  if(data?.length){let h='<section class="passport-card"><h2>Change History</h2>';data.forEach(x=>{const sev=String(x.severity||'info'),source=String(x.source_url||'');h+='<div class="finding"><div><strong>'+esc(x.field_path||x.change_type||'Change')+'</strong> '+status(sev,sev.toUpperCase())+'</div><p><strong>Old:</strong> '+esc(jsonValue(x.old_value))+'</p><p><strong>New:</strong> '+esc(jsonValue(x.new_value))+'</p><small>'+esc(x.detected_at||'')+(source&&/^https?:\/\//i.test(source)?' • <a href="'+esc(source)+'" target="_blank" rel="noopener noreferrer">Source</a>':'')+'</small></div>';});return h+'</section>';}
  const su=SUPABASE_URL+'/rest/v1/external_passport_snapshots?select=id,captured_at,fingerprint,passport_payload&passport_id=eq.'+encodeURIComponent(p.passport_id)+'&order=captured_at.desc&limit=2';
  const sr=await fetch(su,{headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY}});const snaps=await sr.json();if(!sr.ok)throw new Error('REST '+sr.status);
  if(!snaps||snaps.length<2)return '<section class="passport-card"><h2>Change Detection</h2><p class="muted">No comparison yet. A second snapshot is required to detect changes.</p></section>';
  const newer=snaps[0],older=snaps[1],aa=older.passport_payload||{},bb=newer.passport_payload||{},keys=[...new Set([...Object.keys(aa),...Object.keys(bb)])],changes=[];keys.forEach(k=>{if(JSON.stringify(aa[k]??null)!==JSON.stringify(bb[k]??null))changes.push({field:k,old:aa[k]??null,new:bb[k]??null});});
  let h='<section class="passport-card"><h2>Change Detection</h2><p class="muted">Live comparison of the two latest Passport snapshots.</p>';if(!changes.length)return h+'<p class="muted">No field-level changes detected between the latest two snapshots.</p></section>';changes.forEach(x=>{h+='<div class="finding"><div><strong>'+esc(x.field)+'</strong> '+status('warning','CHANGED')+'</div><p><strong>Old:</strong> '+esc(x.old)+'</p><p><strong>New:</strong> '+esc(x.new)+'</p></div>';});return h+'</section>';
 }catch(e){console.warn('Passport history:',e);return '<section class="passport-card"><h2>Change History</h2><p class="muted">History could not be loaded.</p></section>'}
}
async function monitorUI(p){
 const id=p.passport_id;if(!id)return '';
 const s=await session();
 if(!s?.access_token)return '<div class="passport-monitor"><div><strong>Passport Monitoring</strong><div class="monitor-note">Sign in to enable automatic Passport monitoring and change history.</div></div><a href="login.html" class="btn btn-ghost">Sign in</a></div>';
 try{
  const c=window.Web3MarketSupabase?.client;if(!c)return '';
  const {data:m}=await c.from('external_passport_monitors').select('id,enabled,interval_minutes,next_run_at,last_run_at,last_success_at,last_error').eq('passport_id',id).maybeSingle();
  const active=!!m?.enabled;
  return '<div class="passport-monitor"><div><strong>Passport Monitoring: '+(active?'Active':'Off')+'</strong><div class="monitor-note">'+(active?('Last scan: '+val(m.last_success_at,'Not run yet')+' • Next: '+val(m.next_run_at,'Pending')):'Automatic re-checks are disabled for this Passport.')+'</div></div><div><select id="passportInterval" style="padding:9px;border-radius:9px;margin-right:6px"><option value="60">1 hour</option><option value="360">6 hours</option><option value="1440" selected>24 hours</option><option value="10080">7 days</option></select><button id="monitorToggle" data-passport-id="'+esc(id)+'">'+(active?'Disable':'Enable Monitoring')+'</button></div></div>';
 }catch{return '<div class="passport-monitor"><div><strong>Passport Monitoring</strong><div class="monitor-note">Status unavailable.</div></div></div>'}
}
async function wireMonitor(p){
 const b=document.getElementById('monitorToggle');if(!b)return;b.onclick=async()=>{
  b.disabled=true;const s=await session();if(!s?.access_token){location.href='login.html';return}
  try{
   const active=b.textContent.includes('Disable'),c=window.Web3MarketSupabase?.client;
   if(active){const {error}=await c.from('external_passport_monitors').update({enabled:false,next_run_at:null,updated_at:new Date().toISOString()}).eq('passport_id',p.passport_id);if(error)throw error}
   else{const r=await fetch(SUPABASE_URL+'/functions/v1/external-passport-monitor-create',{method:'POST',headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'},body:JSON.stringify({passport_id:p.passport_id,interval_minutes:Number(document.getElementById('passportInterval')?.value||1440)})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.success)throw Error(d.error||'Monitor activation failed')}
   await renderExternal(p);
  }catch(e){alert(e.message||'Monitoring update failed');b.disabled=false}
 }}
function renderInternal(p){
 const isRoot=String(p.website_url||'').toLowerCase().includes('web3market.xyz')||String(p.title||'').toLowerCase()==='web3market'; const identityCode=String(p.w3m_identity_code||'').trim(); const identityFirstSeen=p.w3m_first_seen_at||'';
 let h='<div class="passport-badge">Web3Market Project</div><section class="passport-card"><h2>W3M Permanent Project Identity</h2><div class="identity"><div class="item"><small>W3M Identity</small><strong>'+esc(identityCode|| (isRoot?'W3M-2026-000001':'Assigned on Passport identity match'))+'</strong>'+status('connected',isRoot?'Genesis / Verified':'Identity Layer')+'</div><div class="item"><small>First Seen</small><strong>'+esc(identityFirstSeen|| (isRoot?'2026-09-25':'Recorded when identity is assigned'))+'</strong>'+status('connected','Permanent Record')+'</div><div class="item"><small>Identity Rule</small><strong>Same project keeps the same W3M ID across branches and sources</strong>'+status('connected','Fingerprint Matching')+'</div><div class="item"><small>Scope</small><strong>Website • GitHub • Docs • App • Contracts • Analytics • Listings</strong>'+status('connected','Project Family')+'</div></div></section><section class="passport-card"><h2>Project Identity & Intelligence</h2><div class="identity">';
 [['Project','title','owner'],['Category','category','owner'],['Domain','website_url','connected'],['Users','users_count','owner'],['Monthly Revenue','monthly_revenue','owner'],['Technology','technology_stack','owner'],['Blockchain','blockchain','connected'],['GitHub','github_url','connected'],['AI Score','ai_score','ai']].forEach(([l,k,t])=>h+='<div class="item"><small>'+esc(l)+'</small><strong>'+esc(val(p[k]))+'</strong>'+status(t,t==='ai'?'AI Verified':t==='connected'?'Connected Data':'Owner Provided')+'</div>');
 h+='</div></section><section class="passport-card"><h2>AI Project Summary</h2><p>'+esc(val(p.ai_summary,'AI summary will appear when available.'))+'</p></section><section class="passport-card"><h2>Risk & Due Diligence</h2><div class="identity">';
 [['AI Risk Score','ai_risk_score'],['AI Risk Level','ai_risk_level'],['AI Due Diligence','ai_due_diligence'],['Valuation','ai_valuation']].forEach(([l,k])=>h+='<div class="item"><small>'+l+'</small><strong>'+esc(val(p[k]))+'</strong>'+status('ai','AI Verified')+'</div>');
 h+='</div></section><section class="passport-card"><h2>Project History</h2><p class="muted">Passport data is displayed from the Web3Market project record.</p></section>';document.getElementById('passport').innerHTML=h;
}
async function renderExternal(p){
 let h='<div class="passport-badge external">Web3 Project Passport • External Research</div><section class="passport-card"><h2>W3M Permanent Project Identity</h2><p class="muted">Permanent identity follows the project across its official website, GitHub, app, docs and other verified source branches.</p><div class="identity"><div class="item"><small>W3M Identity</small><strong>'+esc(val(p.w3m_identity_code,'Assigned during identity matching'))+'</strong>'+status('connected',val(p.w3m_identity_status,'Identity Layer'))+'</div><div class="item"><small>First Seen</small><strong>'+esc(val(p.w3m_first_seen_at,'Recorded when identity is assigned'))+'</strong>'+status('connected','Permanent Record')+'</div><div class="item"><small>Identity Rule</small><strong>Same project keeps the same W3M ID across branches and sources</strong>'+status('connected','Fingerprint Matching')+'</div><div class="item"><small>Project Family</small><strong>Website • GitHub • Docs • App • Contracts • Analytics • Listings</strong>'+status('connected','Unified Identity')+'</div></div></section><section class="passport-card"><h2>Public Project Passport</h2><p class="muted">Universal Passport research uses public sources only and is independent from Web3Market listings.</p><div class="identity">';
 [['Project','project_name'],['Website','website'],['Category','category'],['Launched','founded_or_launched'],['Technology','technology'],['GitHub','github'],['Users','active_users'],['Monthly Traffic','monthly_visits'],['Revenue','revenue'],['Risk Level','ai_risk_level'],['Risk Score','ai_risk_score'],['Confidence','confidence_score']].forEach(([l,k])=>h+='<div class="item"><small>'+l+'</small><strong>'+esc(val(p[k]))+'</strong>'+status('external','Public Evidence')+'</div>');
 h+='</div></section><section class="passport-card"><h2>Passport Status</h2><div class="identity"><div class="item"><small>Passport ID</small><strong>'+esc(val(p.passport_id))+'</strong>'+status('connected','Stored')+'</div><div class="item"><small>Snapshot</small><strong>'+esc(val(p.snapshot_id))+'</strong>'+status('connected','Current')+'</div></div></section>';
 h+=await monitorUI(p);
 h+='<section class="passport-card"><h2>Research Summary</h2><p>'+esc(val(p.ai_summary))+'</p></section><section class="passport-card"><h2>Key Findings</h2>';
 const findings=(Array.isArray(p.key_findings)?p.key_findings:[]).map(x=>'<div class="finding"><strong>'+esc(x.title)+'</strong><p>'+esc(x.detail)+'</p><small>'+esc(x.severity||'info')+'</small></div>').join('');
 h+=findings||'<p class="muted">No additional findings were verified.</p>';
 h+='</section><section class="passport-card"><h2>Public Sources</h2>';
 const sources=(Array.isArray(p.sources)?p.sources:[]).map(s=>{const u=String(s.url||'');return /^https?:\/\//i.test(u)?'<div class="source"><a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(s.title||u)+'</a> <small>'+esc(s.type||'public')+'</small></div>':''}).join('');
 h+=sources||'<p class="muted">No public source links returned.</p>'+'</section><section class="passport-card"><p class="muted"><strong>Important:</strong> This Passport is external public research. It is not a Web3Market listing, is not owner-verified, and does not create or modify marketplace project data.</p></section>';
 document.getElementById('passport').innerHTML=h;wireMonitor(p);
 const graphSources=(Array.isArray(p.sources)?p.sources:[]).filter(x=>x&&x.url);let graph='<section class="passport-card"><h2>Evidence Graph</h2><p class="muted">Project identity connected to its public evidence branches and the current Passport snapshot.</p><div class="identity"><div class="item"><small>W3M Identity</small><strong>'+esc(val(p.w3m_identity_code,'—'))+'</strong>'+status('connected','Identity')+'</div><div class="item"><small>Passport</small><strong>'+esc(val(p.passport_id,'—'))+'</strong>'+status('connected','Passport')+'</div><div class="item"><small>Snapshot</small><strong>'+esc(val(p.snapshot_id,'—'))+'</strong>'+status('connected','Snapshot')+'</div></div><div class="finding"><strong>Evidence branches</strong><p>'+esc(String(graphSources.length))+' public source(s) are connected to this Passport record.</p></div>';
 graphSources.slice(0,20).forEach(x=>{const u=String(x.url||'');if(/^https?:\/\//i.test(u))graph+='<div class="source"><a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(x.title||u)+'</a> <small>'+esc(x.type||'public')+'</small></div>';});graph+='</section>';document.getElementById('passport').insertAdjacentHTML('beforeend',graph); const snapshots=await snapshotHistoryUI(p);document.getElementById('passport').insertAdjacentHTML('beforeend',snapshots);const history=await historyUI(p);document.getElementById('passport').insertAdjacentHTML('beforeend',history);
}
async function loadInternal(id){
 const root=document.getElementById('passport');root.innerHTML='<p>Loading Web3Market project…</p>';
 try{
  const headers={apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY,Accept:'application/json'};
  const r=await fetch(SUPABASE_URL+'/rest/v1/projects?id=eq.'+encodeURIComponent(id)+'&select=*',{headers,cache:'no-store'});
  if(!r.ok){root.innerHTML='<p class="muted">Project database request returned '+r.status+'.</p>';return}
  const rows=await r.json();if(!rows?.length){root.innerHTML='<p class="muted">Project not found in Web3Market.</p>';return}
  const p=rows[0];
  if(p.w3m_identity_id){
   try{
    const ir=await fetch(SUPABASE_URL+'/rest/v1/project_identities?id=eq.'+encodeURIComponent(p.w3m_identity_id)+'&select=identity_code,first_seen_at,identity_status',{headers,cache:'no-store'});
    if(ir.ok){
     const identities=await ir.json();
     if(identities?.[0]){
      p.w3m_identity_code=identities[0].identity_code;
      p.w3m_first_seen_at=identities[0].first_seen_at;
      p.w3m_identity_status=identities[0].identity_status;
     }
    }
   }catch(e){console.warn('W3M identity lookup:',e)}
  }
  renderInternal(p)
 }catch(e){console.error(e);root.innerHTML='<p class="muted">Unable to connect to the Web3Market database.</p>'}
}
async function loadExternal(query){
 const root=document.getElementById('passport');
 root.innerHTML='<p>Searching public sources and creating a universal Web3 Project Passport…</p>';
 const headers={apikey:SUPABASE_KEY,'Content-Type':'application/json',Accept:'application/json'};
 try{
  // The public research endpoint is the primary path. Database persistence must
  // never prevent a valid Passport from being displayed.
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),30000); const rr=await fetch(SUPABASE_URL+'/functions/v1/external-project-passport',{
   method:'POST',headers,body:JSON.stringify({query}),cache:'no-store',signal:controller.signal
  });
  clearTimeout(timer); const raw2=await rr.text();let d2={};try{d2=raw2?JSON.parse(raw2):{}}catch{}
  if(rr.ok&&d2.success&&d2.passport){
   d2.passport.external_only=true;
   // Persist and wait for the identity assignment so the Passport gets its permanent W3M ID (and snapshot ID) in the same search result.
   try{
    const pr=await fetch(SUPABASE_URL+'/functions/v1/external-passport-persist',{
     method:'POST',headers,body:JSON.stringify({query}),cache:'no-store'
    });
    const pd=await pr.json().catch(()=>({}));
    if(pr.ok&&pd.success&&pd.passport){
     renderExternal(pd.passport);
     return;
    }
    console.warn('Passport persistence did not assign identity:',pr.status,pd?.error||'unknown');
   }catch(e){console.warn('Passport persistence unavailable:',e)}
   // Research remains usable even if persistence/identity assignment fails.
   renderExternal(d2.passport);
   return;
  console.error('Passport research failed',rr.status,raw2);
  // If the research endpoint fails, try the persistence endpoint as a fallback.
  const r=await fetch(SUPABASE_URL+'/functions/v1/external-passport-persist',{
   method:'POST',headers,body:JSON.stringify({query}),cache:'no-store'
  });
  const raw=await r.text();let d={};try{d=raw?JSON.parse(raw):{}}catch{}
  if(r.ok&&d.success&&d.passport){renderExternal(d.passport);return}
  console.error('Passport persistence fallback failed',r.status,raw);
  root.innerHTML='<p class="muted">Passport search failed ('+esc(rr.status||r.status||'network')+'). '+esc(d2?.error||d?.error||'No public project data was returned.')+'</p>';
 }catch(e){
  console.error('External Passport request',e);
  const key=String(query||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const seed={
   aave:{project_name:'Aave',website:'https://aave.com',category:'DeFi / Lending',github:'https://github.com/aave',blockchains:['Ethereum / EVM','Polygon','Arbitrum','Optimism'],ai_summary:'Public-source seed profile for Aave. Live enrichment was unavailable for this request; no user, traffic or revenue figures are estimated.',ai_risk_level:'not_assessed',ai_risk_score:null,evidence_score:70,confidence_score:70,risk_indicators:['Live enrichment unavailable; verify current public sources before relying on this record.'],key_findings:[{severity:'info',title:'Official identity',detail:'Aave official website and GitHub organization are available as public identity sources.'}],sources:[{title:'Aave official website',url:'https://aave.com',type:'official'},{title:'Aave official GitHub',url:'https://github.com/aave',type:'github'}],external_only:true,web3market_listing_status:'not_listed'},
   uniswap:{project_name:'Uniswap',website:'https://uniswap.org',category:'DEX / Exchange',github:'https://github.com/Uniswap',blockchains:['Ethereum / EVM','Arbitrum','Optimism','Polygon'],ai_summary:'Public-source seed profile for Uniswap. Live enrichment was unavailable for this request; no user, traffic or revenue figures are estimated.',ai_risk_level:'not_assessed',ai_risk_score:null,evidence_score:70,confidence_score:70,risk_indicators:['Live enrichment unavailable; verify current public sources before relying on this record.'],key_findings:[{severity:'info',title:'Official identity',detail:'Uniswap official website and GitHub organization are available as public identity sources.'}],sources:[{title:'Uniswap official website',url:'https://uniswap.org',type:'official'},{title:'Uniswap official GitHub',url:'https://github.com/Uniswap',type:'github'}],external_only:true,web3market_listing_status:'not_listed'}
  };
  if(seed[key]){
   const p={...seed[key],passport_id:'EXTERNAL-'+key.toUpperCase(),snapshot_id:'LIVE-FALLBACK'};
   renderExternal(p);
   return;
  }
  root.innerHTML='<p class="muted">Passport connection failed: '+esc(e?.name==='AbortError'?'Research timed out after 30 seconds.':'Network request failed. Please try again.')+'</p>';
 }
}
window.loadPassportFromInput=()=>{const i=document.getElementById('projectId'),q=i?.value.trim();if(q){if(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(q))loadInternal(q);else loadExternal(q)}else i?.focus()};
window.loadExternalPassport=()=>{const i=document.getElementById('projectId'),q=i?.value.trim();if(q)loadExternal(q);else i?.focus()};
function init(){const i=document.getElementById('projectId'),b=document.getElementById('loadBtn'),e=document.getElementById('externalBtn'),id=new URLSearchParams(location.search).get('id');if(id){i.value=id;loadInternal(id)}b?.addEventListener('click',window.loadPassportFromInput);e?.addEventListener('click',window.loadExternalPassport);i?.addEventListener('keydown',x=>{if(x.key==='Enter'){x.preventDefault();window.loadPassportFromInput()}})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();