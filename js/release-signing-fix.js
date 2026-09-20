"use strict";
(function(){
  const DEAL_ID=new URLSearchParams(location.search).get('deal')||new URLSearchParams(location.search).get('id');
  const SB_URL='https://hzhqlexnhtukfljcvnyd.supabase.co';
  const API_KEY='sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI';
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  async function getClient(){for(let i=0;i<80;i++){const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;if(sb)return sb;await sleep(250)}return null}

  async function wireFallback(){
    const btn=document.querySelector('#safeReleaseFallbackBtn');
    const note=document.querySelector('#safeReleaseFallbackNote');
    if(!btn||btn.dataset.wired==='1')return;
    btn.dataset.wired='1';
    btn.onclick=async()=>{
      btn.disabled=true;btn.textContent='Preparing…';
      try{
        const sb=await getClient(); if(!sb)throw new Error('Supabase client unavailable. Refresh the page.');
        const s=await sb.auth.getSession(),token=s?.data?.session?.access_token;
        if(!token)throw new Error('Session expired. Please sign in again.');
        const call=async fn=>{
          const r=await fetch(SB_URL+'/functions/v1/'+fn,{method:'POST',headers:{'Content-Type':'application/json','apikey':API_KEY,'Authorization':'Bearer '+token},body:JSON.stringify({deal_id:DEAL_ID})});
          const raw=await r.text();let d={};try{d=raw?JSON.parse(raw):{}}catch(_){}
          if(!r.ok||!d.ok)throw new Error(String(d.error||d.message||('HTTP '+r.status)));
          return d;
        };
        await call('prepare-deal-release');
        await call('prepare-safe-release-tx');
        note.textContent='✓ Safe transaction prepared with DELEGATECALL (1). Reloading…';
        await sleep(800);location.reload();
      }catch(e){note.textContent='Preparation failed: '+String(e?.message||e);btn.disabled=false;btn.textContent='Prepare Safe Release';}
    };
  }

  async function render(){
    const box=document.querySelector('#safeReleaseStatus'); if(!box||!DEAL_ID||box.dataset.releaseFix==='1')return;
    const sb=await getClient(); if(!sb)return;
    const q=await sb.from('deals').select('delivery_status,buyer_approved_at').eq('id',DEAL_ID).maybeSingle();
    if(q.error||!q.data)return;
    const accepted=String(q.data.delivery_status||'').toLowerCase()==='accepted'||Boolean(q.data.buyer_approved_at); if(!accepted)return;
    const tx=await sb.from('deal_multisig_transactions').select('safe_tx_hash,safe_address,to_address,value_wei,data,operation,safe_tx_gas,base_gas,gas_price,gas_token,refund_receiver,safe_nonce,status,confirmations_count').eq('deal_id',DEAL_ID).eq('action','release_to_seller').maybeSingle();
    const t=tx.data; box.dataset.releaseFix='1';
    if(t?.safe_tx_hash&&Number(t.operation)===1){
      box.dataset.releaseFix='1';
      const {data:{user}}=await sb.auth.getUser();
      const {data:profile}=user?await sb.from('profiles').select('wallet_address,wallet_verified,role').eq('id',user.id).maybeSingle():{data:null};
      const {data:sigs}=await sb.from('deal_multisig_signers').select('wallet_address,signature_status').eq('deal_id',DEAL_ID).eq('safe_tx_hash',t.safe_tx_hash).eq('signature_status','signed');
      const signed=(sigs||[]).some(x=>String(x.wallet_address||'').toLowerCase()===String(profile?.wallet_address||'').toLowerCase());
      if((sigs||[]).length>=2)return;
      box.innerHTML='<div class="wallet-box" style="background:#f0fdf4;border-color:#bbf7d0;color:#166534"><strong>Safe Release · Corrected transaction ✓</strong><div class="info" style="margin-top:6px">DELEGATECALL (operation 1). No funds move when signing.</div><div class="info" style="margin-top:6px">Safe transaction hash: <code style="word-break:break-all">'+String(t.safe_tx_hash)+'</code></div><div class="info" style="margin-top:6px">Confirmations: '+((sigs||[]).length)+' / 2</div>'+((sigs||[]).length?'<div class="info" style="margin-top:6px">'+(sigs||[]).map(x=>'✓ '+String(x.wallet_address)).join('<br>')+'</div>':'')+(signed?'<div class="notice" style="margin-top:8px">Your signature is already recorded. Waiting for the second owner.</div>':'<button id="safeReleaseFixSign" class="btn primary" type="button">Sign Safe Release</button><div id="safeReleaseFixNote" class="info" style="margin-top:6px">Free EIP-712 signature only. No transfer of funds is requested.</div>')+'</div>';
      if(signed)return;
      const sign=document.querySelector('#safeReleaseFixSign'),note=document.querySelector('#safeReleaseFixNote');
      sign.onclick=async()=>{
        sign.disabled=true;sign.textContent='Opening linked wallet…';
        try{
          if(!profile?.wallet_verified||!profile?.wallet_address)throw new Error('Your Web3Market wallet is not verified.');
          const target=String(profile.wallet_address).toLowerCase();
          if(String(profile.role||'').toLowerCase()!=='buyer'&&String(profile.role||'').toLowerCase()!=='seller')throw new Error('Only the buyer or seller account can sign.');
          const p=window.ethereum;
          if(!p)throw new Error('Open this Deal Room inside the wallet browser linked to your Web3Market account.');
          let accounts=await p.request({method:'eth_accounts'});
          if(String(accounts?.[0]||'').toLowerCase()!==target)accounts=await p.request({method:'eth_requestAccounts'});
          if(String(accounts?.[0]||'').toLowerCase()!==target)throw new Error('The active wallet account does not match your verified Web3Market wallet.');
          try{await p.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x38'}]});}catch(e){if(e?.code===4902)await p.request({method:'wallet_addEthereumChain',params:[{chainId:'0x38',chainName:'BNB Smart Chain',nativeCurrency:{name:'BNB',symbol:'BNB',decimals:18},rpcUrls:['https://bsc-dataseed.binance.org'],blockExplorerUrls:['https://bscscan.com']} ]});else throw new Error('Please switch the wallet to BNB Smart Chain (56).');}
          const provider=new ethers.BrowserProvider(p),signer=await provider.getSigner(),address=await signer.getAddress();
          const types={SafeTx:[{name:'to',type:'address'},{name:'value',type:'uint256'},{name:'data',type:'bytes'},{name:'operation',type:'uint8'},{name:'safeTxGas',type:'uint256'},{name:'baseGas',type:'uint256'},{name:'gasPrice',type:'uint256'},{name:'gasToken',type:'address'},{name:'refundReceiver',type:'address'},{name:'nonce',type:'uint256'}]};
          const domain={chainId:56,verifyingContract:ethers.getAddress(t.safe_address)};
          const message={to:ethers.getAddress(t.to_address),value:String(t.value_wei),data:t.data,operation:Number(t.operation),safeTxGas:String(t.safe_tx_gas),baseGas:String(t.base_gas),gasPrice:String(t.gas_price),gasToken:ethers.getAddress(t.gas_token||ethers.ZeroAddress),refundReceiver:ethers.getAddress(t.refund_receiver||ethers.ZeroAddress),nonce:Number(t.safe_nonce)};
          const digest=ethers.TypedDataEncoder.hash(domain,types,message);
          if(digest.toLowerCase()!==String(t.safe_tx_hash).toLowerCase())throw new Error('Safe transaction hash mismatch. Refresh before signing.');
          sign.textContent='Waiting for signature…';
          const signature=await signer.signTypedData(domain,types,message);
          const out=await sb.functions.invoke('record-safe-release-signature',{body:{deal_id:DEAL_ID,signature}});
          if(out.error||!out.data?.ok)throw new Error(out.error?.message||out.data?.error||'Signature could not be recorded.');
          note.textContent='✓ Signature recorded. Reloading…';await sleep(700);location.reload();
        }catch(e){note.textContent='Signing failed: '+String(e?.message||e);sign.disabled=false;sign.textContent='Sign Safe Release'}
      };
      return;
    }
    box.innerHTML='<div class="wallet-box" style="background:#eff6ff;border-color:#bfdbfe;color:#1e40af"><strong>Safe Release</strong><div class="info" style="margin-top:6px">✓ Delivery accepted. Prepare the corrected Safe transaction. No funds move during preparation.</div><button id="releaseFixPrepare" class="btn primary" type="button" style="margin-top:10px">Prepare Safe Release</button><div id="releaseFixNote" class="info" style="margin-top:6px">Uses DELEGATECALL (operation 1), then requires 2-of-3 Safe owner signatures.</div></div>';
    const btn=document.querySelector('#releaseFixPrepare'),note=document.querySelector('#releaseFixNote');
    btn.onclick=async()=>{
      btn.disabled=true;btn.textContent='Preparing…';note.textContent='Preparing corrected Safe transaction…';
      try{
        const s=await sb.auth.getSession(),token=s?.data?.session?.access_token;if(!token)throw new Error('Session expired. Please sign in again.');
        const call=async fn=>{const r=await fetch(SB_URL+'/functions/v1/'+fn,{method:'POST',headers:{'Content-Type':'application/json','apikey':API_KEY,'Authorization':'Bearer '+token},body:JSON.stringify({deal_id:DEAL_ID})});const raw=await r.text();let d={};try{d=raw?JSON.parse(raw):{}}catch(_){}if(!r.ok||!d.ok)throw new Error(String(d.error||d.message||('HTTP '+r.status)));return d};
        await call('prepare-deal-release'); await call('prepare-safe-release-tx');
        note.textContent='✓ Prepared with DELEGATECALL (1). Reloading to show Sign Safe Release…';await sleep(800);location.reload();
      }catch(e){note.textContent='Preparation failed: '+String(e?.message||e);btn.disabled=false;btn.textContent='Prepare Safe Release'}
    };
  }
  (async()=>{for(let i=0;i<80;i++){try{await wireFallback();await render()}catch(e){console.error('release-signing-fix',e)}await sleep(500)}})();
})();