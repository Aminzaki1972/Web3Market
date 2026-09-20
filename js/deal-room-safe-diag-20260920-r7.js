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
 let authUser=null;
 try{
  const authResult=await Promise.race([sb.auth.getUser(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Authentication request timed out')),10000))]);
  authUser=authResult?.data?.user||null;
  if(!authUser){location.replace('login.html?next='+encodeURIComponent(location.pathname+location.search));return}
 }catch(e){
  console.error('Deal Room auth',e);
  root.innerHTML='<div class="status">Unable to load your session. Please refresh or sign in again.</div>';
  return;
 }
 const user=authUser;
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
 let isAdmin=false;
 const params=new URLSearchParams(location.search),dealId=params.get('deal')||params.get('id');
 if(!dealId){root.innerHTML='<div class="status">Deal not specified.</div>';return}
 const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
 let deal=null,participant=null,channel=null,disposed=false,safeDeploymentError='',safeDeploymentBusy=false,safeDeploymentLog=[],paymentCheckBusy=false;

 const setStatus=(text,kind='')=>{const el=document.querySelector('#dealStatus');if(el){el.textContent=text;el.className='status'+(kind?' '+kind:'')}};
 const safeLogBox=()=>document.querySelector('#safeStatus');
 const addSafeLog=(message)=>{safeDeploymentLog.push(new Date().toLocaleTimeString()+' — '+String(message));const box=safeLogBox();if(box){box.innerHTML='<div class="safe-panel warn"><strong>Safe deployment diagnostic</strong><hr><pre style="white-space:pre-wrap;margin:0;font:inherit">'+esc(safeDeploymentLog.join('\n'))+'</pre><small>No payment is enabled and no USDT was moved.</small></div>'}};
 const loadDeal=async()=>{
  let response;
  try{
   response=await Promise.race([
    sb.from('deals').select('*').eq('id',dealId).maybeSingle(),
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('Deal query timed out after 10 seconds')),10000))
   ]);
  }catch(error){
   console.error('deal load exception',error);
   setStatus('Deal loading failed: '+String(error?.message||error),'warn');
   return false;
  }
  const {data,error}=response||{};
  if(error||!data){
   console.error('deal load',error);
   setStatus(error?'Deal query failed: '+String(error.message||error):'Deal not found for this account.','warn');
   const details=document.querySelector('#details');
   if(details)details.innerHTML='<strong>Deal could not be loaded.</strong><br><small>'+esc(error?.message||'The signed-in account is not allowed to read this deal, or the deal id is unavailable.')+'</small>';
   return false
  }
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

 if(!await loadDeal()){
  if(!deal){
   root.querySelector('#createSafeBtn')?.setAttribute('disabled','disabled');
   return;
  }
 }
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
 loadCanonicalWallet().then(async()=>{renderDealWalletState();if(canonicalWalletVerified && String(deal?.status||'').toLowerCase()==='accepted' && !(String(deal?.safe_deployment_status||'').toLowerCase()==='deployed' && /^0x[a-fA-F0-9]{40}$/.test(String(deal?.safe_address||'')))){const created=await ensureSafeDeployment(false);if(created)await renderSafe();}}).catch(e=>console.error('wallet state refresh before render',e));
 const dealWalletBtn=document.querySelector('#dealConnectWallet');
 if(dealWalletBtn)dealWalletBtn.addEventListener('click',connectDealWallet);
 const createSafeBtn=document.querySelector('#createSafeBtn');
 if(createSafeBtn){createSafeBtn.disabled=true;createSafeBtn.hidden=true;createSafeBtn.setAttribute('aria-hidden','true');}

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
 async function ensureSafeDeployment(manual=false){
  if(safeDeploymentBusy)return false;
  safeDeploymentBusy=true;
  if(manual)safeDeploymentLog=[];
  addSafeLog('Starting Safe deployment flow.');
  const createBtn=document.querySelector('#createSafeBtn');
  if(createBtn){createBtn.disabled=true;createBtn.hidden=true;createBtn.setAttribute('aria-hidden','true')}
  if(!deal || String(deal.status||'').toLowerCase()!=='accepted'){addSafeLog('Stopped: deal is not in accepted status.');return false;}
  addSafeLog('Deal verified: accepted / BNB Smart Chain (56).');
  if(String(deal.safe_deployment_status||'').toLowerCase()==='deployed' && /^0x[a-fA-F0-9]{40}$/.test(String(deal.safe_address||''))){addSafeLog('Safe is already deployed: '+deal.safe_address);return true;}
  const box=document.querySelector('#safeStatus');
  addSafeLog('Preparing a dedicated 2-of-3 Safe for this deal.');
  addSafeLog('The platform wallet is intended to pay the BNB deployment gas.');
  addSafeLog('No USDT is moved during Safe creation.');
  if(canonicalWalletAddress)addSafeLog('Current verified profile wallet: '+canonicalWalletAddress);
  try{
   let session=null;
   try{
    const current=await sb.auth.getSession();
    session=current?.data?.session||null;
   }catch(e){
    console.warn('Deal Room getSession failed',e);
   }
   if(!session && typeof window.Web3MarketSupabaseRestoreSession==='function'){
    try{
     await window.Web3MarketSupabaseRestoreSession();
     const restored=await sb.auth.getSession();
     session=restored?.data?.session||null;
    }catch(e){
     console.warn('Deal Room session restore failed',e);
    }
   }
   if(!session){
    for(let i=0;i<20&&!session;i++){
     await sleep(250);
     try{
      const retry=await sb.auth.getSession();
      session=retry?.data?.session||null;
     }catch(e){
      console.warn('Deal Room session retry failed',e);
     }
    }
   }
   if(!session?.access_token){addSafeLog('Authentication session is missing or expired.');throw new Error('Session expired. Please sign in again.');}
   addSafeLog('Testing safe-sdk-test (Safe Protocol Kit runtime) from the same authenticated browser session…');
   try{
    const sdkProbe=await sb.functions.invoke('safe-sdk-test',{body:{probe:'deal-room-safe-sdk'}});
    if(sdkProbe?.error){
     addSafeLog('safe-sdk-test result: '+(sdkProbe.error.name||'error')+' — '+(sdkProbe.error.message||String(sdkProbe.error)));
    }else{
     addSafeLog('safe-sdk-test result: '+JSON.stringify(sdkProbe?.data||{}));
    }
   }catch(sdkProbeError){
    addSafeLog('safe-sdk-test exception: '+String(sdkProbeError?.message||sdkProbeError));
   }
   addSafeLog('Testing safe-connect-test from the same authenticated browser session…');
   try{
    const probe=await sb.functions.invoke('safe-connect-test',{body:{probe:'deal-room'}});
    if(probe?.error){
     addSafeLog('safe-connect-test result: '+(probe.error.name||'error')+' — '+(probe.error.message||String(probe.error)));
    }else{
     addSafeLog('safe-connect-test result: '+JSON.stringify(probe?.data||{}));
    }
   }catch(probeError){
    addSafeLog('safe-connect-test exception: '+String(probeError?.message||probeError));
   }
   addSafeLog('Authenticated session ready. Calling create-safe Edge Function…');
   const invokeResult=await sb.functions.invoke('create-safe',{body:{deal_id:deal.id},headers:{Authorization:'Bearer '+session.access_token}});
   let result=invokeResult?.data||{};
   let invokeError=invokeResult?.error||null;
   addSafeLog('DIAGNOSTIC BUILD v7 loaded.');
   addSafeLog('create-safe SDK invocation completed.');
   addSafeLog('create-safe raw response: '+JSON.stringify(result||{}));
   console.error('create-safe response',invokeError,result);
   if(invokeError || !(result.ok===true || result.success===true)){
    const detail=[
     invokeError?.name ? 'name='+invokeError.name : '',
     invokeError?.message ? 'message='+invokeError.message : '',
     invokeError?.status ? 'status='+invokeError.status : '',
     invokeError?.context ? 'context='+String(invokeError.context) : '',
     invokeError?.cause ? 'cause='+String(invokeError.cause) : ''
    ].filter(Boolean).join(' | ');
    if(detail)addSafeLog('SDK error detail: '+detail);
    const isFetchError=String(invokeError?.name||'').toLowerCase().includes('fetch')||String(invokeError?.message||'').toLowerCase().includes('failed to send a request');
    if(invokeError){
     addSafeLog('SDK could not expose the HTTP response. Running a direct Edge Function diagnostic…');
     try{
      const direct=await fetch('https://hzhqlexnhtukfljcvnyd.supabase.co/functions/v1/create-safe',{
       method:'POST',
       headers:{
        'Content-Type':'application/json',
        'apikey':'sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI',
        'Authorization':'Bearer '+session.access_token
       },
       body:JSON.stringify({deal_id:deal.id})
      });
      const raw=await direct.text();
      let parsed={};
      try{parsed=raw?JSON.parse(raw):{};}catch(_){}
      addSafeLog('Direct create-safe HTTP status: '+direct.status+' '+direct.statusText);
      addSafeLog('Direct response: '+JSON.stringify(parsed||{}) || raw || '(empty response)');
      if(direct.ok && (parsed?.ok===true || parsed?.success===true)){
       result=parsed; invokeError=null;
      }else{
       safeDeploymentError=String(parsed?.error||parsed?.message||('HTTP '+direct.status));
       return false;
      }
     }catch(fetchError){
      safeDeploymentError='Direct Edge Function fetch failed: '+String(fetchError?.message||fetchError);
      addSafeLog('ERROR: '+safeDeploymentError);
      return false;
     }
    }else{
     safeDeploymentError=invokeError?.message||String(result.error||result.message||'create-safe returned an error');
     addSafeLog('ERROR: '+safeDeploymentError);
     return false;
    }
   }
   if(!(result.ok===true || result.success===true)){
    safeDeploymentError=String(result.error||result.message||'create-safe returned an error');
    addSafeLog('ERROR: '+safeDeploymentError);
    return false;
   }
   const refreshed=await sb.from('deals').select('*').eq('id',deal.id).maybeSingle();
   if(refreshed.data) deal=refreshed.data;
   addSafeLog('create-safe reported success. Deal record refreshed.');
   return true;
  }catch(e){
   console.error('Safe deployment',e); safeDeploymentError='Fetch/Network error: '+String(e?.message||'Unknown error');
   addSafeLog('ERROR: '+safeDeploymentError);
   addSafeLog('ERROR: '+safeDeploymentError);
   return false;
  }finally{
   safeDeploymentBusy=false;
   const createBtn=document.querySelector('#createSafeBtn');
   if(createBtn){createBtn.disabled=true;createBtn.hidden=true;createBtn.setAttribute('aria-hidden','true')}
  }
 }
 async function renderSafe(){
  if(!deal)return;
  const box=document.querySelector('#safeStatus');
  if(!box)return;
  const safe=String(deal.safe_address||'').trim();
  const chain=Number(deal.chain_id||0);
  if(!/^0x[a-fA-F0-9]{40}$/.test(safe)){
   box.innerHTML='<div class="safe-panel warn"><strong>Safe not configured.</strong><br>Payment remains disabled until a verified Safe is attached.</div>';
   return;
  }
  if(chain!==56){
   box.innerHTML='<div class="safe-panel warn"><strong>Chain mismatch.</strong><br>Expected BNB Smart Chain (56).</div>';
   return;
  }
  const paid=Boolean(deal.payment_tx_hash)||String(deal.payment_status||'').toLowerCase()==='confirmed'||String(deal.status||'').toLowerCase()==='payment_confirmed'||String(deal.status||'').toLowerCase()==='funded';
  const paymentResult=paid?'<div class="wallet-box" style="margin-top:10px;background:#f0fdf4;border-color:#bbf7d0;color:#166534"><strong>✓ Payment Verified & Confirmed</strong><div class="info" style="margin-top:6px;color:#166534">The payment has been verified on BSC. Both buyer and seller can see this result.</div>'+(deal.payment_tx_hash?'<div style="margin-top:6px;word-break:break-all">TX: <code>'+esc(deal.payment_tx_hash)+'</code></div>':'')+'</div>':'';
  const pay=participant==='buyer'&&!paid?'<a id="dealPayBtn" class="btn primary" href="deal-checkout.html?deal='+encodeURIComponent(deal.id)+'" style="margin-top:8px">Pay '+esc(deal.expected_amount??deal.amount??0)+' '+esc(deal.token_symbol||'USDT')+'</a><div id="paymentVerifyBox" class="wallet-box" style="margin-top:10px"><strong>Already paid?</strong><div class="info" style="margin-top:6px">If you already paid, paste the BSC transaction hash below. Web3Market will verify the existing transaction only; no second payment is requested.</div><input id="paymentTxHash" type="text" inputmode="text" autocomplete="off" spellcheck="false" placeholder="0x transaction hash" style="width:100%;box-sizing:border-box;margin-top:9px;padding:10px;border:1px solid #dbe1ea;border-radius:10px"><button id="verifyPaymentBtn" class="btn primary" type="button" style="margin-top:8px;width:100%">Verify Payment</button></div>':'';

  box.innerHTML='<div class="safe-panel ok"><strong>Escrow Protection · Safe Verified ✓</strong><br>2-of-3 Multisig · BNB Smart Chain (56)<br>Safe: <code>'+esc(safe)+'</code><br><small>No USDT has been moved during Safe creation.</small><a class="btn primary" href="https://app.safe.global/transactions/queue?safe=bnb:'+encodeURIComponent(safe)+'" target="_blank" rel="noopener noreferrer">Open Safe Queue</a>'+paymentResult+pay+'</div>';
  const verifyBtn=document.querySelector('#verifyPaymentBtn');
  const txInput=document.querySelector('#paymentTxHash');
  if(verifyBtn&&txInput){verifyBtn.onclick=()=>verifySubmittedTx(txInput.value);txInput.addEventListener('keydown',e=>{if(e.key==='Enter')verifySubmittedTx(txInput.value)})}
 }
 async function renderReleaseSigning(){
  if(!deal)return;
  const box=document.querySelector('#deliveryStatus'); if(!box)return;
  const {data:tx}=await sb.from('deal_multisig_transactions').select('*').eq('deal_id',deal.id).eq('action','release_to_seller').maybeSingle();
  if(!tx?.safe_tx_hash)return;
  const {data:sigs}=await sb.from('deal_multisig_signers').select('wallet_address,signature_status,signed_at,signature').eq('deal_id',deal.id).eq('safe_tx_hash',tx.safe_tx_hash).eq('signature_status','signed');
  const count=(sigs||[]).length;
  const esc2=v=>esc(v);
  let panel='<div class="wallet-box" id="safeReleasePanel"><strong>Safe Release</strong><div class="info" style="margin-top:6px">Atomic settlement: <strong>9.25 USDT → Seller</strong> + <strong>0.75 USDT → Web3Market</strong>.</div><div class="info" style="margin-top:6px">Safe transaction hash: <code style="word-break:break-all">'+esc2(tx.safe_tx_hash)+'</code></div><div class="info" style="margin-top:6px">Confirmations: <strong>'+count+' / 2</strong></div>';
  if(sigs?.length) panel+='<div class="info" style="margin-top:6px">'+sigs.map(s=>'✓ '+esc2(s.wallet_address)).join('<br>')+'</div>';
  if(count<2){
    const signedByMe=(sigs||[]).some(s=>String(s.wallet_address).toLowerCase()===String(canonicalWalletAddress).toLowerCase());
    if(!signedByMe) panel+='<button id="signSafeReleaseBtn" class="btn primary" type="button">Sign Safe Release</button><div class="info" style="margin-top:6px">This is an EIP-712 Safe transaction signature. It does not move funds.</div>';
    else panel+='<div class="notice" style="margin-top:8px">Your signature is recorded. Waiting for the second Safe owner.</div>';
  }else{
    panel+='<button id="executeSafeReleaseBtn" class="btn primary" type="button">Execute Safe Release</button><div class="info" style="margin-top:6px">Execution is the only step that can move the USDT. Your wallet will show the transaction and gas cost.</div>';
  }
  panel+='</div>';
  const old=document.querySelector('#safeReleasePanel'); if(old)old.outerHTML=panel; else box.insertAdjacentHTML('beforeend',panel);
  const selectSigningProvider=async()=>{
    const wm=window.Web3MarketWalletManager;
    if(!wm)throw new Error('Wallet selection engine is unavailable. Please refresh the page.');
    const target=String(canonicalWalletAddress||'').toLowerCase();
    if(!canonicalWalletVerified||!/^0x[a-f0-9]{40}$/.test(target))throw new Error('No verified wallet is linked to this Web3Market account.');
    const role=String(deal?.buyer_id===currentUser?.id?'buyer':deal?.seller_id===currentUser?.id?'seller':'').toLowerCase();
    if(!role)throw new Error('This account is not a buyer or seller participant in this deal.');
    const roleLabel=role==='buyer'?'Buyer':'Seller';
    const modal=document.createElement('div');
    modal.id='safeReleaseWalletModal';
    modal.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,.78);display:flex;align-items:center;justify-content:center;padding:20px;z-index:10000';
    modal.innerHTML='<div style="background:#fff;color:#111827;border-radius:16px;max-width:430px;width:100%;padding:20px"><div style="display:flex;justify-content:space-between;align-items:center"><strong>Sign as '+roleLabel+'</strong><button id="safeReleaseWalletClose" type="button" class="btn">×</button></div><div class="info" style="margin-top:10px">Only the wallet linked to this '+roleLabel+' account can sign this release.</div><div style="margin-top:10px"><small>Linked wallet</small><br><code style="word-break:break-all">'+esc(canonicalWalletAddress)+'</code></div><div id="safeReleaseWalletList" style="display:grid;gap:8px;margin-top:14px"></div><div id="safeReleaseWalletNotice" class="info" style="margin-top:10px">Select your linked wallet app. The account address will be checked before signing.</div></div>';
    document.body.appendChild(modal);
    const list=modal.querySelector('#safeReleaseWalletList'),notice=modal.querySelector('#safeReleaseWalletNotice');
    const close=()=>modal.remove();
    modal.querySelector('#safeReleaseWalletClose').onclick=close;
    modal.addEventListener('click',e=>{if(e.target===modal)close()});
    const detected=wm.listWallets();
    const candidates=detected.filter(row=>row.provider);
    const preferred=candidates.filter(row=>String(row.name).toLowerCase().includes('safepal'));
    const ordered=[...preferred,...candidates.filter(row=>!preferred.includes(row))];
    if(!ordered.length){
      const b=document.createElement('button'); b.type='button'; b.className='btn'; b.textContent='Open SafePal'; b.onclick=()=>{wm.launch('SafePal',notice);}; list.appendChild(b);
      return await new Promise((resolve,reject)=>{ modal._reject=reject; });
    }
    return await new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(fn,v)=>{if(settled)return;settled=true;close();fn(v)};
      ordered.forEach(row=>{
        const b=document.createElement('button');b.type='button';b.className='btn';b.style.cssText='width:100%;background:#f8fafc;color:#111827;border:1px solid #dbe4ef;text-align:left';
        b.innerHTML='<strong>'+wm.esc(row.name)+'</strong><br><small>Use this wallet for the '+roleLabel+' account</small>';
        b.onclick=async()=>{
          try{
            notice.textContent='Connecting to '+row.name+'…';
            const accounts=await row.provider.request({method:'eth_requestAccounts'});
            const connected=String(accounts?.[0]||'').toLowerCase();
            if(connected!==target)throw new Error('Wrong wallet account. This is not the verified '+roleLabel+' wallet linked to this deal.');
            try{await row.provider.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x38'}]});}
            catch(e){if(e?.code===4902)await row.provider.request({method:'wallet_addEthereumChain',params:[{chainId:'0x38',chainName:'BNB Smart Chain',nativeCurrency:{name:'BNB',symbol:'BNB',decimals:18},rpcUrls:['https://bsc-dataseed.binance.org'],blockExplorerUrls:['https://bscscan.com']}]});else throw new Error('Please switch this wallet to BNB Smart Chain (56).');}
            finish(resolve,row.provider);
          }catch(e){notice.textContent=e?.message||'Wallet connection failed.';}
        };
        list.appendChild(b);
      });
    });
  };
  const sign=document.querySelector('#signSafeReleaseBtn');
  if(sign) sign.onclick=async()=>{
    sign.disabled=true;sign.textContent='Selecting linked wallet…';
    try{
      const selectedProvider=await selectSigningProvider();
      sign.textContent='Waiting for wallet signature…';
      const provider=new ethers.BrowserProvider(selectedProvider);
      const network=await provider.getNetwork();
      if(Number(network.chainId)!==56)throw new Error('Please switch the selected wallet to BNB Smart Chain (56).');
      const signer=await provider.getSigner(),address=await signer.getAddress();
      if(!canonicalWalletVerified||String(address).toLowerCase()!==String(canonicalWalletAddress).toLowerCase())throw new Error('The selected wallet is not the wallet linked to this deal.');
      const types={SafeTx:[
       {name:'to',type:'address'},{name:'value',type:'uint256'},{name:'data',type:'bytes'},{name:'operation',type:'uint8'},
       {name:'safeTxGas',type:'uint256'},{name:'baseGas',type:'uint256'},{name:'gasPrice',type:'uint256'},
       {name:'gasToken',type:'address'},{name:'refundReceiver',type:'address'},{name:'nonce',type:'uint256'}]};
      const domain={chainId:56,verifyingContract:ethers.getAddress(tx.safe_address)};
      const message={to:ethers.getAddress(tx.to_address),value:String(tx.value_wei),data:tx.data,operation:Number(tx.operation),safeTxGas:String(tx.safe_tx_gas),baseGas:String(tx.base_gas),gasPrice:String(tx.gas_price),gasToken:ethers.getAddress(tx.gas_token||ethers.ZeroAddress),refundReceiver:ethers.getAddress(tx.refund_receiver||ethers.ZeroAddress),nonce:Number(tx.safe_nonce)};
      const digest=ethers.TypedDataEncoder.hash(domain,types,message);
      if(digest.toLowerCase()!==String(tx.safe_tx_hash).toLowerCase())throw new Error('Safe transaction hash changed. Refresh before signing.');
      const signature=await signer.signTypedData(domain,types,message);
      const {data:out,error}=await sb.functions.invoke('record-safe-release-signature',{body:{deal_id:deal.id,signature}});
      if(error||!out?.ok)throw new Error(error?.message||out?.error||'Signature could not be recorded.');
      await loadDeal(); await renderDelivery(); await renderReleaseSigning();
    }catch(e){alert(String(e?.message||e));sign.disabled=false;sign.textContent='Sign Safe Release'}
  };
  const exec=document.querySelector('#executeSafeReleaseBtn');
  if(exec)exec.onclick=async()=>{
    if(!confirm('Execute the verified 2-of-3 Safe release now? This will transfer 9.25 USDT to the seller and 0.75 USDT to Web3Market.'))return;
    exec.disabled=true;exec.textContent='Checking Safe…';
    try{
      if(!window.ethereum)throw new Error('Web3 wallet provider not found.');
      const provider=new ethers.BrowserProvider(window.ethereum);
      const network=await provider.getNetwork();if(Number(network.chainId)!==56)throw new Error('Switch wallet to BNB Smart Chain (56).');
      const signer=await provider.getSigner(),executor=await signer.getAddress();
      const safeAbi=['function getOwners() view returns(address[])','function getThreshold() view returns(uint256)','function nonce() view returns(uint256)','function getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256) view returns(bytes32)','function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) payable returns(bool)'];
      const safe=new ethers.Contract(ethers.getAddress(tx.safe_address),safeAbi,signer);
      const owners=await safe.getOwners(),threshold=Number(await safe.getThreshold()),nonce=Number(await safe.nonce());
      if(threshold!==2||nonce!==Number(tx.safe_nonce))throw new Error('Safe threshold/nonce changed. Release is blocked until refreshed.');
      const ownerSet=owners.map(a=>String(a).toLowerCase());
      if(!ownerSet.includes(executor.toLowerCase()))throw new Error('The connected wallet is not a Safe owner.');
      const typed={chainId:56,verifyingContract:ethers.getAddress(tx.safe_address)};
      const t={SafeTx:[{name:'to',type:'address'},{name:'value',type:'uint256'},{name:'data',type:'bytes'},{name:'operation',type:'uint8'},{name:'safeTxGas',type:'uint256'},{name:'baseGas',type:'uint256'},{name:'gasPrice',type:'uint256'},{name:'gasToken',type:'address'},{name:'refundReceiver',type:'address'},{name:'nonce',type:'uint256'}]};
      const m={to:ethers.getAddress(tx.to_address),value:String(tx.value_wei),data:tx.data,operation:Number(tx.operation),safeTxGas:String(tx.safe_tx_gas),baseGas:String(tx.base_gas),gasPrice:String(tx.gas_price),gasToken:ethers.getAddress(tx.gas_token||ethers.ZeroAddress),refundReceiver:ethers.getAddress(tx.refund_receiver||ethers.ZeroAddress),nonce:Number(tx.safe_nonce)};
      const hash=await safe.getTransactionHash(m.to,m.value,m.data,m.operation,m.safeTxGas,m.baseGas,m.gasPrice,m.gasToken,m.refundReceiver,m.nonce);
      if(String(hash).toLowerCase()!==String(tx.safe_tx_hash).toLowerCase())throw new Error('Safe transaction hash mismatch. Execution blocked.');
      const {data:signed}=await sb.from('deal_multisig_signers').select('wallet_address,signature').eq('deal_id',deal.id).eq('safe_tx_hash',tx.safe_tx_hash).eq('signature_status','signed');
      if(!signed||signed.length<2)throw new Error('Two signatures are required.');
      const packed=signed.slice().sort((a,b)=>a.wallet_address.toLowerCase().localeCompare(b.wallet_address.toLowerCase())).map(s=>ethers.Signature.from(s.signature).serialized.slice(2)).join('');
      const signatures='0x'+packed;
      exec.textContent='Checking gas…';
      await safe.execTransaction.estimateGas(m.to,m.value,m.data,m.operation,m.safeTxGas,m.baseGas,m.gasPrice,m.gasToken,m.refundReceiver,signatures);
      exec.textContent='Confirm execution in wallet…';
      const sent=await safe.execTransaction(m.to,m.value,m.data,m.operation,m.safeTxGas,m.baseGas,m.gasPrice,m.gasToken,m.refundReceiver,signatures);
      const receipt=await sent.wait();
      if(!receipt||receipt.status!==1)throw new Error('Safe execution failed on-chain.');
      exec.textContent='Verifying settlement…';
      const {data:finalized,error:fe}=await sb.functions.invoke('finalize-safe-release',{body:{deal_id:deal.id,tx_hash:receipt.hash}});
      if(fe||!finalized?.ok)throw new Error(fe?.message||finalized?.error||'On-chain settlement verification failed.');
      await loadDeal();await renderDelivery();await renderReleaseSigning();
    }catch(e){alert(String(e?.message||e));exec.disabled=false;exec.textContent='Execute Safe Release'}
  };
 }
 async function renderDelivery(){
  if(!deal)return;
  const box=document.querySelector('#deliveryStatus'); if(!box)return;
  const ds=String(deal.delivery_status||'pending').toLowerCase();
  const submitted=ds==='submitted'||ds==='accepted';
  const accepted=ds==='accepted'||Boolean(deal.buyer_approved_at);
  const data=deal.delivery_data&&typeof deal.delivery_data==='object'?deal.delivery_data:{};
  const title=esc(data.title||data.description||'Delivery package');
  const url=String(data.url||data.delivery_url||'').trim();
  let html='<div class="wallet-box"><strong>Delivery</strong><div class="info" style="margin-top:6px">Status: <strong>'+esc(ds.replace(/[_-]+/g,' '))+'</strong></div>';
  if(submitted) html+='<div class="info" style="margin-top:6px"><strong>'+title+'</strong>'+(url?' — <a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Open delivery</a>':'')+'</div>';
  if(participant==='seller'&&!accepted) html+='<button id="submitDeliveryBtn" class="btn primary" type="button">Submit Delivery</button>';
  if(participant==='buyer'&&submitted&&!accepted) html+='<button id="confirmDeliveryBtn" class="btn primary" type="button">Confirm Delivery</button><div class="info" style="margin-top:6px">This confirms delivery only. No USDT is released by this action.</div>';
  if(accepted) html+='<div class="notice" style="margin-top:8px;background:#f0fdf4;color:#166534">✓ Delivery accepted by buyer. Settlement can now be prepared.</div><button id="prepareReleaseBtn" class="btn primary" type="button">Prepare Safe Release</button><div id="releasePrepStatus" class="info" style="margin-top:6px">Preparing the settlement policy does not move funds.</div>';
  html+='</div>'; box.innerHTML=html;
  const submit=document.querySelector('#submitDeliveryBtn');
  if(submit) submit.onclick=async()=>{ submit.disabled=true; submit.textContent='Submitting…'; const description=prompt('Describe what you delivered'); if(!description){submit.disabled=false;submit.textContent='Submit Delivery';return} const deliveryUrl=prompt('Optional delivery URL (leave blank if not needed)')||''; const {data,error}=await sb.rpc('submit_deal_delivery',{p_deal_id:deal.id,p_delivery_data:{title:'Delivery package',description,url:deliveryUrl}}); if(error){alert(error.message||'Could not submit delivery');submit.disabled=false;submit.textContent='Submit Delivery';return} deal=data||deal; await loadDeal(); await renderDelivery(); await renderTerms(); };
  const confirm=document.querySelector('#confirmDeliveryBtn');
  if(confirm) confirm.onclick=async()=>{ if(!window.confirm('Confirm that you received and accepted the seller delivery?'))return; confirm.disabled=true; confirm.textContent='Confirming…'; const {data,error}=await sb.rpc('confirm_deal_delivery',{p_deal_id:deal.id}); if(error){alert(error.message||'Could not confirm delivery');confirm.disabled=false;confirm.textContent='Confirm Delivery';return} deal=data||deal; await loadDeal(); await renderDelivery(); await renderTerms(); };
  const prep=document.querySelector('#prepareReleaseBtn');
  if(prep) prep.onclick=async()=>{ 
   prep.disabled=true; prep.textContent='Preparing…'; 
   const out=document.querySelector('#releasePrepStatus');
   const callDirect=async(fn,body)=>{
    const sessionResult=await sb.auth.getSession(); const session=sessionResult?.data?.session;
    if(!session?.access_token) throw new Error('Session expired. Please sign in again.');
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),15000);
    try{
     const response=await fetch('https://hzhqlexnhtukfljcvnyd.supabase.co/functions/v1/'+fn,{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':'sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI','Authorization':'Bearer '+session.access_token},
      body:JSON.stringify(body),signal:controller.signal
     });
     const raw=await response.text(); let data={}; try{data=raw?JSON.parse(raw):{};}catch(_){}
     if(!response.ok) throw new Error(String(data?.error||data?.message||('HTTP '+response.status)));
     return data;
    }finally{clearTimeout(timer)}
   };
   try{
    if(out)out.textContent='Preparing release policy…';
    let first;
    try{first=await callDirect('prepare-deal-release',{deal_id:deal.id});}
    catch(e){if(out)out.textContent='Release policy error: '+String(e?.message||e);throw e;}
    if(!first?.ok){throw new Error(String(first?.error||'Release policy preparation failed'));}
    if(out)out.textContent='Preparing shared Safe transaction…';
    let second;
    try{second=await callDirect('prepare-safe-release-tx',{deal_id:deal.id});}
    catch(e){if(out)out.textContent='Safe transaction error: '+String(e?.message||e);throw e;}
    if(!second?.ok){throw new Error(String(second?.error||'Safe transaction preparation failed'));}
    if(out)out.textContent=second.already_prepared?'✓ Safe transaction already prepared. No funds moved.':'✓ Safe transaction prepared. No funds moved. 2 signatures are required.';
    prep.textContent='Release Prepared ✓'; await renderReleaseSigning();
   }catch(e){
    console.error('Prepare Safe Release failed',e);
    if(out && !String(out.textContent||'').includes('error'))out.textContent='Preparation failed: '+String(e?.message||e);
    prep.disabled=false; prep.textContent='Prepare Safe Release';
   }
  };
 }
 async function renderTerms(){
  if(!deal)return;
  const rows=await loadAgreement(),mine=rows.find(x=>x.party_role===participant&&String(x.party_id)===String(user.id)),buyer=rows.find(x=>x.party_role==='buyer')?.agreed_at,seller=rows.find(x=>x.party_role==='seller')?.agreed_at,actions=document.querySelector('#actions');
  if(!actions)return;
  actions.innerHTML=`<div class="notice"><strong>Dispute Resolution — Model B</strong><br>Buyer and Seller agree that Web3Market acts as the dispute resolution party. Funds are held by the 2-of-3 Safe, not by Web3Market. ${buyer?'Buyer ✓':'Buyer pending'} · ${seller?'Seller ✓':'Seller pending'}</div>${participant==='platform'?'<div class="notice ok">Platform moderator view — monitoring and dispute resolution only.</div>':''}<button id="agreeBtn" class="btn primary" ${participant==='platform'||mine?.agreed_at?'disabled':''}>${mine?.agreed_at?'Terms Accepted':'I Agree to Deal Terms'}</button><button id="disputeBtn" class="btn" style="background:#fff7ed;color:#9a3412">Open Dispute</button>`;
  const agreeBtn=document.querySelector('#agreeBtn');
  if(agreeBtn&&!mine?.agreed_at&&participant!=='platform')agreeBtn.onclick=async()=>{agreeBtn.disabled=true;const {error}=await sb.from('deal_party_agreements').upsert({deal_id:deal.id,party_role:participant,party_id:user.id,agreed_at:new Date().toISOString()},{onConflict:'deal_id,party_role,party_id'});if(error){alert(error.message||'Could not save agreement');agreeBtn.disabled=false;return}await renderTerms()};
  const db=document.querySelector('#disputeBtn');
  if(db)db.onclick=async()=>{const reason=prompt('Describe the dispute');if(!reason)return;const {error}=await sb.from('deal_disputes').insert({deal_id:deal.id,opened_by:user.id,reason,status:'open'});if(error)alert(error.message||'Could not open dispute');else alert('Dispute opened for Web3Market review.')};
 }
 renderDealWalletState();
 await loadMessages();await renderTerms();await renderDelivery();await renderReleaseSigning();
 // Safe deployment is manual-only from the Deal Room button to prevent automatic rerenders from hiding diagnostics or starting repeated deployment attempts.
 if(String(deal.safe_deployment_status||'').toLowerCase()==='deployed' && deal.safe_address) await renderSafe();
 async function verifySubmittedTx(txHash){
  if(paymentCheckBusy)return;
  paymentCheckBusy=true;
  const btn=document.querySelector('#verifyPaymentBtn'),input=document.querySelector('#paymentTxHash');
  if(btn){btn.disabled=true;btn.textContent='Verifying…'}
  try{
   const hash=String(txHash||'').trim();
   if(!/^0x[0-9a-fA-F]{64}$/.test(hash))throw new Error('Enter a valid BSC transaction hash (0x + 64 hex characters).');
   const sessionResult=await sb.auth.getSession();
   const session=sessionResult?.data?.session;
   if(!session?.access_token)throw new Error('Your session expired. Please sign in again.');
   setStatus('Verifying payment on BSC…');
   const response=await fetch('https://hzhqlexnhtukfljcvnyd.supabase.co/functions/v1/verify-deal-payment',{
    method:'POST',headers:{'Content-Type':'application/json','apikey':'sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI','Authorization':'Bearer '+session.access_token},
    body:JSON.stringify({deal_id:deal.id,tx_hash:hash})
   });
   const result=await response.json().catch(()=>({}));
   if(response.ok&&result.ok){
    await loadDeal(); await renderTerms(); await renderDelivery(); if(String(deal.safe_deployment_status||'').toLowerCase()==='deployed'&&deal.safe_address)await renderSafe();
    setStatus('Payment verified and confirmed ✓');
    return true;
   }
   const msg=String(result?.error||('Verification HTTP '+response.status));
   setStatus(msg,'warn');
   console.warn('Submitted payment verification:',result);
   return false;
  }catch(e){setStatus(String(e?.message||e),'warn');return false}
  finally{paymentCheckBusy=false;if(btn){btn.disabled=false;btn.textContent='Verify Payment'}}
 }
 const form=document.querySelector('#chatForm');
 if(form&&participant!=='platform')form.addEventListener('submit',async e=>{e.preventDefault();const input=document.querySelector('#messageInput'),message=input?.value.trim();if(!message)return;const btn=form.querySelector('button');btn.disabled=true;const {error}=await sb.from('deal_messages').insert({deal_id:deal.id,sender_id:user.id,message});btn.disabled=false;if(error){alert(error.message||'Unable to send message.');return}input.value='';await loadMessages()});
 channel=sb.channel('deal-room-'+deal.id)
  .on('postgres_changes',{event:'INSERT',schema:'public',table:'deal_messages',filter:'deal_id=eq.'+deal.id},loadMessages)
  .on('postgres_changes',{event:'UPDATE',schema:'public',table:'deals',filter:'id=eq.'+deal.id},async()=>{if(disposed)return;if(await loadDeal()){await renderTerms();await renderDelivery();if(String(deal.safe_deployment_status||'').toLowerCase()==='deployed' && deal.safe_address)await renderSafe()}})
  .subscribe();
 window.addEventListener('beforeunload',()=>{disposed=true;if(channel)sb.removeChannel(channel)});
})();