"use strict";
(async function(){
 const app=document.querySelector('#app');
 const sb=()=>window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 const esc=v=>String(v??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[m]));
 const id=new URLSearchParams(location.search).get('id');
 if(!id){app.innerHTML='<div class="dd-card">Project not specified.</div>';return;}
 const client=sb();if(!client){app.innerHTML='<div class="dd-card">Database connection unavailable.</div>';return;}
 async function load(){
  const {data:p,error:pe}=await client.from('projects').select('id,title,owner_id,status').eq('id',id).maybeSingle();
  if(pe||!p){app.innerHTML='<div class="dd-card">Project not found or unavailable.</div>';return;}
  document.title=`AI Due-Diligence · ${p.title||'Project'} | Web3Market`;
  const {data:reports,error}=await client.from('ai_due_diligence_reports').select('id,status,overall_score,confidence_score,risk_level,summary,findings,category_scores,metadata,is_public,created_at,completed_at').eq('project_id',id).eq('status','completed').order('created_at',{ascending:false}).limit(1);
  if(error){app.innerHTML='<div class="dd-card">Unable to load the due-diligence report.</div>';return;}
  const report=reports?.[0]||null;
  const {data:{user}}=await client.auth.getUser();
  const owner=!!user&&user.id===p.owner_id;
  app.innerHTML=`<section class="hero-copy"><span class="eyebrow">PROJECT INTELLIGENCE</span><h1>AI Due-Diligence</h1><p>Evidence-based acquisition analysis. AI findings are limited to supplied evidence and clearly distinguish verified data from unverified claims.</p></section><div class="dd-card">${report?renderReport(report):'<h2>No completed report yet</h2><p class="muted">Run the due-diligence engine to generate the first report for this project.</p>'}<div style="margin-top:20px"><button id="run" class="btn btn-primary">${report?'Run New Due-Diligence':'Run AI Due-Diligence'}</button> <a class="btn btn-ghost" href="project.html?id=${encodeURIComponent(id)}">Back to Project</a><div id="status" class="status"></div></div></div>`;
  document.querySelector('#run').addEventListener('click',run);
  if(!owner&&!user){document.querySelector('#run').disabled=true;document.querySelector('#status').textContent='Sign in to request a due-diligence run.';}
 }
 function renderReport(r){
  const cats=r.category_scores&&typeof r.category_scores==='object'?r.category_scores:{};
  const findings=Array.isArray(r.findings)?r.findings:[];
  return `<div class="dd-grid"><div class="dd-stat"><span>Overall Score</span><strong>${esc(r.overall_score??'—')}/100</strong></div><div class="dd-stat"><span>Confidence</span><strong>${esc(r.confidence_score??'—')}%</strong></div><div class="dd-stat"><span>Risk Level</span><strong>${esc(String(r.risk_level||'unknown').toUpperCase())}</strong></div></div><div class="dd-card"><h2>AI Assessment</h2><p>${esc(r.summary||'No summary available.')}</p><div class="dd-grid">${Object.entries(cats).map(([k,v])=>`<div class="dd-stat"><span>${esc(k)}</span><strong>${esc(v)}/100</strong></div>`).join('')}</div></div><div class="dd-card"><h2>Key Findings</h2>${findings.length?findings.map(f=>`<div class="dd-finding ${esc(f.severity||'info')}"><strong>${esc(f.title||f.category||'Finding')}</strong><p>${esc(f.detail||'')}</p>${f.recommendation?`<p><b>Recommendation:</b> ${esc(f.recommendation)}</p>`:''}</div>`).join(''):'<p class="muted">No additional findings.</p>'}<p class="muted">Engine: ${esc(r.metadata?.mode||'evidence_rules')} · ${esc(r.completed_at||r.created_at)}</p></div>`;
 }
 async function run(){
  const out=document.querySelector('#status'),btn=document.querySelector('#run');btn.disabled=true;out.textContent='Running evidence collection and AI analysis…';
  const {data:{user}}=await client.auth.getUser();if(!user){out.textContent='Please sign in first.';btn.disabled=false;return;}
  const {data,error}=await client.functions.invoke('ai-due-diligence',{body:{project_id:id}});
  if(error||data?.error){out.textContent='Due-diligence failed: '+(data?.error||error?.message||'Unknown error');btn.disabled=false;return;}
  out.textContent='Due-diligence completed successfully.';await load();
 }
 load();
})();
