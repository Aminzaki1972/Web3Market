(() => {
'use strict';
const SUPABASE_URL="https://hzhqlexnhtukfljcvnyd.supabase.co";
const SUPABASE_KEY="sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI";
const esc=v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const val=(v,e='Not available')=>v===null||v===undefined||v===''?e:v;
const status=(k,l)=>'<span class="status '+k+'">'+l+'</span>';
function render(p){
 const fields=[['Project','title','owner'],['Category','category','owner'],['Location','location','owner'],['Domain','website_url','connected'],['Domain Active Since','domain_active_since','connected'],['Website Traffic','website_traffic','connected'],['Users','users','owner'],['Monthly Revenue','monthly_revenue','owner'],['Technology','technology_stack','owner'],['Blockchain','blockchain','connected'],['GitHub','github_url','connected'],['AI Score','ai_score','ai'],['AI Status','ai_status','ai']];
 let h='<section class="passport-card"><h2>Project Identity & Intelligence</h2><div class="identity">';
 fields.forEach(([l,k,t])=>h+='<div class="item"><small>'+esc(l)+'</small><strong>'+esc(val(p[k]))+'</strong>'+status(t,t==='ai'?'AI Verified':t==='connected'?'Connected Data':'Owner Provided')+'</div>');
 h+='</div></section><section class="passport-card"><h2>AI Project Summary</h2><p>'+esc(val(p.ai_summary,'AI summary will appear when available.'))+'</p></section><section class="passport-card"><h2>Risk & Due Diligence</h2><div class="identity">';
 [['AI Risk Score','ai_risk_score'],['AI Risk Level','ai_risk_level'],['AI Due Diligence','ai_due_diligence'],['Valuation','ai_valuation']].forEach(([l,k])=>h+='<div class="item"><small>'+l+'</small><strong>'+esc(val(p[k]))+'</strong>'+status('ai','AI Verified')+'</div>');
 h+='</div></section><section class="passport-card"><h2>Project History</h2><p class="muted">Passport data is displayed from available project records.</p></section>';
 document.getElementById('passport').outerHTML=h;
}
async function load(id){
 const root=document.getElementById('passport'); if(!root)return;
 root.innerHTML='<p>Loading project passport…</p>';
 try{
  const url=SUPABASE_URL+'/rest/v1/projects?id=eq.'+encodeURIComponent(id)+'&select=*';
  const r=await fetch(url,{method:'GET',headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY,'Accept':'application/json'},cache:'no-store'});
  if(!r.ok){const t=await r.text();console.error('Passport REST error',r.status,t);root.innerHTML='<p class="muted">Passport data could not be loaded. Database request returned '+r.status+'.</p>';return;}
  const rows=await r.json();
  if(!Array.isArray(rows)||!rows.length){root.innerHTML='<p class="muted">Project not found or unavailable.</p>';return;}
  render(rows[0]);
 }catch(e){console.error('Passport REST connection error',e);root.innerHTML='<p class="muted">Unable to connect to the project database. Please refresh and try again.</p>';}
}
window.loadPassportFromInput=()=>{const i=document.getElementById('projectId'),id=i?.value.trim();if(id)load(id);else i?.focus()};
function init(){
 const i=document.getElementById('projectId'),b=document.getElementById('loadBtn'),id=new URLSearchParams(location.search).get('id');
 if(id){i.value=id;load(id);}
 b?.addEventListener('click',window.loadPassportFromInput);
 i?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();window.loadPassportFromInput();}});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();