"use strict";
(async function(){
 const root=document.querySelector('#dealApp');
 const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 const offerId=new URLSearchParams(location.search).get('offer');
 if(!sb||!offerId){root.innerHTML='<div class="status">Deal information is unavailable.</div>';return;}
 const {data:{user}}=await sb.auth.getUser();
 if(!user){root.innerHTML='<div class="status">Please sign in.</div>';return;}
 const {data:offer,error}=await sb.from('marketplace_offers').select('*').eq('id',offerId).maybeSingle();
 if(error||!offer){root.innerHTML='<div class="status">Offer not found.</div>';return;}
 const participant=offer.buyer_id===user.id||offer.seller_id===user.id;
 if(!participant){root.innerHTML='<div class="status">You are not a participant in this deal.</div>';return;}
 let {data:deal}=await sb.from('marketplace_deals').select('*').eq('offer_id',offer.id).maybeSingle();
 if(!deal && offer.status==='accepted'){
  const {data:newDeal}=await sb.from('marketplace_deals').insert({offer_id:offer.id,project_id:offer.project_id,buyer_id:offer.buyer_id,seller_id:offer.seller_id,amount:offer.amount,currency:offer.currency||'USD',status:'pending'}).select().single();
  deal=newDeal;
  if(deal) await sb.from('marketplace_deal_events').insert({deal_id:deal.id,actor_id:user.id,event_type:'deal_created',message:'Deal room opened after offer acceptance.'});
 }
 if(!deal){root.innerHTML='<div class="status">The offer must be accepted before a deal room can be opened.</div>';return;}
 const {data:events}=await sb.from('marketplace_deal_events').select('event_type,message,created_at').eq('deal_id',deal.id).order('created_at',{ascending:false});
 root.innerHTML=`<h2>Deal status: <strong>${deal.status}</strong></h2><p>Amount: <strong>${Number(deal.amount).toLocaleString()} ${deal.currency}</strong></p><p>This workspace records the acquisition lifecycle. Funding, custody and asset transfer require a separately audited escrow integration.</p><h3>Timeline</h3>${(events||[]).map(e=>`<p><strong>${e.event_type}</strong> — ${e.message||''}<br><small>${new Date(e.created_at).toLocaleString()}</small></p>`).join('')||'<p>No events yet.</p>'}`;
})();
