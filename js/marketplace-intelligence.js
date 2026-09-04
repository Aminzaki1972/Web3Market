"use strict";
(async function(){
  const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
  if(!sb)return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const score=v=>v==null?'—':`${Math.round(Number(v))}/100`;
  const money=(v,c='USD')=>{const n=Number(v);if(!Number.isFinite(n)||n<=0)return '—';return `${c} ${new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n)}`};
  const card=(label,value)=>`<div class="wm-intel-card"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  try{
    const {data,error}=await sb.from('projects').select('id,title,price,currency,category,owner_id,status').eq('status','active').order('created_at',{ascending:false}).limit(12);
    if(error||!data?.length)return;
    const ids=data.map(p=>p.id);
    const [iRes,dRes,vRes,rRes,sRes]=await Promise.all([
      sb.from('project_intelligence').select('project_id,overall_score,investment_score,technical_score,security_score,revenue_score,market_score,acquisition_readiness_score,confidence_score,risk_level,ai_summary').in('project_id',ids),
      sb.from('deal_intelligence').select('project_id,deal_score,deal_rating,trust_score').in('project_id',ids),
      sb.from('project_valuation_history').select('project_id,fair_value,valuation_low,valuation_high,price_position,created_at').in('project_id',ids).order('created_at',{ascending:false}),
      sb.from('web3market_reputation').select('user_id,reputation_score,completed_deals,wallet_verified,ownership_verified,github_verified,domain_verified').in('user_id',data.map(p=>p.owner_id)),
      sb.from('project_verification_summary').select('project_id,verification_score,ownership_verified,domain_verified,github_verified,identity_verified,business_verified').in('project_id',ids)
    ]);
    const map=(arr,key)=>Object.fromEntries((arr||[]).map(x=>[x[key],x]));
    const intel=map(iRes.data,'project_id'), deal=map(dRes.data,'project_id'), verify=map(sRes.data,'project_id'), rep=map(rRes.data,'user_id');
    const vals={};for(const v of (vRes.data||[])){if(!vals[v.project_id])vals[v.project_id]=v;}
    data.forEach(p=>{
      const anchor=[...document.querySelectorAll(`a[href*="project.html?id=${p.id}"]`),...document.querySelectorAll(`a[href*="project-details.html?id=${p.id}"]`)][0];
      if(!anchor)return;
      const listing=anchor.closest('.listing');if(!listing)return;
      const old=listing.querySelector('.wm-intelligence');if(old)old.remove();
      const i=intel[p.id]||{},d=deal[p.id]||{},v=vals[p.id]||{},s=verify[p.id]||{},r=rep[p.owner_id]||{};
      const trust=d.trust_score??r.reputation_score??s.verification_score;
      const html=`<div class="wm-intelligence" aria-label="Web3Market Intelligence"><div class="wm-intel-top"><b>Web3Market Intelligence</b><span>${esc(i.risk_level||'unrated')}</span></div><div class="wm-intel-grid">${card('Project Score',score(i.overall_score))}${card('Fair Value',money(v.fair_value??i.valuation_mid,p.currency))}${card('Deal Score',score(d.deal_score))}${card('Trust Score',score(trust))}</div><div class="wm-intel-sub"><span>Acquisition Readiness <b>${score(i.acquisition_readiness_score)}</b></span><span>Verification <b>${score(s.verification_score)}</b></span><span>${v.price_position?esc(v.price_position.replaceAll('_',' ')):'valuation pending'}</span></div></div>`;
      listing.insertAdjacentHTML('beforeend',html);
    });
  }catch(e){console.warn('Web3Market intelligence UI unavailable',e);}
})();
