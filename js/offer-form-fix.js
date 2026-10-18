"use strict";
(function(){
 document.addEventListener('submit',async function(e){
  const form=e.target;
  if(!form||form.id!=='offerForm')return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if(form.dataset.submitting==='true')return;
  form.dataset.submitting='true';
  const out=document.getElementById('offerStatus');
  const submitBtn=form.querySelector('button[type="submit"]');
  const originalBtnText=submitBtn?.textContent||'Send Offer';
  if(submitBtn){submitBtn.disabled=true;submitBtn.textContent='Submitting offer…';}
  let created=false;
  try{
   const client=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
   if(!client)throw new Error('Database connection unavailable.');
   const {data:{user},error:ue}=await client.auth.getUser();
   if(ue||!user)throw new Error('Please sign in before making an offer.');
   const id=new URLSearchParams(location.search).get('id');
   if(!id)throw new Error('Project not specified.');
   const {data:p,error:pe}=await client.from('projects').select('id,owner_id,currency,status').eq('id',id).single();
   if(pe||!p)throw new Error('Project not found or unavailable.');
   if(String(p.status||'').toLowerCase()==='sold')throw new Error('This project has already been sold and is no longer accepting offers.');
   if(p.owner_id===user.id)throw new Error('You cannot make an offer on your own project.');
   const {data:profile,error:profileError}=await client.from('profiles').select('role').eq('id',user.id).maybeSingle();
   if(profileError)throw profileError;
   const role=String(profile?.role||user.user_metadata?.role||'').trim().toLowerCase();
   if(role!=='buyer')throw new Error('A Buyer account is required to make an offer.');
   const amount=Number(form.elements.amount.value);
   if(!Number.isFinite(amount)||amount<=0)throw new Error('Enter a valid amount.');
   // One active deal per buyer/project: reuse the existing Deal Room rather than inserting duplicates.
   const existing=await client.from('deals').select('id,status').eq('project_id',p.id).eq('buyer_id',user.id).in('status',['pending','accepted','funded','in_progress','disputed']).order('created_at',{ascending:false}).limit(1).maybeSingle();
   if(existing.error)throw existing.error;
   if(existing.data){
    if(out)out.innerHTML='You already have an active offer for this project. <a href="deal-room.html?deal='+encodeURIComponent(existing.data.id)+'">Open your existing Deal Room →</a>';
    return;
   }
   const message=String(form.elements.message.value||'').trim();
   const {data:deal,error:de}=await client.from('deals').insert({project_id:p.id,buyer_id:user.id,seller_id:p.owner_id,amount,currency:p.currency||'USD',status:'pending'}).select('id').single();
   if(de)throw de;
   created=true;
   if(message){const {error:me}=await client.from('deal_messages').insert({deal_id:deal.id,sender_id:user.id,message});if(me)throw me;}
   // Best-effort notification: never roll back or misreport a successfully created offer if email delivery is unavailable.
   try{
    const {data:notifyData,error:notifyError}=await client.functions.invoke('marketplace-offer-notification',{body:{deal_id:deal.id}});
    if(notifyError||notifyData?.email_status==='failed')console.warn('Offer was created, but one or more seller notifications may need retry.',notifyError||notifyData);
   }catch(notifyErr){console.warn('Offer was created; notification delivery will need follow-up.',notifyErr);}
   if(out)out.innerHTML='Offer submitted successfully. <a href="deal-room.html?deal='+encodeURIComponent(deal.id)+'">Open Deal Room →</a>';
   form.reset();
  }catch(err){
   console.error('Web3Market offer:',err);
   if(out)out.textContent=err?.message||'Unable to submit offer.';
  }finally{
   form.dataset.submitting='false';
   if(submitBtn){submitBtn.disabled=created;submitBtn.textContent=created?'Offer submitted':originalBtnText;}
  }
 },true);
})();
