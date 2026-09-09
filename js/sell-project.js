"use strict";
(function(){
  const form=document.querySelector('#projectForm');
  if(!form)return;
  const VERSION='20260909-6';
  const out=document.querySelector('#formStatus');
  const submitBtn=document.querySelector('#submitReviewBtn');
  const ID_KEY='web3market_project_id';
  const LOCAL_KEY='web3market_sell_project_draft_v2';
  const LEGACY_KEY='web3market_sell_project_draft';
  let currentProjectId=localStorage.getItem(ID_KEY)||'';
  const URL='https://hzhqlexnhtukfljcvnyd.supabase.co';
  const KEY='sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI';
  const NUM=['year_created','monthly_revenue','yearly_revenue','monthly_profit','yearly_profit','monthly_expenses','growth_rate','users_count','active_users','customers_count','monthly_visits','total_sales','monthly_volume','asking_price','price','monthly_net_profit','yearly_net_profit','ai_score'];
  const DB=['title','description','category','price','currency','status','website_url','short_description','project_status','year_created','logo_url','demo_url','full_description','project_types','services','target_audience','target_markets','business_model','competitive_advantage','competitors','social_accounts','performance','financials','assets','sale_type','negotiable','transfer_terms','verification','ai_score','ai_status','admin_notes','blockchain','github_url','app_store_url','facebook_url','x_url','linkedin_url','telegram_url','discord_url','primary_type','technology_stack','development_stage','monthly_revenue','yearly_revenue','monthly_net_profit','yearly_net_profit','monthly_expenses','growth_rate','revenue_sources','financial_notes','reason_for_sale','transfer_period','domain_ownership','github_ownership','business_verification','identity_verification','ownership_declaration','project_url','documentation_url','twitter_url','instagram_url','youtube_url','tiktok_url','reddit_url','medium_url','other_social_url','tech_stack','monthly_profit','yearly_profit','revenue_period','has_revenue','market_opportunity','active_users','customers_count','monthly_visits','total_sales','monthly_volume','conversion_rate','last_active_date','traffic_sources','asset_notes','currency_code','asking_price','project_types_text','audience','services_text','buyer_pitch','cover_image_url','domain_verification','sale_reason','screenshots','video_url','users_count'];
  function c(){return window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase||null;}
  function client(){const x=c();if(x)return x;if(window.supabase?.createClient){try{return window.supabase.createClient(URL,KEY,{auth:{persistSession:true,autoRefreshToken:true,storageKey:'web3market-auth'}});}catch(e){console.error(e)}}return null;}
  async function wait(){for(let i=0;i<40;i++){const x=client();if(x)return x;await new Promise(r=>setTimeout(r,250));}return null;}
  function val(n){const e=form.elements.namedItem(n);return e?String(e.value??'').trim():'';}
  function num(v){if(v===null||v===undefined)return null;const s=String(v).trim().replace(/%/g,'').replace(/,/g,'');if(!s)return null;const n=Number(s);return Number.isFinite(n)?n:null;}
  function date(v){const s=String(v??'').trim();return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:null;}
  function bool(v){if(v===true||v===false)return v;const s=String(v??'').trim().toLowerCase();if(['true','yes','1','on'].includes(s))return true;if(['false','no','0','off'].includes(s))return false;return null;}
  function clean(v,k){if(NUM.includes(k))return num(v);if(k==='last_active_date')return date(v);if(k==='negotiable')return bool(v);if(v===undefined||v===null||v==='')return undefined;return v;}
  function collect(){
    const p={};
    form.querySelectorAll('input[name],textarea[name],select[name]').forEach(e=>{if(['project_types','services','audience','assets'].includes(e.name))return;p[e.name]=e.type==='number'?num(e.value):e.value;});
    p.description=val('full_description')||val('description')||val('short_description');
    p.full_description=val('full_description')||p.description;
    p.short_description=val('short_description');
    p.website_url=val('project_url')||val('website_url');
    p.project_types=[...form.querySelectorAll('input[name="project_types"]:checked')].map(x=>x.value);
    p.services=[...form.querySelectorAll('input[name="services"]:checked')].map(x=>x.value);
    p.target_audience=[...form.querySelectorAll('input[name="audience"]:checked')].map(x=>x.value);
    p.assets=[...form.querySelectorAll('input[name="assets"]:checked')].map(x=>x.value);
    p.social_accounts={facebook_url:p.facebook_url||null,x_url:p.x_url||p.twitter_url||null,github_url:p.github_url||null,linkedin_url:p.linkedin_url||null,instagram_url:p.instagram_url||null,telegram_url:p.telegram_url||null,discord_url:p.discord_url||null,youtube_url:p.youtube_url||null,tiktok_url:p.tiktok_url||null,reddit_url:p.reddit_url||null,medium_url:p.medium_url||null,other_social_url:p.other_social_url||null};
    p.performance={users_count:num(p.users_count),active_users:num(p.active_users),customers_count:num(p.customers_count),monthly_visits:num(p.monthly_visits),total_sales:num(p.total_sales),monthly_volume:num(p.monthly_volume),growth_rate:num(p.growth_rate),conversion_rate:p.conversion_rate||null,last_active_date:date(p.last_active_date),traffic_sources:p.traffic_sources||null};
    p.financials={has_revenue:p.has_revenue||null,revenue_period:p.revenue_period||null,monthly_revenue:num(p.monthly_revenue),yearly_revenue:num(p.yearly_revenue),monthly_net_profit:num(p.monthly_profit||p.monthly_net_profit),yearly_net_profit:num(p.yearly_profit||p.yearly_net_profit),monthly_expenses:num(p.monthly_expenses),growth_rate:num(p.growth_rate),revenue_sources:p.revenue_sources||null,financial_notes:p.financial_notes||null};
    const ask=num(p.asking_price||val('asking_price'));p.asking_price=ask;p.price=ask;p.currency=val('currency')||'USD';p.negotiable=bool(val('negotiable'));p.status='draft';
    // Backward-compatible verification mapping: the form historically names this input
    // domain_verification, while AI review evaluates domain_ownership.
    if(!p.domain_ownership && p.domain_verification)p.domain_ownership=p.domain_verification;
    if(!p.domain_verification && p.domain_ownership)p.domain_verification=p.domain_ownership;
    const cleanPayload={};DB.forEach(k=>{const v=clean(p[k],k);if(v!==undefined)cleanPayload[k]=v;});
    return cleanPayload;
  }
  function local(){try{const p=collect();if(p.title||p.short_description||p.full_description)localStorage.setItem(LOCAL_KEY,JSON.stringify({saved_at:new Date().toISOString(),data:p}));}catch(e){console.warn(e)}}
  function fill(p){const fields=['title','project_url','website_url','short_description','full_description','description','project_status','year_created','logo_url','demo_url','app_store_url','documentation_url','facebook_url','twitter_url','x_url','github_url','linkedin_url','instagram_url','telegram_url','discord_url','youtube_url','tiktok_url','reddit_url','medium_url','other_social_url','blockchain','tech_stack','technology_stack','development_stage','target_markets','business_model','competitive_advantage','competitors','market_opportunity','has_revenue','revenue_period','monthly_revenue','yearly_revenue','monthly_profit','yearly_profit','monthly_net_profit','yearly_net_profit','monthly_expenses','growth_rate','revenue_sources','financial_notes','users_count','active_users','customers_count','monthly_visits','total_sales','monthly_volume','conversion_rate','last_active_date','traffic_sources','asset_notes','sale_type','transfer_terms','reason_for_sale','sale_reason','transfer_period','domain_ownership','domain_verification','github_ownership','business_verification','identity_verification','ownership_declaration','asking_price','price','currency','currency_code','primary_type','buyer_pitch','cover_image_url','video_url','screenshots','negotiable'];fields.forEach(k=>{const e=form.elements.namedItem(k);if(!e||p[k]===undefined||p[k]===null)return;if(e.type==='checkbox')e.checked=!!p[k];else e.value=String(p[k]);});['project_types','services','audience','assets'].forEach(n=>{const a=Array.isArray(p[n])?p[n]:[];form.querySelectorAll('input[name="'+n+'"]').forEach(e=>e.checked=a.includes(e.value));});}
  async function load(){const x=await wait();if(!x){return local();}const u=await x.auth.getUser();if(u.error||!u.data?.user)return local();let p=null;if(currentProjectId){const r=await x.from('projects').select('*').eq('id',currentProjectId).eq('owner_id',u.data.user.id).maybeSingle();p=r.data||null;}if(!p){const r=await x.from('projects').select('*').eq('owner_id',u.data.user.id).eq('status','draft').order('updated_at',{ascending:false}).limit(1);p=r.data?.[0]||null;}if(p){currentProjectId=p.id;localStorage.setItem(ID_KEY,p.id);fill(p);localStorage.removeItem(LOCAL_KEY);localStorage.removeItem(LEGACY_KEY);}else{try{const raw=localStorage.getItem(LOCAL_KEY)||localStorage.getItem(LEGACY_KEY);if(raw)fill(JSON.parse(raw).data)}catch(e){}}}
  async function save(){
    const x=await wait();
    if(!x){local();if(out)out.textContent='Database unavailable — saved on this device. Engine '+VERSION;return {ok:false,offline:true};}
    const u=await x.auth.getUser();
    if(u.error||!u.data?.user){local();if(out)out.textContent='Please sign in. Form saved on this device. Engine '+VERSION;return {ok:false,auth:false};}
    if(!val('title')||!val('short_description').length<20||(val('full_description')||val('description')).length<50){local();if(out)out.textContent='Please complete the required information. Form saved on this device. Engine '+VERSION;return {ok:false,validation:false};}
    const payload=collect();payload.owner_id=u.data.user.id;payload.status='draft';
    if(out)out.textContent='Saving draft… Engine '+VERSION;
    let r;
    if(currentProjectId)r=await x.from('projects').update(payload).eq('id',currentProjectId).eq('owner_id',u.data.user.id).select('id');
    if(!currentProjectId||!r?.data?.length)r=await x.from('projects').insert(payload).select('id');
    if(r.error){console.error('SAVE ERROR',r.error,payload);local();if(out)out.textContent=(r.error.message||'Unable to save listing.')+' | Engine '+VERSION+' | Form saved on this device.';return {ok:false,error:r.error};}
    const id=r.data?.[0]?.id;if(id){currentProjectId=id;localStorage.setItem(ID_KEY,id);localStorage.removeItem(LOCAL_KEY);localStorage.removeItem(LEGACY_KEY);if(out)out.textContent='Draft saved successfully. Engine '+VERSION;return {ok:true,id};}
    return {ok:false,error:new Error('No project id returned')};
  }
  async function submitForReview(){
    if(submitBtn)submitBtn.disabled=true;
    try{
      const saved=await save();
      if(!saved.ok){return;}
      const x=await wait();
      const sessionResult=await x.auth.getSession();
      const token=sessionResult.data?.session?.access_token;
      if(!token)throw new Error('Please sign in again before submitting.');
      if(out)out.textContent='Running AI Review…';
      const r=await fetch(URL+'/functions/v1/ai-review-project',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token,'apikey':KEY},body:JSON.stringify({project_id:saved.id})});
      const j=await r.json().catch(()=>({error:'Invalid server response'}));
      if(!r.ok||!j.success)throw new Error(j.error||'AI Review failed.');
      const score=j.review?.overall_score??j.result?.ai_score??'—';
      const status=j.review?.recommendation||j.result?.ai_status||'submitted';
      if(out)out.textContent='Submitted successfully. AI Score: '+score+'. '+String(status).replace(/_/g,' ')+'.';
      if(submitBtn)submitBtn.textContent='Submitted for AI Review';
    }catch(e){console.error('SUBMIT REVIEW ERROR',e);if(out)out.textContent='Saved as draft, but submission failed: '+(e.message||'Please try again.');}
    finally{if(submitBtn&&submitBtn.textContent!=='Submitted for AI Review')submitBtn.disabled=false;}
  }
  form.addEventListener('input',()=>{clearTimeout(window.__wmTimer);window.__wmTimer=setTimeout(local,350);});
  form.addEventListener('change',local);
  form.addEventListener('submit',e=>{e.preventDefault();save();});
  if(submitBtn)submitBtn.addEventListener('click',submitForReview);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load,{once:true});else load();
})();