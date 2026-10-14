"use strict";
window.__web3MarketSellProjectLoaderStarted = true;
(function(){
  const form=document.querySelector('#projectForm');
  if(!form)return;
  // Draft saving must allow incomplete forms; AI Review has its own explicit validation.
  form.noValidate = true;
  const VERSION='20261013-database-draft-review-v6';
  const out=document.querySelector('#formStatus');
  const submitBtn=document.querySelector('#submitReviewBtn');
  const ID_KEY='web3market_project_id';
  const LOCAL_KEY='web3market_sell_project_draft_v2';
  const LEGACY_KEY='web3market_sell_project_draft';
  const STEP_KEY='web3market_sell_project_step_v1';
  const requestedProjectId=new URLSearchParams(window.location.search).get('project')||'';
  let currentProjectId=requestedProjectId||localStorage.getItem(ID_KEY)||'';
  const SUPABASE_URL='https://hzhqlexnhtukfljcvnyd.supabase.co';
  const KEY='sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI';
  const NUM=['year_created','monthly_revenue','yearly_revenue','monthly_profit','yearly_profit','monthly_expenses','growth_rate','users_count','active_users','customers_count','monthly_visits','total_sales','monthly_volume','asking_price','price','monthly_net_profit','yearly_net_profit'];
  const DB=['title','description','category','price','currency','status','website_url','short_description','year_created','logo_url','demo_url','full_description','project_types','services','target_audience','target_markets','business_model','competitive_advantage','competitors','social_accounts','performance','financials','assets','sale_type','negotiable','transfer_terms','verification','blockchain','github_url','app_store_url','facebook_url','x_url','linkedin_url','telegram_url','discord_url','primary_type','technology_stack','development_stage','monthly_revenue','yearly_revenue','monthly_net_profit','yearly_net_profit','monthly_expenses','growth_rate','revenue_sources','financial_notes','reason_for_sale','transfer_period','domain_ownership','github_ownership','ownership_declaration','project_url','documentation_url','twitter_url','instagram_url','youtube_url','tiktok_url','reddit_url','medium_url','other_social_url','tech_stack','monthly_profit','yearly_profit','revenue_period','has_revenue','market_opportunity','active_users','customers_count','monthly_visits','total_sales','monthly_volume','conversion_rate','last_active_date','traffic_sources','asset_notes','currency_code','asking_price','project_types_text','audience','services_text','buyer_pitch','cover_image_url','domain_verification','sale_reason','screenshots','video_url','users_count'];
  function c(){return window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase||null;}
  function client(){const x=c();if(x)return x;if(window.supabase?.createClient){try{return window.supabase.createClient(SUPABASE_URL,KEY,{auth:{persistSession:true,autoRefreshToken:true,storageKey:'web3market-auth'}});}catch(e){console.error(e)}}return null;}
  async function wait(){for(let i=0;i<40;i++){const x=client();if(x)return x;await new Promise(r=>setTimeout(r,250));}return null;}
  function val(n){const e=form.elements.namedItem(n);return e?String(e.value??'').trim():'';}
  function num(v){if(v===null||v===undefined)return null;const s=String(v).trim().replace(/%/g,'').replace(/,/g,'');if(!s)return null;const n=Number(s);return Number.isFinite(n)?n:null;}
  function date(v){const s=String(v??'').trim();return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:null;}
  function bool(v){if(v===true||v===false)return v;const s=String(v??'').trim().toLowerCase();if(['true','yes','1','on'].includes(s))return true;if(['false','no','0','off'].includes(s))return false;return null;}
  function clean(v,k){if(v===undefined)return undefined;if(NUM.includes(k))return num(v);if(k==='last_active_date')return date(v);if(k==='negotiable')return bool(v);if(v===undefined||v===null||v==='')return undefined;return v;}
  function collect(){
    const p={};
    form.querySelectorAll('input[name],textarea[name],select[name]').forEach(e=>{if(['project_types','services','audience','assets'].includes(e.name))return;p[e.name]=e.type==='number'?num(e.value):e.value;});
    p.description=val('full_description')||val('description')||val('short_description');
    p.full_description=val('full_description')||p.description;
    p.short_description=val('short_description');
    // Keep the official website and source repository in separate database fields.
    const enteredSite=String(val('project_url')||'').trim();
    const legacySite=String(val('website_url')||'').trim();
    let repoUrl=String(val('github_url')||'').trim();
    const isGithubRepo=(value)=>{try{const u=new URL(value);return u.protocol==='https:'&&u.hostname.toLowerCase()==='github.com'&&/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(u.pathname);}catch(e){return false;}};
    const isOfficialSite=(value)=>{try{const u=new URL(value);return u.protocol==='https:'&&!/(^|\.)github\.com$/i.test(u.hostname);}catch(e){return false;}};
    let officialSite=enteredSite||legacySite;
    if(isGithubRepo(officialSite)){
      if(!isGithubRepo(repoUrl))repoUrl=officialSite;
      officialSite=isOfficialSite(legacySite)?legacySite:'';
    }
    if(!isOfficialSite(officialSite)&&isOfficialSite(legacySite))officialSite=legacySite;
    p.project_url=officialSite;
    p.website_url=officialSite;
    p.github_url=repoUrl;
    p.project_types=[...form.querySelectorAll('input[name="project_types"]:checked')].map(x=>x.value);
    p.services=[...form.querySelectorAll('input[name="services"]:checked')].map(x=>x.value);
    p.target_audience=[...form.querySelectorAll('input[name="audience"]:checked')].map(x=>x.value);
    p.assets=[...form.querySelectorAll('input[name="assets"]:checked')].map(x=>x.value);
    p.social_accounts={facebook_url:p.facebook_url||null,x_url:p.x_url||p.twitter_url||null,github_url:p.github_url||null,linkedin_url:p.linkedin_url||null,instagram_url:p.instagram_url||null,telegram_url:p.telegram_url||null,discord_url:p.discord_url||null,youtube_url:p.youtube_url||null,tiktok_url:p.tiktok_url||null,reddit_url:p.reddit_url||null,medium_url:p.medium_url||null,other_social_url:p.other_social_url||null};
    p.performance={users_count:num(p.users_count),active_users:num(p.active_users),customers_count:num(p.customers_count),monthly_visits:num(p.monthly_visits),total_sales:num(p.total_sales),monthly_volume:num(p.monthly_volume),growth_rate:num(p.growth_rate),conversion_rate:p.conversion_rate||null,last_active_date:date(p.last_active_date),traffic_sources:p.traffic_sources||null};
    p.financials={has_revenue:p.has_revenue||null,revenue_period:p.revenue_period||null,monthly_revenue:num(p.monthly_revenue),yearly_revenue:num(p.yearly_revenue),monthly_net_profit:num(p.monthly_profit||p.monthly_net_profit),yearly_net_profit:num(p.yearly_profit||p.yearly_net_profit),monthly_expenses:num(p.monthly_expenses),growth_rate:num(p.growth_rate),revenue_sources:p.revenue_sources||null,financial_notes:p.financial_notes||null};
    const ask=num(p.asking_price||val('asking_price'));p.asking_price=ask;p.price=ask;p.currency=val('currency')||'USD';p.currency_code=p.currency;p.negotiable=bool(val('negotiable'));p.status='draft';
    // Keep screenshot data URL-only. Legacy drafts may contain non-URL text in this field;
    // filtering here prevents ownership declarations or other text from being saved as media.
    p.screenshots=String(val('screenshots')||'').split(',').map(v=>v.trim()).filter(v=>{try{const u=new URL(v);return ['https:','http:'].includes(u.protocol)&&!!u.hostname;}catch(e){return false;}}).join(', ');
    // Backward-compatible verification mapping: the form historically names this input
    // domain_verification, while AI review evaluates domain_ownership.
    if(!p.domain_ownership && p.domain_verification)p.domain_ownership=p.domain_verification;
    if(!p.domain_verification && p.domain_ownership)p.domain_verification=p.domain_ownership;
    const cleanPayload={};DB.forEach(k=>{const v=clean(p[k],k);if(v!==undefined)cleanPayload[k]=v;});
    return cleanPayload;
  }
  function local(){try{const p=collect();if(Object.keys(p).length)localStorage.setItem(LOCAL_KEY,JSON.stringify({saved_at:new Date().toISOString(),data:p,project_id:currentProjectId||null}));}catch(e){console.warn(e)}}
  function getGroups(){return [...form.querySelectorAll('details.group')];}
  function saveStep(){try{const groups=getGroups();const open=groups.findIndex(g=>g.open);if(open>=0)localStorage.setItem(STEP_KEY,JSON.stringify({project_id:currentProjectId||null,index:open,saved_at:new Date().toISOString()}));}catch(e){console.warn(e)}}
  function restoreStep(){try{const raw=localStorage.getItem(STEP_KEY);if(!raw)return;const st=JSON.parse(raw);if(st.project_id&&currentProjectId&&st.project_id!==currentProjectId)return;const groups=getGroups();if(!groups.length)return;const i=Math.max(0,Math.min(groups.length-1,Number(st.index)||0));groups.forEach((g,n)=>g.open=n===i);groups[i].scrollIntoView({behavior:'auto',block:'start'});}catch(e){console.warn(e)}}
  function fill(p){if(p.project_url&&/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(String(p.project_url).trim())){const oldRepo=String(p.project_url).trim();p={...p,github_url:p.github_url||oldRepo,project_url:''};}if(!p.project_url&&p.website_url&&/^https:\/\//i.test(String(p.website_url).trim())&&!/(^|\.)github\.com$/i.test((()=>{try{return new URL(p.website_url).hostname}catch(e){return ''}})()))p={...p,project_url:p.website_url};const fields=['title','project_url','website_url','short_description','full_description','description','project_status','year_created','logo_url','demo_url','app_store_url','documentation_url','facebook_url','twitter_url','x_url','github_url','linkedin_url','instagram_url','telegram_url','discord_url','youtube_url','tiktok_url','reddit_url','medium_url','other_social_url','blockchain','tech_stack','technology_stack','development_stage','target_markets','business_model','competitive_advantage','competitors','market_opportunity','has_revenue','revenue_period','monthly_revenue','yearly_revenue','monthly_profit','yearly_profit','monthly_net_profit','yearly_net_profit','monthly_expenses','growth_rate','revenue_sources','financial_notes','users_count','active_users','customers_count','monthly_visits','total_sales','monthly_volume','conversion_rate','last_active_date','traffic_sources','asset_notes','sale_type','transfer_terms','reason_for_sale','sale_reason','transfer_period','domain_ownership','domain_verification','github_ownership','ownership_declaration','asking_price','price','currency','currency_code','primary_type','buyer_pitch','cover_image_url','video_url','screenshots','negotiable'];fields.forEach(k=>{const e=form.elements.namedItem(k);if(!e||p[k]===undefined||p[k]===null)return;if(e.type==='checkbox')e.checked=!!p[k];else e.value=String(p[k]);});if(Array.isArray(p.target_audience))form.querySelectorAll('input[name="audience"]').forEach(e=>e.checked=p.target_audience.includes(e.value));['project_types','services','audience','assets'].forEach(n=>{const a=Array.isArray(p[n])?p[n]:[];form.querySelectorAll('input[name="'+n+'"]').forEach(e=>e.checked=a.includes(e.value));});renderSavedMediaPreviews();}
  async function load(){
    if(out)out.textContent='Loading your saved draft…';
    const rawLocal=localStorage.getItem(LOCAL_KEY)||localStorage.getItem(LEGACY_KEY);
    let localSnapshot=null;
    try{if(rawLocal)localSnapshot=JSON.parse(rawLocal);}catch(e){console.warn(e)}
    if(localSnapshot?.project_id&&!currentProjectId)currentProjectId=localSnapshot.project_id;
    restoreStep();
    const x=await wait();
    if(!x){
      if(localSnapshot?.data&&!requestedProjectId)fill(localSnapshot.data);
      if(out)out.textContent=requestedProjectId?'Could not connect to Web3Market database. Your existing listing was not changed. Please refresh and try again.':'Offline mode — your draft is محفوظ on this device. Engine '+VERSION;
      return;
    }
    const u=await x.auth.getUser();
    if(u.error||!u.data?.user){
      if(localSnapshot?.data&&!requestedProjectId)fill(localSnapshot.data);
      if(out)out.textContent='Your seller session is not active. Sign in to the same seller account that owns this draft, then reopen it. No listing was changed.';
      return;
    }
    let p=null;
    let rejectedLocalSnapshot=false;
    if(currentProjectId){
      const r=await x.from('projects').select('*').eq('id',currentProjectId).eq('owner_id',u.data.user.id).maybeSingle();
      if(r.error){
        console.error('DRAFT LOAD ERROR',r.error);
        if(out)out.textContent='Unable to load this saved draft from the database: '+(r.error.message||'database query failed')+'. No new listing was created and no saved data was changed.';
        return;
      }
      p=r.data||null;
      if(!p&&requestedProjectId){
        if(out)out.textContent='This draft could not be found for the currently signed-in seller account. Sign in to the account that owns Web3Swap — Test Listing. No other draft was opened.';
        return;
      }
      if(p&&!isEditableDraft(p)){
        rejectedLocalSnapshot=localSnapshot?.project_id===p.id;
        if(requestedProjectId){
          if(out)out.textContent='This listing is no longer an editable draft, so it was not loaded into the form. Its saved data remains unchanged.';
          return;
        }
        p=null;
        currentProjectId='';
        localStorage.removeItem(ID_KEY);
      }
    }
    if(!p&&!requestedProjectId){
      const r=await x.from('projects').select('*').eq('owner_id',u.data.user.id).eq('status','draft').order('updated_at',{ascending:false}).limit(20);
      if(r.error){
        console.error('DRAFT LIST LOAD ERROR',r.error);
        if(out)out.textContent='Unable to retrieve your saved drafts: '+(r.error.message||'database query failed')+'. No listing was changed.';
        return;
      }
      p=(r.data||[]).find(isEditableDraft)||null;
    }
    if(p){
      currentProjectId=p.id;localStorage.setItem(ID_KEY,p.id);
      const localTime=localSnapshot?.saved_at?Date.parse(localSnapshot.saved_at):0;
      const dbTime=p.updated_at?Date.parse(p.updated_at):0;
      // When the seller explicitly opens a database listing by ID, the database record
      // is authoritative. A stale/empty localStorage snapshot must never blank the form.
      if(requestedProjectId||!localSnapshot?.data||rejectedLocalSnapshot||localSnapshot.project_id!==p.id||dbTime>=localTime){
        fill(p);
        localStorage.removeItem(LOCAL_KEY);localStorage.removeItem(LEGACY_KEY);
      }else{
        fill(localSnapshot.data);
      }
      restoreStep();
      if(out)out.textContent='Saved draft loaded successfully. Project ID: '+p.id;
    }else if(localSnapshot?.data&&!rejectedLocalSnapshot&&!localSnapshot.project_id&&!requestedProjectId){
      currentProjectId='';
      localStorage.removeItem(ID_KEY);
      fill(localSnapshot.data);
      if(out)out.textContent='Restored an unsaved draft from this device. Save it to your seller account when ready.';
    }else if(rejectedLocalSnapshot){
      localStorage.removeItem(LOCAL_KEY);localStorage.removeItem(LEGACY_KEY);
      if(out)out.textContent='This listing has already been submitted or published. Its saved data was not loaded into the editable form. You can continue with a separate editable draft.';
    }else if(!requestedProjectId&&out){
      out.textContent='No editable draft was found for this seller account. No new listing has been created.';
    }
  }
  let saveInFlight=null,saveAgain=false;
  function save(){
    // Serialize autosave/manual-save requests. If more input arrives during a save,
    // run one additional pass using the latest form values instead of racing inserts.
    if(saveInFlight){saveAgain=true;return saveInFlight;}
    saveInFlight=(async()=>{
      try{
        let result;
        do{saveAgain=false;result=await saveDraft();}while(saveAgain);
        return result;
      }finally{saveInFlight=null;}
    })();
    return saveInFlight;
  }
  function isEditableDraft(row){return !!row&&String(row.status||'').toLowerCase()==='draft'&&String(row.project_status||'').toLowerCase()!=='admin_review'&&String(row.ai_status||'').toLowerCase()!=='recommended_for_admin_review';}
  async function saveDraft(){
    local();saveStep();
    const x=await wait();
    if(!x){if(out)out.textContent='Offline — draft saved on this device. Engine '+VERSION;return {ok:false,offline:true};}
    const u=await x.auth.getUser();
    if(u.error||!u.data?.user){if(out)out.textContent='Please sign in. Draft saved on this device. Engine '+VERSION;return {ok:false,auth:false};}
    const payload=collect();['business_verification'].forEach(k=>delete payload[k]);payload.owner_id=u.data.user.id;payload.status='draft';
    if(Object.keys(payload).length<=2){if(out)out.textContent='Start entering your listing; it is already being saved. Engine '+VERSION;return {ok:false,empty:true};}
    if(out)out.textContent='Saving draft… Engine '+VERSION;
    let r;
    let insertAsNewDraft=!currentProjectId;
    if(currentProjectId){
      // Never demote or silently modify a submitted/published listing through draft autosave.
      // Only rows that are still drafts may be edited by this form until a reviewed edit flow exists.
      const existing=await x.from('projects').select('id,status,project_status,ai_status').eq('id',currentProjectId).eq('owner_id',u.data.user.id).maybeSingle();
      if(existing.error){
        if(out)out.textContent='Could not verify the listing status safely. Your changes remain on this device; no database changes were made.';
        return {ok:false,error:existing.error};
      }
      if(existing.data && !isEditableDraft(existing.data)){
        const e=new Error('This listing has already been submitted or published. Editing is paused to prevent unreviewed changes or accidental unpublishing. Your changes remain on this device.');
        if(out)out.textContent=e.message;
        return {ok:false,error:e,protectedListing:true};
      }
      r=await x.from('projects').update(payload).eq('id',currentProjectId).eq('owner_id',u.data.user.id).select('id,updated_at');
      if(r.error){if(out)out.textContent=(r.error.message||'Unable to update the existing listing.')+' Your draft remains on this device.';return {ok:false,error:r.error};}
      if(!r.data?.length){
        // A stale browser project ID must not block recovery forever or create duplicates.
        // First look for an exact-title draft owned by this signed-in user.
        const matches=await x.from('projects').select('id,status,project_status,ai_status').eq('owner_id',u.data.user.id).eq('title',payload.title||'').limit(2);
        if(matches.error){
          if(out)out.textContent='Could not verify the existing listing safely. Your draft remains on this device; no new listing was created.';
          return {ok:false,error:matches.error};
        }
        const found=matches.data||[];
        if(found.length>1){
          const e=new Error('More than one listing has this title. No new listing was created to avoid a duplicate.');
          if(out)out.textContent=e.message+' Your draft remains on this device.';
          return {ok:false,error:e};
        }
        if(found.length===1){
          if(!isEditableDraft(found[0])){
            const e=new Error('A listing with this title already exists and is not a draft. No changes were made.');
            if(out)out.textContent=e.message+' Your draft remains on this device.';
            return {ok:false,error:e};
          }
          currentProjectId=found[0].id;
          localStorage.setItem(ID_KEY,currentProjectId);
          r=await x.from('projects').update(payload).eq('id',currentProjectId).eq('owner_id',u.data.user.id).select('id,updated_at');
          if(r.error){if(out)out.textContent=(r.error.message||'Unable to update the matching draft.')+' Your draft remains on this device.';return {ok:false,error:r.error};}
          if(!r.data?.length){
            const e=new Error('The matching draft could not be updated. No new listing was created.');
            if(out)out.textContent=e.message+' Your draft remains on this device.';
            return {ok:false,error:e};
          }
        }else{
          // No row with this title exists for this owner, so clear only the stale
          // browser pointer and create one draft from the currently filled form.
          currentProjectId='';
          localStorage.removeItem(ID_KEY);
          local();
          insertAsNewDraft=true;
        }
      }
    }
    if(insertAsNewDraft){
      r=await x.from('projects').insert(payload).select('id,updated_at');
    }
    if(r.error){console.error('SAVE ERROR',r.error,payload);if(out)out.textContent=(r.error.message||'Unable to save listing.')+' | Draft remains on this device.';return {ok:false,error:r.error};}
    const id=r.data?.[0]?.id;
    if(id){currentProjectId=id;localStorage.setItem(ID_KEY,id);localStorage.removeItem(LOCAL_KEY);localStorage.removeItem(LEGACY_KEY);if(out)out.textContent='Draft saved successfully. Engine '+VERSION;return {ok:true,id};}
    return {ok:false,error:new Error('No project id returned')};
  }
  function normalizeUrl(value){
    // Remove invisible Unicode characters and common clipboard wrappers without
    // relaxing HTTPS or GitHub repository validation.
    return String(value??'')
      .replace(/[\u200B-\u200D\uFEFF]/g,'')
      .trim()
      .replace(/^["'`<\s]+|["'`>\s]+$/g,'')
      .trim();
  }
  function parseUrl(value){
    try{return new URL(normalizeUrl(value));}catch(e){return null;}
  }
  function submissionIssues(){
    const issues=[];
    if(!val('title'))issues.push('project name');
    if(val('short_description').length<20)issues.push('short description (at least 20 characters)');
    if((val('full_description')||val('description')).length<50)issues.push('full description (at least 50 characters)');
    const site=normalizeUrl(val('project_url')||val('website_url'));
    const repo=normalizeUrl(val('github_url'));
    const siteUrl=parseUrl(site);
    const repoUrl=parseUrl(repo);
    const isGithubHost=u=>!!u&&/(^|\.)github\.com$/i.test(u.hostname);
    const validSite=!!siteUrl&&siteUrl.protocol==='https:'&&!isGithubHost(siteUrl);
    const validRepo=!!repoUrl&&repoUrl.protocol==='https:'&&repoUrl.hostname.toLowerCase()==='github.com'&&/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(repoUrl.pathname);
    // Validate every URL the seller entered, even when the other URL is valid.
        // Otherwise an invalid optional URL could be silently saved alongside a valid one.
        if(site&&!validSite)issues.push('official website must be a valid HTTPS URL and must not be a GitHub URL');
        if(repo&&!validRepo)issues.push('repository must be a valid HTTPS GitHub owner/repository URL');
        if(!site&&!repo)issues.push('enter at least one valid official HTTPS website or GitHub repository');
    if(!val('business_model'))issues.push('business model');
    const price=num(val('asking_price')||val('price'));
    if(price===null||price<=0)issues.push('asking price greater than zero');
    if(!val('transfer_terms'))issues.push('asset transfer terms');
    if(!val('ownership_declaration'))issues.push('ownership declaration');
    return issues;
  }
  let reviewSubmissionInFlight=false;
  async function submitForReview(){
    // Prevent rapid double-clicks while validation, draft saving, or AI review is pending.
    if(reviewSubmissionInFlight)return;
    reviewSubmissionInFlight=true;
    if(submitBtn)submitBtn.disabled=true;
    try{
      const issues=submissionIssues();
      if(issues.length){
        const saved=await save();saveStep();
        const prefix=saved.ok?'Draft saved to your Web3Market account. AI review has not started. Complete these fields: ':saved.offline?'Database unavailable. A recovery copy is only on this device. AI review has not started. Complete these fields: ':saved.auth===false?'Please sign in to save this draft to your account. A recovery copy is only on this device. AI review has not started. Complete these fields: ':'The database save could not be confirmed. A recovery copy remains on this device. AI review has not started. Complete these fields: ';
        if(out)out.textContent=prefix+issues.join('; ')+'.';
        return;
      }
      const saved=await save();
      if(!saved.ok)return;
      const x=await wait();
      if(!x)throw new Error('Database connection is unavailable. The draft remains saved if the previous account save succeeded; otherwise only the recovery copy on this device is available.');
      const sessionResult=await x.auth.getSession();
      const token=sessionResult.data?.session?.access_token;
      if(!token)throw new Error('Please sign in again before submitting.');
      if(out)out.textContent='Running AI Review…';
      const r=await fetch(SUPABASE_URL+'/functions/v1/ai-review-project',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token,'apikey':KEY},body:JSON.stringify({project_id:saved.id,evidence_patch:{ownership_declaration:val('ownership_declaration'),domain_ownership:val('domain_verification'),github_ownership:val('github_ownership')}})});
      const j=await r.json().catch(()=>({error:'Invalid server response'}));
      if(!r.ok||!j.success)throw new Error(j.error||'AI Review failed.');
      const score=j.review?.overall_score??j.result?.ai_score??'—';
      const status=j.result?.ai_status||j.review?.recommendation||'submitted';
      const queued=j.result?.project_status==='admin_review'||j.result?.ai_status==='recommended_for_admin_review';
      if(out)out.textContent='AI review completed. Score: '+score+'. '+(queued?'The project has been sent to the Admin Review queue. It has not been published automatically.':'The project needs changes before it can enter the Admin Review queue.')+' Review status: '+String(status).replace(/_/g,' ')+'.';
      if(submitBtn)submitBtn.textContent='Submitted for AI Review';
    }catch(e){
      console.error('SUBMIT REVIEW ERROR',e);
      if(out)out.textContent='Saved as draft, but submission failed: '+(e.message||'Please try again.');
    }finally{
      reviewSubmissionInFlight=false;
      if(submitBtn&&submitBtn.textContent!=='Submitted for AI Review')submitBtn.disabled=false;
    }
  }
  // Upload selected listing media to the existing project-media bucket using the signed-in user's session.
  const IMAGE_MAX=8*1024*1024;
  const VIDEO_MAX=50*1024*1024;
  function safeFileName(name){return String(name||'file').normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(-100)||'file';}
  async function uploadListingFile(file,kind){
    if(!file)return null;
    const imageOk=['image/jpeg','image/png','image/webp'].includes(file.type);
    const videoOk=['video/mp4','video/webm','video/quicktime'].includes(file.type);
    const limit=kind==='video'?VIDEO_MAX:IMAGE_MAX;
    if(file.size>limit)throw new Error((kind==='video'?'Video':'Image')+' exceeds the '+(limit/(1024*1024))+' MB limit.');
    if(kind==='video'?!videoOk:!imageOk)throw new Error(kind==='video'?'Choose an MP4, WebM, or MOV video.':'Choose a PNG, JPG, or WebP image.');
    const x=await wait();if(!x)throw new Error('Storage connection is unavailable. Please try again.');
    const sr=await x.auth.getSession(),user=sr.data?.session?.user;
    if(!user)throw new Error('Please sign in before uploading files.');
    const path=user.id+'/listing-media/'+Date.now()+'-'+Math.random().toString(36).slice(2,8)+'-'+safeFileName(file.name);
    const result=await x.storage.from('project-media').upload(path,file,{cacheControl:'3600',upsert:false,contentType:file.type});
    if(result.error)throw result.error;
    const pub=x.storage.from('project-media').getPublicUrl(result.data.path);
    if(!pub?.data?.publicUrl)throw new Error('Upload finished but the public file URL could not be created.');
    return pub.data.publicUrl;
  }
  function mediaButton(text,fieldName,url,status){
    const b=document.createElement('button');
    b.type='button';b.className='btn btn-ghost media-remove-btn';
    b.textContent=text;b.setAttribute('aria-label',text);
    b.style.cssText='display:inline-flex;margin-top:8px;padding:7px 11px;border:1px solid #ff6474;color:#ff6474;border-radius:8px;cursor:pointer;font-size:12px;';
    b.onclick=()=>removeMediaUrl(fieldName,url,status);
    return b;
  }
  async function deleteOwnedListingMedia(url){
    try{
      const parsed=new URL(String(url||''));
      const base=new URL(SUPABASE_URL);
      const prefix='/storage/v1/object/public/project-media/';
      if(parsed.origin!==base.origin||!parsed.pathname.startsWith(prefix))return false;
      const path=decodeURIComponent(parsed.pathname.slice(prefix.length));
      const x=await wait();if(!x)return false;
      const auth=await x.auth.getUser(),user=auth.data?.user;
      if(!user||!path.startsWith(user.id+'/listing-media/'))return false;
      const result=await x.storage.from('project-media').remove([path]);
      return !result.error;
    }catch(e){console.warn('Could not delete uploaded media object',e);return false;}
  }
  async function removeMediaUrl(fieldName,url,status){
    const field=form.elements.namedItem(fieldName);
    if(!field)return;
    if(fieldName==='screenshots'){
      field.value=String(field.value||'').split(',').map(v=>v.trim()).filter(v=>v&&v!==url).join(', ');
    }else{
      field.value='';
      const inputId={logo_url:'logoFile',cover_image_url:'coverImageFile',video_url:'videoFile'}[fieldName];
      const input=inputId&&document.getElementById(inputId);if(input)input.value='';
    }
    renderSavedMediaPreviews();local();
    const result=await save();
    if(!result?.ok){
      if(status)status.textContent='تمت إزالة الملف من النموذج فقط، لكن لم يتأكد حفظ التغيير. احتفظنا بالملف في التخزين لتجنب كسر المسودة المحفوظة.';
      return;
    }
    const deleted=await deleteOwnedListingMedia(url);
    if(status)status.textContent=deleted?'File deleted from storage and removed from the listing.':'File removed from the listing and changes saved. If it was uploaded earlier, a copy may remain in storage.';
  }
  function wireSingleUpload(inputId,fieldName,statusId,previewId,kind){
    const input=document.getElementById(inputId),status=document.getElementById(statusId),preview=document.getElementById(previewId);
    if(!input||!status)return;
    let removeButton=null;
    const ensureButton=()=>{
      if(!removeButton){removeButton=mediaButton('Remove file from listing',fieldName,val(fieldName),status);(preview||status).insertAdjacentElement('afterend',removeButton);}
      removeButton.hidden=!val(fieldName);
      removeButton.onclick=()=>removeMediaUrl(fieldName,val(fieldName),status);
    };
    ensureButton();
    input.addEventListener('change',async()=>{
      const file=input.files?.[0];if(!file)return;
      status.textContent='Uploading '+file.name+'…';input.disabled=true;
      const oldUrl=val(fieldName);
      try{
        const url=await uploadListingFile(file,kind);
        const field=form.elements.namedItem(fieldName);if(field)field.value=url;
        if(preview){preview.src=url;preview.hidden=false;}
        status.textContent='File uploaded successfully and added to the listing.';
        ensureButton();renderSavedMediaPreviews();local();await save();
        if(oldUrl&&oldUrl!==url)await deleteOwnedListingMedia(oldUrl);
      }catch(e){status.textContent='Upload failed: '+(e.message||'Please try again.');}
      finally{input.disabled=false;ensureButton();}
    });
  }
  // Rebuild previews and per-file removal controls from the saved URL fields.
  function renderSavedMediaPreviews(){
    const setImage=(inputId,fieldName,statusId)=>{
      const el=document.getElementById(inputId),status=document.getElementById(statusId),url=val(fieldName);
      if(!el)return;
      const safe=safeMediaPreviewUrl(url);
      if(safe){el.src=safe;el.hidden=false;}else{el.removeAttribute('src');el.hidden=true;}
      let b=el.nextElementSibling;
      if(!b||!b.classList.contains('media-remove-btn')){b=mediaButton('Remove file from listing',fieldName,url,status);el.insertAdjacentElement('afterend',b);}
      b.hidden=!safe;b.onclick=()=>removeMediaUrl(fieldName,val(fieldName),status);
    };
    const video=document.getElementById('videoUploadPreview'),videoStatus=document.getElementById('videoUploadStatus'),videoUrl=safeMediaPreviewUrl(val('video_url'));
    if(video){if(videoUrl){video.src=videoUrl;video.hidden=false;}else{video.removeAttribute('src');video.hidden=true;}
      let b=video.nextElementSibling;
      if(!b||!b.classList.contains('media-remove-btn')){b=mediaButton('Remove video from listing','video_url',videoUrl,videoStatus);video.insertAdjacentElement('afterend',b);}
      b.hidden=!videoUrl;b.onclick=()=>removeMediaUrl('video_url',val('video_url'),videoStatus);
    }
    setImage('logoUploadPreview','logo_url','logoUploadStatus');
    setImage('coverUploadPreview','cover_image_url','coverUploadStatus');
    const grid=document.getElementById('screenshotsUploadPreview');
    if(grid){
      grid.replaceChildren();
      const urls=String(val('screenshots')||'').split(',').map(x=>safeMediaPreviewUrl(x.trim())).filter(Boolean).slice(0,12);
      urls.forEach((url,i)=>{
        const card=document.createElement('div');card.className='media-preview-card';card.style.cssText='display:flex;flex-direction:column;gap:6px;min-width:0;';
        const img=document.createElement('img');img.src=url;img.alt='Screenshot preview '+(i+1);img.loading='lazy';img.style.cssText='max-width:100%;border-radius:8px;';
        const b=mediaButton('Remove image', 'screenshots',url,document.getElementById('screenshotsUploadStatus'));
        card.append(img,b);grid.appendChild(card);
      });
    }
  }
  function safeMediaPreviewUrl(value){try{const u=new URL(String(value||'').trim());return ['http:','https:'].includes(u.protocol)?u.href:'';}catch(e){return '';}}
  wireSingleUpload('logoFile','logo_url','logoUploadStatus','logoUploadPreview','image');
  wireSingleUpload('coverImageFile','cover_image_url','coverUploadStatus','coverUploadPreview','image');
  wireSingleUpload('videoFile','video_url','videoUploadStatus','videoUploadPreview','video');
  const screenshotsInput=document.getElementById('screenshotsFiles');
  if(screenshotsInput)screenshotsInput.addEventListener('change',async()=>{
    const files=[...(screenshotsInput.files||[])];if(!files.length)return;
    const status=document.getElementById('screenshotsUploadStatus');screenshotsInput.disabled=true;status.textContent='Uploading '+files.length+' screenshot(s)…';
    try{
      const urls=[];for(const file of files)urls.push(await uploadListingFile(file,'image'));
      const field=form.elements.namedItem('screenshots');
      if(field){const old=String(field.value||'').split(',').map(x=>x.trim()).filter(Boolean);field.value=[...old,...urls].join(', ');}
      renderSavedMediaPreviews();status.textContent='Uploaded '+urls.length+' image(s) and added them to the listing.';local();await save();
    }catch(e){status.textContent='Upload failed: '+(e.message||'Please try again.');}
    finally{screenshotsInput.disabled=false;}
  });
  form.addEventListener('input',()=>{clearTimeout(window.__wmTimer);window.__wmTimer=setTimeout(local,150);clearTimeout(window.__wmDbTimer);window.__wmDbTimer=setTimeout(()=>{save();},1800);});
  form.addEventListener('change',()=>{local();saveStep();renderSavedMediaPreviews();save();});
  form.addEventListener('toggle',e=>{if(e.target.matches('details.group')&&e.target.open)saveStep();},true);
  form.addEventListener('submit',e=>{e.preventDefault();save();});
  window.addEventListener('beforeunload',()=>{local();saveStep();});
  if(submitBtn)submitBtn.addEventListener('click',submitForReview);
  window.web3MarketClearListingDraft=function(){try{localStorage.removeItem(LOCAL_KEY);localStorage.removeItem(LEGACY_KEY);localStorage.removeItem(ID_KEY);localStorage.removeItem(STEP_KEY);}catch(e){console.warn(e)}currentProjectId='';try{const u=new URL(window.location.href);u.searchParams.delete('project');window.history.replaceState(null,'',u.pathname+u.search+u.hash);}catch(e){console.warn(e)}form.reset();const p=document.getElementById('preview');if(p)p.style.display='none';if(out)out.textContent='Draft cleared from this device. Existing saved listings are not deleted. Save to create a new draft.';};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load,{once:true});else load();
})();