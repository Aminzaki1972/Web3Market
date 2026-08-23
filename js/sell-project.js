"use strict";
(function(){
 const form=document.querySelector('#projectForm'),out=document.querySelector('#formStatus');
 if(!form)return;
 const sb=()=>window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 const val=(fd,n)=>{const v=fd.get(n);return v===null?'':String(v).trim()};
 const num=(fd,n)=>{const v=val(fd,n);return v===''?null:Number(v)};
 const message=(text,ok=false)=>{if(out){out.textContent=text;out.style.color=ok?'#4ade80':'#a78bfa'}};
 const ensureReviewButton=()=>{
  let btn=[...document.querySelectorAll('button,a')].find(x=>/submit\s*for\s*review/i.test(x.textContent||''));
  if(btn)return btn;
  const actions=document.querySelector('.actions')||form.lastElementChild||form.parentElement;
  if(!actions)return null;
  btn=document.createElement('button');
  btn.type='button';
  btn.className='btn btn-primary';
  btn.textContent='Submit for Review';
  actions.appendChild(btn);
  return btn;
 };
 const submitForReview=async()=>{
  const client=sb();
  if(!client){message('Database connection unavailable.');return}
  message('Checking your seller account…');
  const {data:{user},error:ue}=await client.auth.getUser();
  if(ue||!user){message('Please sign in before submitting.');return}
  const projectId=localStorage.getItem('web3market_project_id');
  if(!projectId){message('Please save the draft first.');return}
  const {data:project,error:pe}=await client.from('projects').select('*').eq('id',projectId).eq('owner_id',user.id).maybeSingle();
  if(pe||!project){message('Could not find your saved draft. Please save it first.');return}
  message('Submitting project for review…');
  const {data:updated,error:se}=await client.from('projects').update({status:'pending_review'}).eq('id',projectId).eq('owner_id',user.id).select('id,status').single();
  if(se){console.error(se);message(se.message||'Unable to submit the project for review.');return}
  localStorage.setItem('web3market_review_status','pending_review');
  message('Submitted for review. Starting AI Review…',true);
  try{
   const fn=await client.functions.invoke('ai-review-project',{body:{project_id:updated.id}});
   if(fn.error){console.warn('AI review invocation:',fn.error);message('Submitted for review. AI Review is pending.',true);return}
   localStorage.setItem('web3market_review_status','ai_review_completed');
   message('Submitted successfully. AI Review completed.',true);
  }catch(err){
   console.warn('AI review invocation failed:',err);
   message('Submitted for review. AI Review is pending.',true);
  }
 };
 const reviewBtn=ensureReviewButton();
 if(reviewBtn)reviewBtn.addEventListener('click',submitForReview);
 form.addEventListener('submit',async e=>{
  e.preventDefault();
  const client=sb(); if(!client){message('Database connection unavailable.');return}
  message('Checking your seller account…');
  const {data:{user},error:ue}=await client.auth.getUser();
  if(ue||!user){message('Please sign in before listing a project.');return}
  const {data:profile,error:pe}=await client.from('profiles').select('role').eq('id',user.id).maybeSingle();
  if(pe){console.error(pe);message('Unable to verify your account role.');return}
  if(String(profile?.role||user.user_metadata?.role||'').toLowerCase()!=='seller'){
   message('This page is for Seller accounts. Please sign in with a Seller account.');return;
  }
  const fd=new FormData(form),title=val(fd,'title'),short=val(fd,'short_description'),description=val(fd,'description');
  if(!title||short.length<20||description.length<50){message('Please complete the required project information.');return}
  const payload={owner_id:user.id,title,description:(short+'\n\n'+description).trim(),price:num(fd,'asking_price'),currency:val(fd,'currency')||'USD',status:'draft'};
  const existingId=localStorage.getItem('web3market_project_id');
  message('Saving draft…');
  let result;
  if(existingId){
   result=await client.from('projects').update(payload).eq('id',existingId).eq('owner_id',user.id).select('id').single();
  }else{
   result=await client.from('projects').insert(payload).select('id').single();
  }
  if(result.error){console.error(result.error);message(result.error.message||'Unable to save listing.');return}
  localStorage.setItem('web3market_project_id',String(result.data.id));
  message('Draft saved successfully.',true);
 });
})();
