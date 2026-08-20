"use strict";
(async function(){
 const root=document.querySelector('#escrowApp');
 const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
 const offerId=new URLSearchParams(location.search).get('offer');
 if(!sb||!offerId){root.innerHTML='<div class="status">Offer information is unavailable.</div>';return;}
 const {data:{user}}=await sb.auth.getUser();
 if(!user){root.innerHTML='<div class="status">Please sign in.</div>';return;}
 const {data:deal,error}=await sb.from('marketplace_deals').select('*').eq('offer_id',offerId).maybeSingle();
 if(error||!deal||![deal.buyer_id,deal.seller_id].includes(user.id)){root.innerHTML='<div class="status">Deal not found or access denied.</div>';return;}
 const buyer=deal.buyer_id===user.id;
 root.innerHTML=`<h2>Deal #${deal.id.slice(0,8)}</h2><p>Amount: <strong>${Number(deal.amount).toLocaleString()} ${deal.currency}</strong></p><p>Current status: <strong>${deal.status}</strong></p><div class="card"><h3>Testnet checklist</h3><ul><li>✓ Buyer and seller verified by Supabase Auth</li><li>✓ Deal record exists</li><li>✓ Escrow status is tracked separately from the deal</li><li>○ Testnet wallet/network configuration</li><li>○ Audited escrow contract deployment</li><li>○ Deposit transaction</li><li>○ Release/refund/dispute tests</li></ul></div>${buyer?'<p><strong>Buyer:</strong> do not send funds to an address shown by an unaudited page.</p>':'<p><strong>Seller:</strong> no asset transfer should occur until the escrow contract confirms funding.</p>'}`;
})();
