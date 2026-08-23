"use strict";
(function(){
 const form=document.querySelector('#projectForm');
 if(!form)return;
 const out=document.querySelector('#formStatus');
 const sb=()=>window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 const val=(fd,n)=>{const v=fd.get(n);return v===null?'':String(v).trim()};
 const num=(fd,n)=>{const v=val(fd,n);return v===''?null:Number(v)};
 const projectIdKey='web3market_project_id';
 let currentProjectId=localStorage.getItem(projectIdKey)||'';
 const scalar=['title','project_url','website_url','short_description','full_description','project_status','year_created','logo_url','demo_url','app_store_url','documentation_url','facebook_url','twitter_url','x_url','linkedin_url','instagram_url','telegram_url','discord_url','youtube_url','tiktok_url','reddit_url','medium_url','other_social_url','blockchain','tech_stack','technology_stack','development_stage','target_markets','business_model','competitive_advantage','competitors','market_opportunity','has_revenue','revenue_period','monthly_revenue','yearly_revenue','monthly_profit','yearly_profit','monthly_net_profit','yearly_net_profit','monthly_expenses','growth_rate','revenue_sources','financial_notes','users_count','active_users','customers_count','monthly_visits','total_sales','monthly_volume','conversion_rate','last_active_date','traffic_sources','asset_notes','sale_type','transfer_terms','reason_for_sale','transfer_period','domain_ownership','github_ownership','business_verification','identity_verification','ownership_declaration','currency','currency_code','asking_price','project_types_text','audience','services_text'];
 const setField=(name,value)=>{const el=form.elements.namedItem(name); if(!el||value===undefined||value===null)return; if(el.type==='checkbox'||el.type==='radio')el.checked=!!value; else el.value=String(value);};
 const setChecks=(name,values)=>{const arr=Array.isArray(values)?values:String(values||'').split(',').map(x=>x.trim()).filter(Boolean); form.querySelectorAll('input[name="'+name+'"]').forEach(el=>el.checked=arr.includes(el.value));};
 const jsonObj=(v)=>v&&typeof v==='object'?v:{};
 const jsonArr=(v)=>Array.isArray(v)?v:[];
 async function loadDraft(){
  const client=sb(); if(!client)return;
  const {data:{user}}=await client.auth.getUser(); if(!user)return;
  let q=client.from('projects').select('*').eq('owner_id',user.id).eq('status','draft').order('created_at',{ascending:false}).limit(1);
  if(currentProjectId) q=client.from('projects').select('*').eq('id',currentProjectId).eq('owner_id',user.id).maybeSingle();
  const {data:p,error}=currentProjectId?await q:await q;
  const project=Array.isArray(p)?p[0]:p;
  if(error||!project)return;
  currentProjectId=project.id; localStorage.setItem(projectIdKey,project.id);
  scalar.forEach(k=>{if(Object.prototype.hasOwnProperty.call(project,k))setField(k,project[k]);});
  if(!project.website_url&&project.project_url)setField('project_url',project.project_url);
  if(!project.short_description||!project.full_description){
   const parts=String(project.description||'').split(/\n\s*\n/); if(!project.short_description)setField('short_description',parts[0]||''); if(!project.full_description)setField('full_description',parts.slice(1).join('\n\n')||project.description||'');
  }
  const financials=jsonObj(project.financials); Object.keys(financials).forEach(k=>setField(k,financials[k]));
  const performance=jsonObj(project.performance); Object.keys(performance).forEach(k=>setField(k,performance[k]));
  const social=jsonObj(project.social_accounts); Object.keys(social).forEach(k=>setField(k,social[k]));
  setChecks('project_types',project.project_types||project.project_types_text);
  setChecks('services',project.services||project.services_text);
  setChecks('audience',project.target_audience||project.audience);
  setChecks('assets',project.assets);
  if(out)out.textContent='Saved draft loaded.';
 }
 function collect(){
  const fd=new FormData(form), p={};
  scalar.forEach(k=>{const el=form.elements.namedItem(k); if(!el)return; if(['year_created','monthly_revenue','yearly_revenue','monthly_profit','yearly_profit','monthly_net_profit','yearly_net_profit','monthly_expenses','growth_rate','users_count','active_users','customers_count','monthly_visits','total_sales','monthly_volume','asking_price'].includes(k))p[k]=num(fd,k); else if(k==='negotiable')p[k]=!!form.elements.namedItem(k)?.checked; else p[k]=val(fd,k);});
  p.owner_id=undefined; p.description=(val(fd,'full_description')||val(fd,'description')||val(fd,'short_description')).trim();
  p.website_url=val(fd,'project_url')||val(fd,'website_url');
  p.full_description=val(fd,'full_description')||p.description; p.short_description=val(fd,'short_description');
  p.project_types=[...form.querySelectorAll('input[name="project_types"]:checked')].map(x=>x.value);
  p.services=[...form.querySelectorAll('input[name="services"]:checked')].map(x=>x.value);
  p.target_audience=[...form.querySelectorAll('input[name="audience"]:checked')].map(x=>x.value);
  p.assets=[...form.querySelectorAll('input[name="assets"]:checked')].map(x=>x.value);
  p.social_accounts={facebook_url:p.facebook_url,x_url:p.x_url||p.twitter_url,linkedin_url:p.linkedin_url,instagram_url:p.instagram_url,telegram_url:p.telegram_url,discord_url:p.discord_url,youtube_url:p.youtube_url,tiktok_url:p.tiktok_url,reddit_url:p.reddit_url,medium_url:p.medium_url,other_social_url:p.other_social_url};
  p.performance={users_count:p.users_count,active_users:p.active_users,customers_count:p.customers_count,monthly_visits:p.monthly_visits,total_sales:p.total_sales,monthly_volume:p.monthly_volume,conversion_rate:p.conversion_rate,last_active_date:p.last_active_date,traffic_sources:p.traffic_sources};
  p.financials={has_revenue:p.has_revenue,revenue_period:p.revenue_period,monthly_revenue:p.monthly_revenue,yearly_revenue:p.yearly_revenue,monthly_net_profit:p.monthly_net_profit||p.monthly_profit,yearly_net_profit:p.yearly_net_profit||p.yearly_profit,monthly_expenses:p.monthly_expenses,growth_rate:p.growth_rate,revenue_sources:p.revenue_sources,financial_notes:p.financial_notes};
  delete p.owner_id; delete p.currency_code; delete p.currency; delete p.project_types_text; delete p.services_text; delete p.audience; delete p.description;
  p.currency=val(fd,'currency')||val(fd,'currency_code')||'USD'; p.price=num(fd,'asking_price'); p.status='draft';
  return p;
 }
 async function saveDraft(){
  const client=sb(); if(!client){if(out)out.textContent='Database connection unavailable.';return null}
  const {data:{user},error:ue}=await client.auth.getUser(); if(ue||!user){if(out)out.textContent='Please sign in before listing a project.';return null}
  const fd=new FormData(form),title=val(fd,'title'),short=val(fd,'short_description'),full=val(fd,'full_description');
  if(!title||short.length<20||full.length<50){if(out)out.textContent='Please complete the required project information.';return null}
  const payload=collect(); payload.owner_id=user.id;
  if(out)out.textContent='Saving draft…';
  let result;
  if(currentProjectId) result=await client.from('projects').update(payload).eq('id',currentProjectId).eq('owner_id',user.id).select('id').single();
  else result=await client.from('projects').insert(payload).select('id').single();
  if(result.error){console.error(result.error);if(out)out.textContent=result.error.message||'Unable to save listing.';return null}
  currentProjectId=result.data.id; localStorage.setItem(projectIdKey,currentProjectId); if(out)out.innerHTML='Draft saved successfully.'; return currentProjectId;
 }
 async function submitForReview(){
  const client=sb(); if(!client)return;
  const id=await saveDraft(); if(!id)return;
  if(out)out.textContent='Submitting for AI Review…';
  const {data,error}=await client.functions.invoke('ai-review-project',{body:{project_id:id}});
  if(error){console.error(error);if(out)out.textContent='AI Review could not start: '+(error.message||'unknown error');return}
  const r=data?.result||{}; if(out)out.innerHTML=`AI Review completed. Score: <strong>${r.ai_score??data?.result?.ai_score??0}/100</strong> — ${r.ai_status||'completed'}.`;
  const banner=document.getElementById('reviewResult')||document.createElement('div'); banner.id='reviewResult'; banner.className='hint'; banner.textContent=(r.ai_status==='recommended_for_admin_review')?'AI Review: Recommended for admin review.':'AI Review: Changes are needed before admin review.'; if(!banner.parentNode)form.after(banner);
 }
 form.addEventListener('submit',async e=>{e.preventDefault();await saveDraft();});
 let reviewBtn=form.querySelector('[data-submit-review]')||document.querySelector('[data-submit-review]');
 if(!reviewBtn){reviewBtn=document.createElement('button');reviewBtn.type='button';reviewBtn.className='btn btn-primary';reviewBtn.textContent='Submit for Review'; reviewBtn.setAttribute('data-submit-review',''); const actions=form.querySelector('.actions')||form.lastElementChild; (actions||form).appendChild(reviewBtn);}
 reviewBtn.addEventListener('click',submitForReview);
 loadDraft().catch(err=>{console.error(err);if(out)out.textContent='Could not load saved draft.';});
})();