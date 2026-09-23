(() => {
'use strict';
const SUPABASE_URL="https://hzhqlexnhtukfljcvnyd.supabase.co";
const SUPABASE_KEY="sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI";
const esc=v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const val=(v,e='Not available')=>v===null||v===undefined||v===''?e:v;
const status=(k,l)=>'<span class="status '+k+'">'+l+'</span>';
function renderInternal(p){
 const fields=[['Project','title','owner'],['Category','category','owner'],['Domain','website_url','connected'],['Users','users_count','owner'],['Monthly Revenue','monthly_revenue','owner'],['Technology','technology_stack','owner'],['Blockchain','blockchain','connected'],['GitHub','github_url','connected'],['AI Score','ai_score','ai']];
 let h='<div class="passport-badge">Web3Market Project</div><section class="passport-card"><h2>Project Identity & Intelligence</h2><div class="identity">';
 fields.forEach(([l,k,t])=>h+='<div class="item"><small>'+esc(l)+'</small><strong>'+esc(val(p[k]))+'</strong>'+status(t,t==='ai'?'AI Verified':t==='connected'?'Connected Data':'Owner Provided')+'</div>');
 h+='</div></section><section class="passport-card"><h2>AI Project Summary</h2><p>'+esc(val(p.ai_summary,'AI summary will appear when available.'))+'</p></section><section class="passport-card"><h2>Risk & Due Diligence</h2><div class="identity">';
 [['AI Risk Score','ai_risk_score'],['AI Risk Level','ai_risk_level'],['AI Due Diligence','ai_due_diligence'],['Valuation','ai_valuation']].forEach(([l,k])=>h+='<div class="item"><small>'+l+'</small><strong>'+esc(val(p[k]))+'</strong>'+status('ai','AI Verified')+'</div>');
 h+='</div></section><section class="passport-card"><h2>Project History</h2><p class="muted">Passport data is displayed from the Web3Market project record.</p></section>';
 document.getElementById('passport').innerHTML=h;
}
function renderExternal(p){
 let h='<div class="passport-badge external">External Project • Not Listed on Web3Market</div><section class="passport-card"><h2>External Project Intelligence</h2><div class="identity">';
 [['Project','project_name'],['Website','website'],['Category','category'],['Launched','founded_or_launched'],['Technology','technology'],['GitHub','github'],['Users','active_users'],['Monthly Traffic','monthly_visits'],['Revenue','revenue'],['Risk Level','ai_risk_level'],['Risk Score','ai_risk_score'],['Confidence','confidence_score']].forEach(([l,k])=>h+='<div class="item"><small>'+l+'</small><strong>'+esc(val(p[k]))+'</strong>'+status('external','Public / AI Analyzed')+'</div>');
 h+='</div></section><section class="passport-card"><h2>AI Summary</h2><p>'+esc(val(p.ai_summary))+'</p></section><section class="passport-card"><h2>Key Findings</h2>';
 (Array.isArray(p.key_findings)?p.key_findings:[]).forEach(x=>h+='<div class="finding"><strong>'+esc(x.title)+'</strong><p>'+esc(x.detail)+'</p><small>'+esc(x.severity||'info')+'</small></div>');
 if(!p.key_findings?.length)h+='<p class="muted">No additional findings were verified.</p>';
 h+='</section><section class="passport-card"><h2>Public Sources</h2>';
 (Array.isArray(p.sources)?p.sources:[]).forEach(s=>{const u=String(s.url||'');if(/^https?:\/\//i.test(u))h+='<div class="source"><a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(s.title||u)+'</a> <small>'+esc(s.type||'public')+'</small></div>';});
 if(!p.sources?.length)h+='<p class="muted">No public source links returned.</p>';
 h+='</section><section class="passport-card"><p class="muted"><strong>Important:</strong> This is external research only. It is not a Web3Market listing, is not owner-verified, and does not create or modify marketplace data.</p></section>';
 document.getElementById('passport').innerHTML=h;
}
async function loadInternal(id){
 const root=document.getElementById('passport');root.innerHTML='<p>Loading Web3Market project…</p>';
 try{const r=await fetch(SUPABASE_URL+'/rest/v1/projects?id=eq.'+encodeURIComponent(id)+'&select=*',{headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY,Accept:'application/json'},cache:'no-store'});if(!r.ok){root.innerHTML='<p class="muted">Project database request returned '+r.status+'.</p>';return;}const rows=await r.json();if(!Array.isArray(rows)||!rows.length){root.innerHTML='<p class="muted">Project not found in Web3Market.</p>';return;}renderInternal(rows[0]);}catch(e){console.error(e);root.innerHTML='<p class="muted">Unable to connect to the Web3Market database.</p>';}}
async function loadExternal(query){
 const root=document.getElementById('passport');root.innerHTML='<p>Searching public sources and building External AI Passport…</p>';
 try{const r=await fetch(SUPABASE_URL+'/functions/v1/external-project-passport',{method:'POST',headers:{apikey:SUPABASE_KEY,'Content-Type':'application/json'},body:JSON.stringify({query})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.success){root.innerHTML='<p class="muted">'+esc(d.error||('External search returned '+r.status+'.'))+'</p>';return;}renderExternal(d.passport);}catch(e){console.error(e);root.innerHTML='<p class="muted">External project search could not connect. Please try again.</p>';}}
window.loadPassportFromInput=()=>{const i=document.getElementById('projectId'),q=i?.value.trim();if(q){if(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(q))loadInternal(q);else loadExternal(q);}else i?.focus();};
window.loadExternalPassport=()=>{const i=document.getElementById('projectId'),q=i?.value.trim();if(q)loadExternal(q);else i?.focus();};
function init(){const i=document.getElementById('projectId'),b=document.getElementById('loadBtn'),e=document.getElementById('externalBtn'),id=new URLSearchParams(location.search).get('id');if(id){i.value=id;loadInternal(id);}b?.addEventListener('click',window.loadPassportFromInput);e?.addEventListener('click',window.loadExternalPassport);i?.addEventListener('keydown',x=>{if(x.key==='Enter'){x.preventDefault();window.loadPassportFromInput();}});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();