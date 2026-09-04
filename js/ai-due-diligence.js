"use strict";
(async function(){
 const app=document.querySelector('#app');
 const SUPABASE_URL='https://hzhqlexnhtukfljcvnyd.supabase.co';
 const SUPABASE_KEY='sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI';
 const STORAGE_KEY='web3market-auth';
 let fallbackClient=null;
 const sb=()=>{const x=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;if(x?.from)return x;if(fallbackClient?.from)return fallbackClient;if(window.supabase?.createClient){try{fallbackClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:STORAGE_KEY}});return fallbackClient}catch(e){console.error(e)}}return null};
 const esc=v=>String(v??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[m]));
 const id=new URLSearchParams(location.search).get('id');
 if(!id){app.innerHTML='<div class="dd-card">Project not specified.</div>';return;}
 async function getClient(){let client=sb();if(client)return client;for(let i=0;i<20&&!client;i++){await new Promise(r=>setTimeout(r,100));client=sb()}return client}
 const client=await getClient();
 if(!client){app.innerHTML='<div class="dd-card">Unable to initialize Web3Market database client. Please refresh the page.</div>';return;}
 async function load(){
  const {data:p,error:pe}=await client.from('projects').select('id,title,owner_id,status').eq('id',id).maybeSingle();
  if(pe){console.error('Project load:',pe);app.innerHTML='<div class="dd-card">Unable to connect to Web3Market data. <button id="retryLoad" class="btn btn-primary">Retry</button></div>';document.querySelector('#retryLoad')?.addEventListener('click',load);return;}
  if(!p){app.innerHTML='<div class="dd-card">Project not found or unavailable.</div>';return;}
  document.title=`AI Due-Diligence · ${p.title||'Project'} | Web3Market`;
  const {data:reports,error}=await client.from('ai_due_diligence_reports').select('id,status,overall_score,confidence_score,risk_level,summary,findings,category_scores,metadata,is_public,created_at,completed_at').eq('project_id',id).eq('status','completed').order('created_at',{ascending:false}).limit(1);
  if(error){console.error('Report load:',error);app.innerHTML='<div class="dd-card">Unable to load the due-diligence report.</div>';return;}
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
  const {data:{user},error:authError}=await client.auth.getUser();
  if(authError){console.error('Auth:',authError);out.textContent='Session could not be verified. Please sign in again.';btn.disabled=false;return;}
  if(!user){out.textContent='Please sign in first.';btn.disabled=false;return;}
  try{
   let data,error;
   const result=await client.functions.invoke('ai-due-diligence',{body:{project_id:id}});
   data=result.data;error=result.error;
   if(error||data?.error){
    const msg=data?.error||error?.message||'Unknown error';
    console.warn('Supabase Functions invoke failed:',msg);
    const session=(await client.auth.getSession()).data?.session;
    if(session?.access_token){
      const r=await fetch(`${SUPABASE_URL}/functions/v1/ai-due-diligence`,{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,apikey:SUPABASE_KEY,'Content-Type':'application/json'},body:JSON.stringify({project_id:id})});
      const raw=await r.text();let body=null;try{body=JSON.parse(raw)}catch(_){body={error:raw||`HTTP ${r.status}`}};
      if(!r.ok||body?.error)throw new Error(body?.error||`AI Due-Diligence service returned HTTP ${r.status}`);
      data=body;error=null;
    }else throw new Error(msg);
   }
   if(!data?.success)throw new Error(data?.error||'AI Due-Diligence did not complete');
   out.textContent='Due-diligence completed successfully.';await load();
  }catch(e){console.error('AI Due-Diligence:',e);out.textContent='AI Due-Diligence failed: '+(e?.message||'Unknown error');btn.disabled=false;}
 }
 load();
})();