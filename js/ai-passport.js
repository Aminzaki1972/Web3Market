(() => {
'use strict';
const esc=v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const sb=()=>window.supabaseClient||window.Web3MarketSupabase?.getClient?.()||window.web3marketSupabase||null;
const val=(v,empty='Not available')=>v===null||v===undefined||v===''?empty:v;
const status=(kind,label)=>'<span class="status '+kind+'">'+label+'</span>';
function render(p){
 const site=val(p.website_url), github=val(p.github_url), chain=val(p.blockchain), tech=val(p.technology_stack);
 const fields=[
  ['Project','title','owner'],['Category','category','owner'],['Location','location','owner'],
  ['Domain','website_url','connected'],['Domain Active Since','domain_active_since','connected'],
  ['Website Traffic','website_traffic','connected'],['Users','users','owner'],
  ['Monthly Revenue','monthly_revenue','owner'],['Technology','technology_stack','owner'],
  ['Blockchain','blockchain','connected'],['GitHub','github_url','connected'],
  ['AI Score','ai_score','ai'],['AI Status','ai_status','ai']
 ];
 let html='<section class="passport-card"><h2>Project Identity & Intelligence</h2><div class="identity">';
 fields.forEach(([label,key,kind])=>{html+='<div class="item"><small>'+esc(label)+'</small><strong>'+esc(val(p[key]))+'</strong>'+status(kind,kind==='ai'?'AI Verified':kind==='connected'?'Connected Data':'Owner Provided')+'</div>';});
 html+='</div></section>';
 html+='<section class="passport-card"><h2>AI Project Summary</h2><p>'+esc(val(p.ai_summary,'AI summary will appear when available.'))+'</p></section>';
 html+='<section class="passport-card"><h2>Risk & Due Diligence</h2><div class="identity">';
 [['AI Risk Score','ai_risk_score'],['AI Risk Level','ai_risk_level'],['AI Due Diligence','ai_due_diligence'],['Valuation','ai_valuation']].forEach(([l,k])=>html+='<div class="item"><small>'+l+'</small><strong>'+esc(val(p[k]))+'</strong>'+status('ai','AI Verified')+'</div>');
 html+='</div></section>';
 html+='<section class="passport-card"><h2>Project History</h2><p class="muted">Passport data is displayed from available project records. New verification runs can refresh time-sensitive fields when supported.</p></section>';
 document.getElementById('passport').outerHTML=html;
}
async function load(id){
 const root=document.getElementById('passport'); if(!root)return; root.innerHTML='<p>Loading project passport…</p>';
 let client=sb();
 if(!client && window.Web3MarketSupabaseRestoreSession){try{await window.Web3MarketSupabaseRestoreSession();}catch(e){}}
 if(!client && window.Web3MarketSupabase?.getClient){try{client=window.Web3MarketSupabase.getClient();}catch(e){}}
 const started=Date.now();
 while(!client && Date.now()-started<8000){await new Promise(r=>setTimeout(r,200));client=sb();}
 if(!client){root.innerHTML='<p class="muted">Database connection unavailable. Please refresh and try again.</p>';return;}
 const {data,error}=await client.from('projects').select('*').eq('id',id).maybeSingle();
 if(error||!data){root.innerHTML='<p class="muted">Project not found or unavailable.</p>';return;}
 render(data);
}
function init(){const id=new URLSearchParams(location.search).get('id');if(id){document.getElementById('projectId').value=id;load(id)}document.getElementById('loadBtn')?.addEventListener('click',()=>{const id=document.getElementById('projectId').value.trim();if(id)load(id)});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();