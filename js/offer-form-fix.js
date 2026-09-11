"use strict";
(function(){
 document.addEventListener('submit',async function(e){
  const form=e.target;
  if(!form||form.id!=='offerForm')return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const out=document.getElementById('offerStatus');
  const client=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
  try{
   if(!client)throw new Error('Database connection unavailable.');
   const {data:{user},error:ue}=await client.auth.getUser();
   if(ue||!user)throw new Error('Please sign in before making an offer.');
   const id=new URLSearchParams(location.search).get('id');
   if(!id)throw new Error('Project not specified.');
   const {data:p,error:pe}=await client.from('projects').select('id,owner_id,currency').eq('id',id).single();
   if(pe||!p)throw new Error('Project not found or unavailable.');
   if(p.owner_id===user.id)throw new Error('You cannot make an offer on your own project.');
   const amount=Number(form.elements.amount.value);
   if(!Number.isFinite(amount)||amount<=0)throw new Error('Enter a valid amount.');
   const message=String(form.elements.message.value||'').trim();
   const {data:deal,error:de}=await client.from('deals').insert({project_id:p.id,buyer_id:user.id,seller_id:p.owner_id,amount,currency:p.currency||'USD',status:'pending'}).select('id').single();
   if(de)throw de;
   if(message){const {error:me}=await client.from('deal_messages').insert({deal_id:deal.id,sender_id:user.id,message});if(me)throw me;}
   out.textContent='Offer submitted successfully.';
   form.reset();
  }catch(err){console.error('Web3Market offer:',err);out.textContent=err?.message||'Unable to submit offer.';}
 },true);
})();
