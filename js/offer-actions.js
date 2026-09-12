"use strict";
(function(){
 const sb=()=>window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 window.Web3MarketOffers={
  async act(offerId,action,amount=null,currency=null,message=null){
   const client=sb(); if(!client) throw new Error('Database connection unavailable.');
   const {data:{user},error:ue}=await client.auth.getUser(); if(ue||!user) throw new Error('Please sign in.');
   if(!['accepted','rejected','withdrawn','countered'].includes(action)) throw new Error('Action not allowed.');
   if(action==='countered'&&(!amount||Number(amount)<=0)) throw new Error('Counter offer amount must be greater than zero.');
   const {data,result,error}=await client.rpc('act_on_marketplace_offer',{p_offer_id:offerId,p_action:action,p_amount:action==='countered'?Number(amount):null,p_currency:currency||null,p_message:message||null});
   if(error)throw error;
   result&&void result;
   return data||{ok:true,status:action};
  }
 };
})();
