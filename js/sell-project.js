"use strict";
(function(){
  const form=document.querySelector('#projectForm');
  if(!form)return;
  form.noValidate=true;
  const out=document.querySelector('#formStatus');
  const PROJECT_ID_KEY='web3market_project_id';
  const LOCAL_DRAFT_KEY='web3market_sell_project_draft_v2';
  let currentProjectId=localStorage.getItem(PROJECT_ID_KEY)||'';
  const SUPABASE_URL='https://hzhqlexnhtukfljcvnyd.supabase.co';
  const SUPABASE_KEY='sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI';
  function client(){return window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase||null;}
  function getClient(){const existing=client();if(existing)return existing;if(window.supabase?.createClient){try{return window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'web3market-auth'}});}catch(e){console.error(e);}}return null;}
  async function waitClient(){for(let i=0;i<40;i++){const c=getClient();if(c)return c;await new Promise(r=>setTimeout(r,250));}return null;}
  function value(name){const el=form.elements.namedItem(name);return el?String(el.value||'').trim():'';}
  function set(name,v){const el=form.elements.namedItem(name);if(!el||v===null||v===undefined)return;if(el.type==='checkbox')el.checked=Boolean(v);else el.value=String(v);}
  function checks(name,v){const a=Array.isArray(v)?v:String(v||'').split(',').map(x=>x.trim()).filter(Boolean);form.querySelectorAll('input[name="'+name+'"]').forEach(x=>x.checked=a.includes(x.value));}
  function normalizeDate(v){const s=String(v??'').trim();return !s?null:/^\d{4}-\d{2}-\d{2}$/.test(s)?s:null;}
  function fill(p){
    const fields=['title','project_url','website_url','short_description','full_description','description','project_status','year_created','logo_url','demo_url','app_store_url','documentation_url','facebook_url','twitter_url','x_url','github_url','linkedin_url','instagram_url','telegram_url','discord_url','youtube_url','tiktok_url','reddit_url','medium_url','other_social_url','blockchain','tech_stack','technology_stack','development_stage','target_markets','business_model','competitive_advantage','competitors','market_opportunity','has_revenue','revenue_period','monthly_revenue','yearly_revenue','monthly_profit','yearly_profit','monthly_net_profit','yearly_net_profit','monthly_expenses','growth_rate','revenue_sources','financial_notes','users_count','active_users','customers_count','monthly_visits','total_sales','monthly_volume','conversion_rate','last_active_date','traffic_sources','asset_notes','sale_type','transfer_terms','reason_for_sale','sale_reason','transfer_period','domain_ownership','domain_verification','github_ownership','business_verification','identity_verification','ownership_declaration','asking_price','price','currency','currency_code','primary_type'];
    fields.forEach(k=>{if(Object.prototype.hasOwnProperty.call(p,k))set(k,p[k]);});
    if(!p.project_url&&p.website_url)set('project_url',p.website_url);
    if(!p.full_description&&p.description)set('full_description',p.description);
    if(!p.description&&p.full_description)set('description',p.full_description);
    const f=p.financials&&typeof p.financials==='object'?p.financials:{};
    const perf=p.performance&&typeof p.performance==='object'?p.performance:{};
    const social=p.social_accounts&&typeof p.social_accounts==='object'?p.social_accounts:{};
    Object.keys(f).forEach(k=>set(k,f[k]));Object.keys(perf).forEach(k=>set(k,perf[k]));Object.keys(social).forEach(k=>set(k,social[k]));
    checks('project_types',p.project_types||p.project_types_text);checks('services',p.services||p.services_text);checks('audience',p.target_audience||p.audience);checks('assets',p.assets);
  }
  function collect(){
    const p={};form.querySelectorAll('input[name],textarea[name],select[name]').forEach(el=>{if(['project_types','services','audience','assets'].includes(el.name))return;p[el.name]=el.type==='number'?(el.value===''?null:Number(el.value)):el.value;});
    if(Object.prototype.hasOwnProperty.call(p,'last_active_date'))p.last_active_date=normalizeDate(p.last_active_date);
    p.description=value('full_description')||value('description')||value('short_description');
    p.website_url=value('project_url')||value('website_url');
    p.full_description=value('full_description')||p.description;
    p.short_description=value('short_description');
    p.project_types=[...form.querySelectorAll('input[name="project_types"]:checked')].map(x=>x.value);
    p.services=[...form.querySelectorAll('input[name="services"]:checked')].map(x=>x.value);
    p.target_audience=[...form.querySelectorAll('input[name="audience"]:checked')].map(x=>x.value);
    p.assets=[...form.querySelectorAll('input[name="assets"]:checked')].map(x=>x.value);
    p.social_accounts={facebook_url:p.facebook_url,x_url:p.x_url||p.twitter_url,github_url:p.github_url,linkedin_url:p.linkedin_url,instagram_url:p.instagram_url,telegram_url:p.telegram_url,discord_url:p.discord_url,youtube_url:p.youtube_url,tiktok_url:p.tiktok_url,reddit_url:p.reddit_url,medium_url:p.medium_url,other_social_url:p.other_social_url};
    p.performance={users_count:p.users_count,active_users:p.active_users,customers_count:p.customers_count,monthly_visits:p.monthly_visits,total_sales:p.total_sales,monthly_volume:p.monthly_volume,conversion_rate:p.conversion_rate,last_active_date:normalizeDate(p.last_active_date),traffic_sources:p.traffic_sources};
    p.financials={has_revenue:p.has_revenue,revenue_period:p.revenue_period,monthly_revenue:p.monthly_revenue,yearly_revenue:p.yearly_revenue,monthly_net_profit:p.monthly_net_profit||p.monthly_profit,yearly_net_profit:p.yearly_net_profit||p.yearly_profit,monthly_expenses:p.monthly_expenses,growth_rate:p.growth_rate,revenue_sources:p.revenue_sources,financial_notes:p.financial_notes};
    // users_count is kept inside performance JSON only; projects has no top-level users_count column.
    delete p.users_count;
    delete p.currency_code;p.currency=value('currency')||'USD';p.price=value('asking_price')===''?null:Number(value('asking_price'));p.status='draft';return p;
  }
  function saveLocalDraft(){try{const p=collect();if(p.title||p.short_description||p.full_description)localStorage.setItem(LOCAL_DRAFT_KEY,JSON.stringify({saved_at:new Date().toISOString(),data:p}));}catch(e){console.warn('Local draft save failed',e);}}
  function loadLocalDraft(){try{const raw=localStorage.getItem(LOCAL_DRAFT_KEY);if(!raw)return false;const x=JSON.parse(raw);if(!x?.data)return false;fill(x.data);out.textContent='Recovered unsaved form data from this device.';return true;}catch(e){console.warn('Local draft load failed',e);return false;}}
  async function loadDraft(){
    const c=await waitClient();
    if(!c){loadLocalDraft();if(!value('title'))out.textContent='Database connection unavailable.';return;}
    const u=await c.auth.getUser();
    if(u.error||!u.data?.user){loadLocalDraft();if(!value('title'))out.textContent='Please sign in before listing a project.';return;}
    const user=u.data.user;let p=null;
    if(currentProjectId){const r=await c.from('projects').select('*').eq('id',currentProjectId).eq('owner_id',user.id).maybeSingle();if(r.error)console.error('Project lookup:',r.error);p=r.data||null;}
    if(!p){const r=await c.from('projects').select('*').eq('owner_id',user.id).eq('status','draft').order('updated_at',{ascending:false}).limit(1);if(r.error)console.error('Draft list:',r.error);p=r.data?.[0]||null;}
    if(p){currentProjectId=p.id;localStorage.setItem(PROJECT_ID_KEY,p.id);fill(p);localStorage.removeItem(LOCAL_DRAFT_KEY);out.textContent='Saved draft loaded successfully.';return;}
    if(!loadLocalDraft())out.textContent='No saved draft found. Your form is ready for a new listing.';
  }
  async function saveDraft(){
    const c=await waitClient();
    if(!c){saveLocalDraft();out.textContent='Database connection unavailable. Your form is safely saved on this device.';return null;}
    const u=await c.auth.getUser();
    if(u.error||!u.data?.user){saveLocalDraft();out.textContent='Please sign in before listing a project. Your form is saved on this device.';return null;}
    const uid=u.data.user.id;
    if(!value('title')||value('short_description').length<20||(value('full_description')||value('description')).length<50){saveLocalDraft();out.textContent='Please complete the required project information. Your current form is saved on this device.';return null;}
    const payload=collect();payload.owner_id=uid;out.textContent='Saving draft…';
    let savedId=null;
    if(currentProjectId){
      const q=await c.from('projects').update(payload).eq('id',currentProjectId).eq('owner_id',uid).select('id');
      if(q.error){console.error(q.error);saveLocalDraft();out.textContent=(q.error.message||'Unable to save listing.')+' Your form is also saved on this device.';return null;}
      if(q.data?.length)savedId=q.data[0].id;
    }
    if(!savedId){
      const q=await c.from('projects').insert(payload).select('id');
      if(q.error){console.error(q.error);saveLocalDraft();out.textContent=(q.error.message||'Unable to create listing.')+' Your form is saved on this device.';return null;}
      if(q.data?.length)savedId=q.data[0].id;
    }
    if(!savedId){saveLocalDraft();out.textContent='The draft could not be confirmed by the database. Your form is safely saved on this device.';return null;}
    currentProjectId=savedId;localStorage.setItem(PROJECT_ID_KEY,savedId);localStorage.removeItem(LOCAL_DRAFT_KEY);out.textContent='Draft saved successfully.';return savedId;
  }
  async function submitForReview(){const id=await saveDraft();if(!id)return;const c=await waitClient();if(!c)return;out.textContent='Submitting for AI Review…';const r=await c.functions.invoke('ai-review-project',{body:{project_id:id}});if(r.error){out.textContent='AI Review could not start: '+(r.error.message||'unknown error');return;}const x=r.data?.result||{};out.innerHTML='AI Review completed. Score: <strong>'+(x.ai_score??0)+'/100</strong> — '+(x.ai_status||'completed')+'.';}
  form.addEventListener('input',()=>{clearTimeout(window.__web3marketDraftTimer);window.__web3marketDraftTimer=setTimeout(saveLocalDraft,350);});
  form.addEventListener('change',saveLocalDraft);
  window.addEventListener('beforeunload',saveLocalDraft);
  form.addEventListener('submit',e=>{e.preventDefault();saveDraft();});
  let b=form.querySelector('[data-submit-review]');if(!b){b=document.createElement('button');b.type='button';b.className='btn btn-primary';b.textContent='Submit for Review';b.dataset.submitReview='';(form.querySelector('.actions')||form).appendChild(b);}b.addEventListener('click',submitForReview);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',loadDraft,{once:true});else loadDraft();
})();
