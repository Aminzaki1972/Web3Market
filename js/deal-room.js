"use strict";
(async function(){
 const root=document.querySelector('#dealApp')||document.querySelector('.room');
 if(!root)return;
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 let sb=null,lastInitError='';
 // Use the shared client first, but also initialize directly as a fallback.
 // This prevents the Deal Room from failing when supabase.js loads before the CDN client is ready.
 for(let i=0;i<80;i++){
  sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase||null;
  if(!sb&&window.supabase&&typeof window.supabase.createClient==='function'){
   try{
    sb=window.supabase.createClient('https://hzhqlexnhtukfljcvnyd.supabase.co','sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI',{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'web3market-auth'}});
    window.Web3MarketSupabase=window.Web3MarketSupabase||{};
    window.Web3MarketSupabase.client=sb;
    window.Web3MarketSupabase.supabase=sb;
    window.Web3MarketSupabase.getClient=()=>sb;
    window.supabaseClient=sb;
    window.web3marketSupabase=sb;
   }catch(e){lastInitError=e?.message||String(e)}
  }
  if(sb)break;
  await sleep(100);
 }
 if(!sb){
  root.innerHTML='<div class="status">Database connection unavailable. Please refresh the page.<br><small style="font-weight:400">The Supabase client could not be initialized'+(lastInitError?': '+String(lastInitError).replace(/[<>]/g,''):'')+'.</small></div>';
  console.error('Deal Room Supabase client unavailable',lastInitError);
  return;
 }
 const {data:{user},error:ue}=await sb.auth.getUser();
 if(ue||!user){location.replace('login.html?next='+encodeURIComponent(location.pathname+location.search));return}
 let profile=null;
 let canonicalWalletAddress='';
 let canonicalWalletVerified=false;
 const loadCanonicalWallet=async()=>{
  const {data,error}=await sb.from('profiles').select('role,wallet_address,wallet_verified,wallet_verified_at').eq('id',user.id).maybeSingle();
  if(error) throw error;
  profile=data||null;
  canonicalWalletAddress=String(profile?.wallet_address||'').trim();
  canonicalWalletVerified=profile?.wallet_verified===true && /^0x[a-fA-F0-9]{40}$/.test(canonicalWalletAddress);
  return profile;
 };
 try{await loadCanonicalWallet()}catch(e){console.error('canonical wallet profile load',e)}
 const isAdmin=String(profile?.role||'').toLowerCase()==='admin';
 const params=new URLSearchParams(location.search),dealId=params.get('deal')||params.get('id');
 if(!dealId){root.innerHTML='<div class="status">Deal not specified.</div>';return}
 const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
 let deal=null,participant=null,channel=null,disposed=false,safeDeploymentError='',safeDeploymentBusy=false,safeDeploymentLog=[];

 const setStatus=(text,kind='')=>{const el=document.querySelector('#dealStatus');if(el){el.textContent=text;el.className='status'+(kind?' '+kind:'')}};
 const safeLogBox=()=>document.querySelector('#safeStatus');
 const addSafeLog=(message)=>{safeDeploymentLog.push(new Date().toLocaleTimeString()+' — '+String(message));const box=safeLogBox();if(box){box.innerHTML='<div class="safe-panel warn"><strong>Safe deployment diagnostic</strong><hr><pre style="white-space:pre-wrap;margin:0;font:inherit">'+esc(safeDeploymentLog.join('\n'))+'</pre><small>No payment is enabled and no USDT was moved.</small></div>'}};
 const loadDeal=async()=>{
  const {data,error}=await sb.from('deals').select('*').eq('id',dealId).maybeSingle();
  if(error||!data){console.error('deal load',error);return false}
  const nextParticipant=String(data.buyer_id)===String(user.id)?'buyer':String(data.seller_id)===String(user.id)?'seller':isAdmin?'platform':null;
  if(!nextParticipant){setStatus('You are not a participant in this deal.','warn');return false}
  deal=data;participant=nextParticipant;
  const money=v=>Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2})+' '+(deal.currency||'USD');
  const meta=document.querySelector('#dealMeta');if(meta)meta.textContent=`Deal ${deal.id} · ${money(deal.amount)}`;
  setStatus(String(deal.status||'pending').replace(/[_-]+/g,' '));
  const paid=Boolean(deal.payment_tx_hash)||String(deal.payment_status||'').toLowerCase()==='confirmed'||String(deal.status||'').toLowerCase()==='payment_confirmed';
  const details=document.querySelector('#details');
  if(details)details.innerHTML=`<p>Amount: <strong>${esc(money(deal.amount))}</strong></p><p>Platform fee: <strong>${esc(money(deal.platform_fee_amount??deal.platform_fee??0))}</strong> (${Number(deal.platform_fee_percent??7.5).toFixed(2)}%)</p><p>Seller net: <strong>${esc(money(deal.seller_net_amount??Number(deal.amount||0)-Number(deal.platform_fee_amount??deal.platform_fee??0)))}</strong></p><p>Payment: <strong>${paid?'Verified on-chain':'Pending'}</strong></p><p>Role: <strong>${participant}</strong></p>${deal.payment_tx_hash?`<p>TX: <code>${esc(deal.payment_tx_hash)}</code></p>`:''}`;
  return true;
 };

 if(!await loadDeal()){if(!deal){root.innerHTML='<div class="status">Deal information is unavailable.</div>';return}}
 function renderDealWalletState(){
  const status=document.querySelector('#dealWalletStatus'),btn=document.querySelector('#dealConnectWallet');
  if(!status||!btn)return;
  if(canonicalWalletVerified){
   status.innerHTML='Connected & verified ✓ <code>'+esc(canonicalWalletAddress)+'</code><br><small>Using your verified Web3Market profile wallet.</small>';
   btn.textContent='Wallet Verified ✓'; btn.disabled=true; return;
  }
  status.textContent='Not verified. Connect and verify your wallet from your Web3Market profile.';
  btn.textContent='Connect & Verify Wallet'; btn.disabled=false;
 }
 async function connectDealWallet(){
  try{await loadCanonicalWallet();}catch(e){console.error('wallet state refresh',e)}
  if(canonicalWalletVerified){renderDealWalletState();return;}
  const wm=window.Web3MarketWalletManager;
  const btn=document.querySelector('#dealConnectWallet'),status=document.querySelector('#dealWalletStatus'),notice=document.querySelector('#dealWalletNotice');
  if(!wm){if(notice)notice.textContent='Wallet connection engine unavailable. Please refresh the page.';return}
  let modal=document.querySelector('#dealWalletModal');
  if(!modal){
   modal=document.createElement('div');
   modal.id='dealWalletModal';
   modal.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,.65);display:flex;align-items:center;justify-content:center;padding:20px;z-index:9999';
   modal.innerHTML='<div style="background:#fff;border-radius:16px;max-width:420px;width:100%;padding:18px"><div style="display:flex;justify-content:space-between;align-items:center"><strong>Connect Web3 Wallet</strong><button id="dealWalletClose" type="button" class="btn">×</button></div><div id="dealWalletList" style="display:grid;gap:8px;margin-top:14px"></div><div id="dealWalletModalNotice" class="info" style="margin-top:10px">Choose your wallet. Ownership verification uses a free signature only.</div></div>';
   document.body.appendChild(modal);
   modal.addEventListener('click',e=>{if(e.target===modal)modal.remove()});
   modal.querySelector('#dealWalletClose').onclick=()=>modal.remove();
  }
  const list=modal.querySelector('#dealWalletList'),mn=modal.querySelector('#dealWalletModalNotice');
  list.innerHTML='';
  wm.listWallets().forEach(row=>{
   const b=document.createElement('button');b.type='button';b.className='btn';b.style.cssText='width:100%;background:#f8fafc;color:#111827;border:1px solid #dbe4ef;text-align:left';
   b.innerHTML='<strong>'+wm.esc(row.name)+'</strong><br><small>'+ (row.detected?'Detected on this device':'Open wallet app / browser')+'</small>';
   b.onclick=async()=>{
    try{
     if(row.provider){
      modal.remove();
      if(btn){btn.disabled=true;btn.textContent='Connecting…'}
      const result=await wm.connectAndVerify(row.provider,row.name,{role:participant,purpose:'deal_room_wallet_ownership',setNotice:v=>{if(notice)notice.textContent=v}});
      if(status)status.innerHTML='Connected & verified ✓ <code>'+wm.esc(result.address)+'</code>';
      if(btn){btn.textContent='Wallet Verified ✓';btn.disabled=false}
     }else{
      mn.textContent='Opening '+row.name+'…';
      wm.launch(row.name,mn);
     }
    }catch(e){
     console.warn('Deal Room wallet verification failed',e);
     if(notice)notice.textContent=e?.message||'Wallet verification failed.';
     if(btn){btn.disabled=false;btn.textContent='Connect & Verify Wallet'}
     modal.remove();
    }
   };
   list.appendChild(b);
  });
  modal.hidden=false;
 }
 await loadCanonicalWallet().catch(e=>console.error('wallet state refresh before render',e));
 const dealWalletBtn=document.querySelector('#dealConnectWallet');
 if(dealWalletBtn)dealWalletBtn.addEventListener('click',connectDealWallet);
async function loadAgreement(){
  const {data,error}=await sb.from('deal_party_agreements').select('party_role,party_id,agreed_at').eq('deal_id',deal.id);
  if(error){console.error('agreement',error);return []}return data||[];
 }
 async function loadMessages(){
  if(!deal)return;
  const {data,error}=await sb.from('deal_messages').select('message,created_at,sender_id').eq('deal_id',deal.id).order('created_at',{ascending:true});
  if(error){console.error('messages',error);return}
  const box=document.querySelector('#messages');if(!box)return;
  box.innerHTML=(data||[]).map(m=>`<div class="msg ${String(m.sender_id)===String(user.id)?'mine':''}"><span class="translation-text">${esc(m.message)}</span><small>${new Date(m.created_at).toLocaleString()}</small></div>`).join('')||'<div class="info">No messages yet.</div>';
  box.scrollTop=box.scrollHeight;
 }
 // Legacy Safe creation is intentionally not callable from this isolated Deal Room.
 async function renderSafe(){
  if(!deal)return;
  const box=document.querySelector('#safeStatus');if(!box)return;
  const safe=String(deal.safe_address||'').trim(),chain=Number(deal.chain_id||0);
  if(!/^0x[a-fA-F0-9]{40}$/.test(safe)){
   if(safeDeploymentLog.length)return;
   if(safeDeploymentError){box.innerHTML='<div class="safe-panel warn"><strong>Safe deployment diagnostic</strong><br>'+esc(safeDeploymentError)+'<br><small>No payment is enabled and no USDT was moved.</small></div>';return}
   box.innerHTML='<div class="safe-panel warn"><strong>Safe not configured.</strong><br>Payment and release remain disabled until a verified Safe is attached.</div>';return}
  if(chain!==56){box.innerHTML=`<div class="safe-panel warn"><strong>Chain mismatch.</strong><br>Expected BNB Smart Chain (56), got ${esc(chain||'unknown')}.</div>`;return}
  try{
   if(!window.ethers?.JsonRpcProvider)throw new Error('Safe verification library unavailable');
   const rpcUrls=['https://bsc-dataseed.binance.org','https://bsc-dataseed1.binance.org','https://bsc.publicnode.com'];
   let verification=null,lastRpcError=null;
   for(const rpcUrl of rpcUrls){
    const provider=new ethers.JsonRpcProvider(rpcUrl,56,{staticNetwork:true});
    try{
     const contract=new ethers.Contract(safe,['function getOwners() view returns (address[])','function getThreshold() view returns (uint256)','function nonce() view returns (uint256)'],provider);
     const [owners,threshold,nonce,code]=await Promise.all([contract.getOwners(),contract.getThreshold(),contract.nonce(),provider.getCode(safe)]);
     verification={owners,threshold,nonce,code};break;
    }catch(error){lastRpcError=error;try{provider.destroy()}catch(_){}}
   }
   if(!verification)throw new Error('All BNB RPC verification endpoints failed: '+String(lastRpcError?.message||lastRpcError||'unknown RPC error'));
   const {owners,threshold,nonce,code}=verification,ok=code!=='0x'&&owners.length===3&&Number(threshold)===2;
   box.innerHTML=`<div class="safe-panel ${ok?'ok':'warn'}"><strong>Safe 2-of-3 verification</strong><br>${code!=='0x'?'Contract detected':'Not a contract'} · ${owners.length} owner(s) · threshold ${Number(threshold)}<br>Nonce: ${esc(nonce)}<div class="safe-note">${ok?'The Safe configuration is valid. Web3Market cannot release funds alone.':'Expected exactly 3 owners with a 2-signature threshold.'}</div>${ok?`<a class="btn primary" href="https://app.safe.global/transactions/queue?safe=bnb:${encodeURIComponent(safe)}" target="_blank" rel="noopener noreferrer">Open Safe Queue</a>`:''}</div>`;
  }catch(e){console.error('safe verification',e);box.innerHTML='<div class="safe-panel warn"><strong>Safe could not be verified.</strong><br>No release action will be enabled.</div>'}
 }
 async function renderTerms(){
  if(!deal)return;
  const actions=document.querySelector('#actions');
  if(!actions)return;
  // Fail closed: the legacy browser writes are not valid substitutes for the
  // new server-authoritative, version/hash-bound three-party agreement flow
  // or the pending-request/admin-review dispute workflow.
  actions.innerHTML=`<div class="notice warn"><strong>New Deal Management workflow is not connected yet.</strong><br>Agreement approval and dispute submission are temporarily unavailable here. The old direct-table actions are deliberately disabled so they cannot create misleading approvals or bypass administrative dispute review.</div><div class="notice">No agreement approval, dispute decision, Safe lock, deposit, or payout is being performed by this screen.</div>${participant==='platform'?'<div class="notice">Administrator view: review functions remain unavailable until the owner-authorized single-admin backend is connected.</div>':''}<button id="agreeBtn" class="btn primary" disabled title="Awaiting the server-authoritative agreement workflow">Agreement approval unavailable</button><button id="disputeBtn" class="btn" disabled title="Awaiting the dispute request and administrator review workflow">Dispute request unavailable</button>`;
 }
 // Legacy dispute modal removed: dispute requests must use the reviewed server workflow.
 renderDealWalletState();
 await loadMessages();await renderTerms();
 // Safe deployment is manual-only from the Deal Room button to prevent automatic rerenders from hiding diagnostics or starting repeated deployment attempts.
 if(String(deal.safe_deployment_status||'').toLowerCase()==='deployed' && deal.safe_address) await renderSafe();
 // Legacy automatic payment polling is disabled in this isolated branch.
 // It previously called the production payment-verification Edge Function.
 // Payment verification must be reintroduced only through the reviewed test backend.
 const form=document.querySelector('#chatForm');
 if(form){
  const input=document.querySelector('#messageInput'),send=form.querySelector('button');
  if(input){input.disabled=true;input.placeholder='Chat sending is paused until the authenticated permanent archive is connected.'}
  if(send){send.disabled=true;send.textContent='Chat unavailable'}
 }
 channel=sb.channel('deal-room-'+deal.id)
  .on('postgres_changes',{event:'INSERT',schema:'public',table:'deal_messages',filter:'deal_id=eq.'+deal.id},loadMessages)
  .on('postgres_changes',{event:'UPDATE',schema:'public',table:'deals',filter:'id=eq.'+deal.id},async()=>{if(disposed)return;if(await loadDeal()){await renderTerms();if(String(deal.safe_deployment_status||'').toLowerCase()==='deployed' && deal.safe_address)await renderSafe()}})
  .subscribe();
 window.addEventListener('beforeunload',()=>{disposed=true;if(channel)sb.removeChannel(channel)});
})();