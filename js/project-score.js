"use strict";
(async function(){
 const root=document.querySelector('#scoreApp');
 const id=new URLSearchParams(location.search).get('id');
 const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 const esc=v=>String(v??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[m]));
 const scoreValue=v=>v==null?'—':`${Number(v).toFixed(0)}/100`;
 if(!root)return;
 if(!sb){root.innerHTML='<div class="status">Database connection unavailable.</div>';return;}
 if(!id){root.innerHTML='<div class="status">No project selected.</div>';return;}
 try{
  const {data:p,error:pe}=await sb.from('projects').select('id,title,status').eq('id',id).maybeSingle();
  if(pe||!p){root.innerHTML='<div class="status">Project not found or unavailable.</div>';return;}

  let {data:intel,error:ie}=await sb.from('project_intelligence').select('overall_score,investment_score,technical_score,security_score,revenue_score,market_score,acquisition_readiness_score,confidence_score,score_explanation,calculated_at').eq('project_id',id).maybeSingle();

  if(!intel){
   const {data:{user}}=await sb.auth.getUser();
   if(user){
    const {data:calculated,error:ce}=await sb.rpc('calculate_project_intelligence',{p_project_id:id});
    if(!ce&&calculated) intel=Array.isArray(calculated)?calculated[0]:calculated;
   }
  }

  if(!intel){
   root.innerHTML=`<h2>${esc(p.title||'Project')}</h2><div class="status">Project intelligence is not available yet.</div><p>Sign in as the project owner to generate the first score.</p>`;
   return;
  }

  const labels=[
   ['Overall Project Score','overall_score'],
   ['Investment Score','investment_score'],
   ['Technical Score','technical_score'],
   ['Security Score','security_score'],
   ['Revenue Score','revenue_score'],
   ['Market Score','market_score'],
   ['Acquisition Readiness','acquisition_readiness_score'],
   ['Confidence','confidence_score']
  ];
  const explanation=intel.score_explanation&&typeof intel.score_explanation==='object'?intel.score_explanation:{};
  root.innerHTML=`<h2>${esc(p.title||'Project')}</h2><div class="score"><strong>${scoreValue(intel.overall_score)}</strong></div><p>This score is based on available project data and trust signals. It is informational and is not financial advice.</p><ul>${labels.map(([label,key])=>`<li>${label}: <strong>${scoreValue(intel[key])}</strong></li>`).join('')}</ul><div class="card" style="margin-top:20px"><h3>Score methodology</h3><p>Model: ${esc(explanation.method||'Deterministic project intelligence model')}</p><p>Data points: ${Number(explanation.data_points||0)}</p><p>Version: ${esc(explanation.version||'v1')}</p><p>Last calculated: ${intel.calculated_at?new Date(intel.calculated_at).toLocaleString():'—'}</p></div>`;
 }catch(err){
  console.error('Project Score error:',err);
  root.innerHTML='<div class="status">Unable to load project intelligence.</div>';
 }
})();
