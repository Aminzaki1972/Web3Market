"use strict";
(async function(){
 const root=document.querySelector('#checkoutApp');
 const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 const offerId=new URLSearchParams(location.search).get('offer');
 if(!sb||!offerId){root.innerHTML='<div class="status">Offer information is unavailable.</div>';return;}
 const {data:{user}}=await sb.auth.getUser();
 if(!user){root.innerHTML='<div class="status">Please sign in.</div>';return;}
 const {data:offer,error}=await sb.from('marketplace_offers').select('*').eq('id',offerId).maybeSingle();
 if(error||!offer||offer.status!=='accepted'){root.innerHTML='<div class="status">Only an accepted offer can enter checkout.</div>';return;}
 if(offer.buyer_id!==user.id&&offer.seller_id!==user.id){root.innerHTML='<div class="status">You are not a participant in this offer.</div>';return;}
 const {data:existing}=await sb.from('marketplace_deals').select('id,status').eq('offer_id',offer.id).maybeSingle();
 root.innerHTML=`<h2>Accepted offer</h2><p>Amount: <strong>${Number(offer.amount).toLocaleString()} ${offer.currency||'USD'}</strong></p><p>Next: create the protected deal record, then connect an audited escrow provider. This screen does not move funds.</p>${existing?`<p>Deal already created: <strong>${existing.status}</strong></p><a class="btn" href="deal-room.html?offer=${offer.id}">Open Deal Room</a>`:`<button class="btn" id="createDeal">Create Deal Room</button>`}`;
 const button=document.querySelector('#createDeal'); if(!button)return;
 button.addEventListener('click',async()=>{button.disabled=true;button.textContent='Creating…';const {data:deal,error}=await sb.from('marketplace_deals').insert({offer_id:offer.id,project_id:offer.project_id,buyer_id:offer.buyer_id,seller_id:offer.seller_id,amount:offer.amount,currency:offer.currency||'USD',status:'pending'}).select().single();if(error){button.disabled=false;button.textContent='Create Deal Room';alert('Could not create deal.');return;}await sb.from('marketplace_deal_events').insert({deal_id:deal.id,actor_id:user.id,event_type:'checkout_started',message:'Protected deal record created; escrow not funded.'});location.href=`deal-room.html?offer=${offer.id}`;});
})();
