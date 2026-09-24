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
 const c=window.Web3MarketSupabase?.client;
 if(!c||!p.passport_id)return '<section class="passport-card"><h2>Snapshot History</h2><p class="muted">Snapshot history is unavailable.</p></section>';
 try{
  const {data,error}=await c.from('external_passport_snapshots').select('id,captured_at,fingerprint,source_count,collection_status,error_message,passport_payload').eq('passport_id',p.passport_id).order('captured_at',{ascending:false}).limit(20);
  if(error)throw error;
  if(!data?.length)return '<section class="passport-card"><h2>Snapshot History</h2><p class="muted">No previous snapshots are stored yet. A snapshot will appear after the first successful Passport search.</p></section>';
  let h='<section class="passport-card"><h2>Snapshot History</h2><p class="muted">Chronological read-only record of the Passport snapshots collected from public sources.</p>';
  data.forEach((x,i)=>{
   const current=i===0;
   h+='<details class="snapshot-row"'+(current?' open':'')+'><summary><strong>'+(current?'Current Snapshot':'Snapshot '+(data.length-i))+'</strong> • '+esc(x.captured_at||'')+' • '+esc(x.collection_status||'unknown')+' • Sources: '+esc(x.source_count??0)+(current?' • CURRENT':'')+'</summary><div class="snapshot-meta"><small>Snapshot ID: '+esc(x.id||'')+'</small><small>Fingerprint: '+esc(x.fingerprint||'')+'</small>'+(x.error_message?'<small class="muted">Error: '+esc(x.error_message)+'</small>':'')+'</div><pre class="snapshot-json">'+esc(JSON.stringify(x.passport_payload??{},null,2))+'</pre></details>';
  });
  return h+'</section>';
 }catch(e){console.warn('Passport snapshots:',e);return '<section class="passport-card"><h2>Snapshot History</h2><p class="muted">Snapshot history could not be loaded.</p></section>'}
}
async function historyUI(p){
 const c=window.Web3MarketSupabase?.client;if(!c||!p.passport_id)return '<section class="passport-card"><h2>Change History</h2><p class="muted">History is unavailable.</p></section>';
 try{
  const {data, error}=await c.from('external_passport_changes').select('id,change_type,field_path,old_value,new_value,source_url,severity,detected_at').eq('passport_id',p.passport_id).order('detected_at',{ascending:false}).limit(50);
  if(error)throw error;
  if(!data?.length)return '<section class="passport-card"><h2>Change History</h2><p class="muted">No detected changes yet. The first comparison will appear after a monitored scan finds a difference.</p></section>';
  let h='<section class="passport-card"><h2>Change History</h2>';
  data.forEach(x=>{
   const sev=String(x.severity||'info'), source=String(x.source_url||'');
   h+='<div class="finding"><div><strong>'+esc(x.field_path||x.change_type||'Change')+'</strong> '+status(sev,sev.toUpperCase())+'</div><p><strong>Old:</strong> '+esc(jsonValue(x.old_value))+'</p><p><strong>New:</strong> '+esc(jsonValue(x.new_value))+'</p><small>'+esc(x.detected_at||'')+(source&&/^https?:\/\//i.test(source)?' • <a href="'+esc(source)+'" target="_blank" rel="noopener noreferrer">Source</a>':'')+'</small></div>';
  });
  return h+'</section>';
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
 const isRoot=String(p.website_url||'').toLowerCase().includes('web3market.xyz')||String(p.title||'').toLowerCase()==='web3market';
 let h='<div class="passport-badge">Web3Market Project</div><section class="passport-card"><h2>W3M Permanent Project Identity</h2><div class="identity"><div class="item"><small>W3M Identity</small><strong>'+esc(isRoot?'W3M-2026-000001':'Assigned on Passport identity match')+'</strong>'+status('connected',isRoot?'Genesis / Verified':'Identity Layer')+'</div><div class="item"><small>First Seen</small><strong>'+esc(isRoot?'2026-09-25':'Recorded when identity is assigned')+'</strong>'+status('connected','Permanent Record')+'</div><div class="item"><small>Identity Rule</small><strong>Same project keeps the same W3M ID across branches and sources</strong>'+status('connected','Fingerprint Matching')+'</div><div class="item"><small>Scope</small><strong>Website • GitHub • Docs • App • Contracts • Analytics • Listings</strong>'+status('connected','Project Family')+'</div></div></section><section class="passport-card"><h2>Project Identity & Intelligence</h2><div class="identity">';
 [['Project','title','owner'],['Category','category','owner'],['Domain','website_url','connected'],['Users','users_count','owner'],['Monthly Revenue','monthly_revenue','owner'],['Technology','technology_stack','owner'],['Blockchain','blockchain','connected'],['GitHub','github_url','connected'],['AI Score','ai_score','ai']].forEach(([l,k,t])=>h+='<div class="item"><small>'+esc(l)+'</small><strong>'+esc(val(p[k]))+'</strong>'+status(t,t==='ai'?'AI Verified':t==='connected'?'Connected Data':'Owner Provided')+'</div>');
 h+='</div></section><section class="passport-card"><h2>AI Project Summary</h2><p>'+esc(val(p.ai_summary,'AI summary will appear when available.'))+'</p></section><section class="passport-card"><h2>Risk & Due Diligence</h2><div class="identity">';
 [['AI Risk Score','ai_risk_score'],['AI Risk Level','ai_risk_level'],['AI Due Diligence','ai_due_diligence'],['Valuation','ai_valuation']].forEach(([l,k])=>h+='<div class="item"><small>'+l+'</small><strong>'+esc(val(p[k]))+'</strong>'+status('ai','AI Verified')+'</div>');
 h+='</div></section><section class="passport-card"><h2>Project History</h2><p class="muted">Passport data is displayed from the Web3Market project record.</p></section>';document.getElementById('passport').innerHTML=h;
}
async function renderExternal(p){
 let h='<div class="passport-badge external">Web3 Project Passport • External Research</div><section class="passport-card"><h2>Public Project Passport</h2><p class="muted">Universal Passport research uses public sources only and is independent from Web3Market listings.</p><div class="identity">';
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
 const snapshots=await snapshotHistoryUI(p);document.getElementById('passport').insertAdjacentHTML('beforeend',snapshots);const history=await historyUI(p);document.getElementById('passport').insertAdjacentHTML('beforeend',history);
}
async function loadInternal(id){
 const root=document.getElementById('passport');root.innerHTML='<p>Loading Web3Market project…</p>';
 try{const r=await fetch(SUPABASE_URL+'/rest/v1/projects?id=eq.'+encodeURIComponent(id)+'&select=*',{headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY,Accept:'application/json'},cache:'no-store'});if(!r.ok){root.innerHTML='<p class="muted">Project database request returned '+r.status+'.</p>';return}const rows=await r.json();if(!rows?.length){root.innerHTML='<p class="muted">Project not found in Web3Market.</p>';return}renderInternal(rows[0])}catch(e){console.error(e);root.innerHTML='<p class="muted">Unable to connect to the Web3Market database.</p>'}
}
async function loadExternal(query){
 const root=document.getElementById('passport');root.innerHTML='<p>Searching public sources and creating a universal Web3 Project Passport…</p>';
 try{const r=await fetch(SUPABASE_URL+'/functions/v1/external-passport-persist',{method:'POST',headers:{apikey:SUPABASE_KEY,'Content-Type':'application/json'},body:JSON.stringify({query})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.success){root.innerHTML='<p class="muted">'+esc(d.error||('External Passport returned '+r.status+'.'))+'</p>';return}renderExternal(d.passport)}catch(e){console.error(e);root.innerHTML='<p class="muted">External Passport could not connect. Please try again.</p>'}
}
window.loadPassportFromInput=()=>{const i=document.getElementById('projectId'),q=i?.value.trim();if(q){if(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(q))loadInternal(q);else loadExternal(q)}else i?.focus()};
window.loadExternalPassport=()=>{const i=document.getElementById('projectId'),q=i?.value.trim();if(q)loadExternal(q);else i?.focus()};
function init(){const i=document.getElementById('projectId'),b=document.getElementById('loadBtn'),e=document.getElementById('externalBtn'),id=new URLSearchParams(location.search).get('id');if(id){i.value=id;loadInternal(id)}b?.addEventListener('click',window.loadPassportFromInput);e?.addEventListener('click',window.loadExternalPassport);i?.addEventListener('keydown',x=>{if(x.key==='Enter'){x.preventDefault();window.loadPassportFromInput()}})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();