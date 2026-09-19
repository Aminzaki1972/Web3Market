"use strict";
(async function(){
 const root=document.querySelector('#checkoutApp');
 let sb=null;
 const dealId=new URLSearchParams(location.search).get('deal');
 const waitForClient=async(timeout=8000)=>{const started=Date.now();while(Date.now()-started<timeout){try{sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase||null;if(!sb&&window.supabase&&typeof window.supabase.createClient==='function'){sb=window.supabase.createClient('https://hzhqlexnhtukfljcvnyd.supabase.co','sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI',{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'web3market-auth'}});window.supabaseClient=sb;window.web3marketSupabase=sb;window.Web3MarketSupabase=window.Web3MarketSupabase||{client:sb,supabase:sb,getClient:()=>sb};}if(sb)return true;}catch(e){console.warn('Checkout Supabase init',e)}await new Promise(r=>setTimeout(r,100))}return false};
 if(!root||!dealId){if(root)root.innerHTML='<div class="status">Deal information is unavailable.</div>';return;}
 if(!(await waitForClient())){root.innerHTML='<div class="status">Database connection unavailable. Please refresh the page.</div>';return;}
 const {data:{user},error:authError}=await sb.auth.getUser();
 if(authError||!user){root.innerHTML='<div class="status">Please sign in.</div>';return;}
 // Canonical deal source: public.deals. The Deal Room and payment verifier use this table too.
 let {data:deal,error}=await sb.from('deals').select('id,project_id,buyer_id,seller_id,amount,currency,status,platform_fee_percent,platform_fee_amount,platform_fee,seller_net_amount,payment_tx_hash,payment_status,chain_id,safe_address,token_contract,token_symbol,expected_amount,safe_deployment_status').eq('id',dealId).maybeSingle();
 if(error||!deal){root.innerHTML='<div class="status">Deal not found.</div>';return;}
 if(String(deal.buyer_id)!==String(user.id)&&String(deal.seller_id)!==String(user.id)){root.innerHTML='<div class="status">You are not a participant in this deal.</div>';return;}
 const esc=v=>String(v??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[m]));
 const amount=Number(deal.expected_amount??deal.amount??0),feePct=Number(deal.platform_fee_percent??7.5),fee=Number(deal.platform_fee_amount??deal.platform_fee??amount*feePct/100),net=Number(deal.seller_net_amount??amount-fee),currency=esc(deal.token_symbol||deal.currency||'USDT');
 if(String(deal.status||'').toLowerCase()==='accepted' && !(String(deal.safe_deployment_status||'').toLowerCase()==='deployed' && /^0x[0-9a-fA-F]{40}$/.test(String(deal.safe_address||'')))){
  const {data:{session}}=await sb.auth.getSession();
  if(session){
   try{
    const response=await fetch('https://hzhqlexnhtukfljcvnyd.supabase.co/functions/v1/create-safe',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},body:JSON.stringify({deal_id:deal.id})});
    const result=await response.json().catch(()=>({error:'Invalid Safe deployment response'}));
    if(response.ok && result.success){
      const refreshed=await sb.from('deals').select('id,project_id,buyer_id,seller_id,amount,currency,status,platform_fee_percent,platform_fee_amount,platform_fee,seller_net_amount,payment_tx_hash,payment_status,chain_id,safe_address,token_contract,token_symbol,expected_amount,safe_deployment_status').eq('id',dealId).maybeSingle();
      if(refreshed.data) deal=refreshed.data;
    }
   }catch(e){console.warn('Safe auto-deployment from checkout failed',e)}
  }
 }
 const configured=Number(deal.chain_id||0)===56&&/^0x[0-9a-fA-F]{40}$/.test(String(deal.safe_address||''))&&/^0x[0-9a-fA-F]{40}$/.test(String(deal.token_contract||''));
 const paid=Boolean(deal.payment_tx_hash)||String(deal.payment_status||'').toLowerCase()==='confirmed'||String(deal.status||'').toLowerCase()==='funded';
 root.innerHTML=`<h2>Deal Checkout</h2><div class="card"><p>Deal amount: <strong>${amount.toLocaleString()} ${currency}</strong></p><p>Web3Market fee: <strong>${fee.toLocaleString()} ${currency}</strong> (${feePct.toFixed(2)}%)</p><p>Seller net amount: <strong>${net.toLocaleString()} ${currency}</strong></p><p>Status: <strong>${esc(deal.status)}</strong></p><p>Payment: <strong>${paid?'Confirmed on-chain':'Pending'}</strong>${deal.payment_tx_hash?` · <code>${esc(deal.payment_tx_hash)}</code>`:''}</p>${configured&&String(deal.buyer_id)===String(user.id)&&!paid?'<button class="btn primary" id="payBtn">Pay from connected wallet</button>':'<div class="status">'+(paid?'Payment is already verified.':'Live payment is not enabled for this deal yet. The platform must assign a verified BNB Smart Chain Safe and token contract before funds can move.')+'</div>'}<a class="btn" href="deal-room.html?deal=${encodeURIComponent(deal.id)}">Open Deal Room</a></div>`;
 const payBtn=document.getElementById('payBtn');if(!payBtn)return;
 payBtn.addEventListener('click',async()=>{const old=payBtn.textContent;payBtn.disabled=true;try{
  if(!window.ethereum){const dappUrl=location.host+location.pathname+location.search;const isMobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);if(isMobile){payBtn.textContent='Opening MetaMask…';location.href='https://metamask.app.link/dapp/'+dappUrl;return;}throw new Error('Open Web3Market in MetaMask or another compatible wallet.');}
  let chain=await window.ethereum.request({method:'eth_chainId'});if(chain!=='0x38'){await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x38'}]});chain=await window.ethereum.request({method:'eth_chainId'});}if(chain!=='0x38')throw new Error('Please switch to BNB Smart Chain.');
  const accounts=await window.ethereum.request({method:'eth_requestAccounts'}),from=accounts?.[0];if(!from)throw new Error('No wallet account selected.');
  const {data:profile}=await sb.from('profiles').select('wallet_address,wallet_verified').eq('id',deal.buyer_id).maybeSingle();
  if(!profile?.wallet_address||profile.wallet_verified!==true)throw new Error('Buyer wallet must be connected and verified before payment.');
  if(from.toLowerCase()!==String(profile.wallet_address).toLowerCase())throw new Error('Connect the Buyer wallet locked to this deal.');
  const decimalsHex=await window.ethereum.request({method:'eth_call',params:[{to:deal.token_contract,data:'0x313ce567'},'latest']}),decimals=Number(BigInt(decimalsHex));if(!Number.isInteger(decimals)||decimals<0||decimals>36)throw new Error('Could not determine token decimals.');
  const value=String(deal.expected_amount??deal.amount),parts=value.split('.'),whole=BigInt(parts[0]||'0'),frac=(parts[1]||'').padEnd(decimals,'0');if(frac.length>decimals)throw new Error('Deal amount has too many decimal places for this token.');
  const base=(whole*(10n**BigInt(decimals))+BigInt(frac||'0')).toString(16).padStart(64,'0'),to=String(deal.safe_address).toLowerCase().replace(/^0x/,'').padStart(64,'0'),data='0xa9059cbb'+to+base;
  payBtn.textContent='Confirm payment in wallet…';const txHash=await window.ethereum.request({method:'eth_sendTransaction',params:[{from,to:deal.token_contract,data}]}),valid=/^0x[0-9a-fA-F]{64}$/.test(txHash);if(!valid)throw new Error('Wallet returned an invalid transaction hash.');
  payBtn.textContent='Verifying payment on BNB…';const {data:{session}}=await sb.auth.getSession();if(!session)throw new Error('Session expired. Please sign in again.');
  const response=await fetch('https://hzhqlexnhtukfljcvnyd.supabase.co/functions/v1/verify-deal-payment',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},body:JSON.stringify({deal_id:deal.id,tx_hash:txHash})});
  const result=await response.json().catch(()=>({error:'Invalid verifier response'}));if(!response.ok||!result.ok)throw new Error(result.error||'Payment verification failed');alert('Payment confirmed on-chain.');location.reload();
 }catch(err){payBtn.disabled=false;payBtn.textContent=old;alert(err?.message||'Payment failed');}});
})();
