"use strict";
(function(){
 const sb=()=>window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 window.Web3MarketOffers={
  async act(offerId,action,amount=null,currency=null,message=null){
   const client=sb(); if(!client) throw new Error('Database connection unavailable.');
   const {data:{user},error:ue}=await client.auth.getUser(); if(ue||!user) throw new Error('Please sign in.');
   const {data:offer,error:oe}=await client.from('marketplace_offers').select('id,project_id,buyer_id,amount,currency,status').eq('id',offerId).single();
   if(oe||!offer) throw new Error('Offer not found.');
   const {data:project,error:pe}=await client.from('marketplace_projects').select('owner_id').eq('id',offer.project_id).single();
   if(pe||!project) throw new Error('Project not found.');
   const isBuyer=user.id===offer.buyer_id,isSeller=user.id===project.owner_id;
   if(!isBuyer&&!isSeller) throw new Error('You are not a participant in this offer.');
   const allowed={accepted:isSeller,rejected:isSeller,withdrawn:isBuyer,countered:true};
   if(!allowed[action]) throw new Error('Action not allowed.');
   if(['accepted','rejected','withdrawn'].includes(action)&&offer.status!=='pending'&&offer.status!=='countered') throw new Error('This offer is no longer active.');
   if(action==='countered' && (!amount||Number(amount)<=0)) throw new Error('Counter offer amount must be greater than zero.');
   const nextStatus=action==='countered'?'countered':action;
   const patch={status:nextStatus,updated_at:new Date().toISOString()};
   if(action==='countered'){patch.amount=Number(amount);patch.currency=currency||offer.currency;patch.message=message||null;}
   const {error:up}=await client.from('marketplace_offers').update(patch).eq('id',offerId); if(up) throw up;
   const {error:ev}=await client.from('marketplace_offer_events').insert({offer_id:offerId,actor_id:user.id,action,amount:action==='countered'?Number(amount):offer.amount,currency:currency||offer.currency,message:message||null}); if(ev) throw ev;
   return {ok:true,status:nextStatus};
  }
 };
})();
