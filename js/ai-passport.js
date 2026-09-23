(() => {
'use strict';
const SUPABASE_URL="https://hzhqlexnhtukfljcvnyd.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI";
const esc=v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const val=(v,empty='Not available')=>v===null||v===undefined||v===''?empty:v;
const status=(kind,label)=>'<span class="status '+kind+'">'+label+'</span>';
const sb=()=>window.supabaseClient||window.Web3MarketSupabase?.getClient?.()||window.web3marketSupabase||window.__passportSupabase||null;
async function getClient(){
 let client=sb();
 if(client)return client;
 if(window.supabase?.createClient){
  try{
   client=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'web3market-auth'}});
   window.__passportSupabase=client;
   return client;
  }catch(e){console.error('Passport Supabase init:',e);}
 }
 if(window.Web3MarketSupabaseRestoreSession){try{await window.Web3MarketSupabaseRestoreSession();}catch(e){}}
 const started=Date.now();
 while(Date.now()-started<8000){
  client=sb();
  if(client)return client;
  if(window.supabase?.createClient){
   try{client=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);window.__passportSupabase=client;return client}catch(e){}
  }
  await new Promise(r=>setTimeout(r,200));
 }
 return null;
}
function render(p){
 const fields=[['Project','title','owner'],['Category','category','owner'],['Location','location','owner'],['Domain','website_url','connected'],['Domain Active Since','domain_active_since','connected'],['Website Traffic','website_traffic','connected'],['Users','users','owner'],['Monthly Revenue','monthly_revenue','owner'],['Technology','technology_stack','owner'],['Blockchain','blockchain','connected'],['GitHub','github_url','connected'],['AI Score','ai_score','ai'],['AI Status','ai_status','ai']];
 let html='<section class="passport-card"><h2>Project Identity & Intelligence</h2><div class="identity">';
 fields.forEach(([label,key,kind])=>html+='<div class="item"><small>'+esc(label)+'</small><strong>'+esc(val(p[key]))+'</strong>'+status(kind,kind==='ai'?'AI Verified':kind==='connected'?'Connected Data':'Owner Provided')+'</div>');
 html+='</div></section><section class="passport-card"><h2>AI Project Summary</h2><p>'+esc(val(p.ai_summary,'AI summary will appear when available.'))+'</p></section><section class="passport-card"><h2>Risk & Due Diligence</h2><div class="identity">';
 [['AI Risk Score','ai_risk_score'],['AI Risk Level','ai_risk_level'],['AI Due Diligence','ai_due_diligence'],['Valuation','ai_valuation']].forEach(([l,k])=>html+='<div class="item"><small>'+l+'</small><strong>'+esc(val(p[k]))+'</strong>'+status('ai','AI Verified')+'</div>');
 html+='</div></section><section class="passport-card"><h2>Project History</h2><p class="muted">Passport data is displayed from available project records. New verification runs can refresh time-sensitive fields when supported.</p></section>';
 document.getElementById('passport').outerHTML=html;
}
async function load(id){
 const root=document.getElementById('passport');if(!root)return;
 root.innerHTML='<p>Loading project passport…</p>';
 const client=await getClient();
 if(!client){root.innerHTML='<p class="muted">Database client could not be initialized. Please refresh once and try again.</p>';return;}
 try{
  const {data,error}=await client.from('projects').select('*').eq('id',id).maybeSingle();
  if(error){console.error('Passport query error:',error);root.innerHTML='<p class="muted">Passport data could not be loaded. Please try again.</p>';return;}
  if(!data){root.innerHTML='<p class="muted">Project not found or unavailable.</p>';return;}
  render(data);
 }catch(e){console.error('Passport load error:',e);root.innerHTML='<p class="muted">Passport data could not be loaded. Please try again.</p>';}
}
window.loadPassportFromInput=()=>{const input=document.getElementById('projectId'),id=input?.value.trim();if(id)load(id);else input?.focus();};
function init(){
 const input=document.getElementById('projectId'),btn=document.getElementById('loadBtn'),id=new URLSearchParams(location.search).get('id');
 if(id){input.value=id;load(id);}
 btn?.addEventListener('click',window.loadPassportFromInput);
 input?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();window.loadPassportFromInput();}});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();