"use strict";
(async function(){
 const root=document.querySelector('#scoreApp');
 const id=new URLSearchParams(location.search).get('id');
 const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 const esc=v=>String(v??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[m]));
 const score=v=>v==null?'—':`${Math.round(Number(v))}/100`;
 const pct=v=>v==null?0:Math.max(0,Math.min(100,Number(v)));
 const arr=v=>Array.isArray(v)?v:[];
 if(!root)return;
 if(!sb){root.innerHTML='<div class="status">Database connection unavailable.</div>';return;}
 if(!id){root.innerHTML='<div class="status">No project selected.</div>';return;}
 try{
  const {data:p,error:pe}=await sb.from('projects').select('*').eq('id',id).maybeSingle();
  if(pe||!p){root.innerHTML='<div class="status">Project not found or unavailable.</div>';return;}
  let {data:intel}=await sb.from('project_intelligence').select('overall_score,investment_score,technical_score,security_score,revenue_score,market_score,acquisition_readiness_score,confidence_score,score_explanation,calculated_at,score_version,ai_summary,risk_level,risk_signals,strengths,data_gaps').eq('project_id',id).maybeSingle();
  let generated=false;
  if(!intel){
   const {data:{user}}=await sb.auth.getUser();
   if(user){
    const {data:calculated,error:ce}=await sb.rpc('calculate_project_intelligence',{p_project_id:id});
    if(!ce&&calculated){intel=Array.isArray(calculated)?calculated[0]:calculated;generated=true;}
   }
  }
  if(!intel){
   root.innerHTML=`<div class="card"><h2>${esc(p.title||'Project')}</h2><div class="status">Project Intelligence is not available yet.</div><p>Sign in as the project owner to generate the first score.</p></div>`;
   return;
  }
  const dimensions=[
   ['Investment Score','investment_score','Revenue quality, market traction, technical quality and trust signals contribute to this score.'],
   ['Technical Score','technical_score','GitHub, technology stack, documentation, project URL, blockchain and development stage are considered.'],
   ['Security Score','security_score','Ownership, identity, business and verification signals are considered.'],
   ['Revenue Score','revenue_score','Revenue, profit, revenue sources, revenue status and growth information are considered.'],
   ['Market Score','market_score','Users, customers, visits, sales/volume and stated market opportunity are considered.'],
   ['Acquisition Readiness','acquisition_readiness_score','Measures how complete the project is for an acquisition, including technical, security, financial and transfer readiness.']
  ];
  const explanation=intel.score_explanation&&typeof intel.score_explanation==='object'?intel.score_explanation:{};
  const badge=v=>v==null?'':(Number(v)>=80?'Strong':Number(v)>=60?'Moderate':Number(v)>=40?'Developing':'Limited');
  const riskLabel={low:'Low Risk Signal',medium:'Moderate Risk Signal',high:'High Risk Signal',critical:'Critical Risk Signal',unknown:'Risk Not Yet Determined'}[intel.risk_level]||'Risk Not Yet Determined';
  const strengths=arr(intel.strengths), risks=arr(intel.risk_signals), gaps=arr(intel.data_gaps);
  const reasonText=(items,empty)=>items.length?items.map(x=>`<li>${esc(x)}</li>`).join(''):`<li>${esc(empty)}</li>`;
  const cards=dimensions.map(([label,key,desc])=>{
   const value=intel[key];
   return `<div class="card" style="margin-top:14px"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><h3 style="margin:0">${label}</h3><strong>${score(value)}</strong></div><div style="height:7px;background:rgba(127,127,127,.18);border-radius:10px;margin:12px 0;overflow:hidden"><div style="height:100%;width:${pct(value)}%;background:currentColor;border-radius:10px"></div></div><p class="desc">${esc(desc)}</p><p><strong>${esc(badge(value))}</strong></p></div>`;
  }).join('');
  document.title=`${p.title||'Project'} Score | Web3Market`;
  root.innerHTML=`<div class="card" style="text-align:center"><span class="eyebrow">PROJECT INTELLIGENCE ${esc(intel.score_version||explanation.version||'v2')}</span><h2>${esc(p.title||'Project')}</h2><div style="font-size:56px;font-weight:800;line-height:1.1;margin:18px 0">${score(intel.overall_score)}</div><p><strong>${esc(badge(intel.overall_score))}</strong> overall project signal</p><p class="desc">This is an informational model based on available project data. It is not financial advice, an audit, or a guarantee of project quality.</p></div><div class="card" style="margin-top:14px"><h3>AI Project Summary</h3><p>${esc(intel.ai_summary||'A project summary will appear after intelligence is calculated.')}</p><p><strong>${esc(riskLabel)}</strong></p></div>${cards}<div class="card" style="margin-top:14px"><h3>Why this score?</h3><p>The model evaluates completeness and trust signals across the project profile. It does not assume that missing information is negative proof; missing information lowers confidence and may limit the score.</p></div><div class="card" style="margin-top:14px"><h3>Strengths</h3><ul>${reasonText(strengths,'No specific strengths were identified from the available data yet.')}</ul></div><div class="card" style="margin-top:14px"><h3>Risk Signals</h3><ul>${reasonText(risks,'No specific risk signals were identified by this deterministic model.')}</ul></div><div class="card" style="margin-top:14px"><h3>Data Gaps</h3><ul>${reasonText(gaps,'No major data gaps were identified.')}</ul></div><div class="card" style="margin-top:14px"><h3>Confidence & Methodology</h3><p><strong>Confidence:</strong> ${score(intel.confidence_score)}</p><p><strong>Data points:</strong> ${Number(explanation.data_points||0)}</p><p><strong>Model:</strong> ${esc(explanation.method||'Deterministic project intelligence model')}</p><p><strong>Version:</strong> ${esc(intel.score_version||explanation.version||'v2')}</p><p><strong>Last calculated:</strong> ${intel.calculated_at?esc(new Date(intel.calculated_at).toLocaleString()):'—'}</p>${generated?'<p><strong>✓ Score generated from the current project data.</strong></p>':''}</div>`;
 }catch(err){
  console.error('Project Score error:',err);
  root.innerHTML='<div class="status">Unable to load project intelligence.</div>';
 }
})();
