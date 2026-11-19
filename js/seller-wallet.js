"use strict";
(function(){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  function manager(){return window.Web3MarketWalletManager||null}
  function activate(button,action){
    // Use the trusted click event only. Preventing pointerup on Android Chrome
    // can suppress the subsequent click and break external wallet app handoff.
    button.disabled=false;button.removeAttribute("disabled");
    button.style.pointerEvents="auto";button.style.touchAction="manipulation";
    button.style.position="relative";button.style.zIndex="2";
    button.onclick=function(e){
      if(e){e.preventDefault();e.stopPropagation();if(e.isTrusted===false)return;}
      try{action(e)}catch(err){console.error("Seller wallet action failed",err);const n=document.getElementById("walletNotice");if(n)n.textContent=err&&err.message?err.message:"Wallet action failed."}
      return false;
    };
  }
  let managerLoadPromise=null;
  async function ensureManager(){
    const ready=manager();if(ready)return ready;
    if(!managerLoadPromise){
      managerLoadPromise=(async()=>{
        const notice=document.getElementById("walletNotice");
        if(notice)notice.textContent="Loading wallet connection…";
        let script=document.getElementById("web3market-wallet-manager-dynamic");
        if(!script){
          script=document.createElement("script");script.id="web3market-wallet-manager-dynamic";
          script.src="/js/wallet-manager.js?v=20261118-wallet-autoconnect-v2";script.async=true;
          const loaded=new Promise((resolve,reject)=>{script.addEventListener("load",resolve,{once:true});script.addEventListener("error",()=>reject(new Error("Wallet manager script failed to load.")),{once:true})});
          document.head.appendChild(script);await loaded;
        }
        for(let i=0;i<80;i++){const wm=manager();if(wm)return wm;await sleep(100)}
        return null;
      })().finally(()=>{managerLoadPromise=null});
    }
    return managerLoadPromise;
  }
  const wanted=()=>new URLSearchParams(location.search).get("wm_wallet");
  function closeModal(){const m=document.getElementById("walletModal");if(m){m.hidden=true;m.style.display="none"}}
  function ensureWalletStyles(){
    if(document.getElementById("w3m-wallet-premium-style"))return;
    const style=document.createElement("style");style.id="w3m-wallet-premium-style";
    style.textContent=`
      #walletModal{padding:16px!important;backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px)}
      #walletModal>div{width:min(460px,100%)!important;max-height:min(82vh,720px);overflow:auto;padding:24px!important;border:1px solid #e8eaf2;box-shadow:0 28px 90px rgba(10,16,35,.32)!important}
      #walletModal>div>div:first-child{margin-bottom:5px}
      #walletModal>div>div:first-child strong{font-size:20px!important;letter-spacing:-.45px;color:#111827}
      #walletModalClose{width:36px;height:36px;padding:0;border-radius:11px;font-size:22px;background:#f3f4f6;border:0;color:#475569}
      #walletModal .muted{font-size:12px;line-height:1.6;color:#64748b}
      #walletList{display:grid;grid-template-columns:1fr;gap:10px!important;margin-top:16px}
      #walletList .wallet-option{width:100%;min-height:76px;box-sizing:border-box;display:grid;grid-template-columns:48px minmax(0,1fr) 22px;align-items:center;gap:14px;padding:12px 15px!important;text-align:left;border:1px solid #e5e7eb!important;border-radius:15px!important;background:#fff!important;color:#111827!important;box-shadow:0 2px 7px rgba(15,23,42,.035);cursor:pointer!important;transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease}
      #walletList .wallet-option:focus-visible{outline:3px solid rgba(99,102,241,.28);outline-offset:2px}
      #walletList .wallet-option:active{transform:scale(.985);border-color:#7c3aed!important}
      #walletList .wallet-option:hover{border-color:#a5b4fc!important;box-shadow:0 8px 22px rgba(79,70,229,.10)}
      #walletList .wallet-icon{width:48px;height:48px;display:grid;place-items:center;border-radius:13px;background:#f6f7fb;color:#4f46e5;font-size:24px;overflow:hidden}
      #walletList .wallet-icon img{width:34px;height:34px;object-fit:contain}
      #walletList .wallet-option strong{display:block;font-size:14px;font-weight:800;line-height:1.35;color:#111827}
      #walletList .wallet-option small{display:block;margin-top:4px;font-size:11px;line-height:1.35;color:#64748b}
      #walletList .wallet-arrow{font-size:25px;color:#94a3b8;text-align:center}
      #walletList .wallet-option.unavailable{background:#fbfcfe!important}
      @media(max-width:480px){#walletModal>div{padding:18px!important;border-radius:18px!important}#walletList .wallet-option{min-height:70px;grid-template-columns:42px minmax(0,1fr) 18px;gap:11px;padding:10px 12px!important}#walletList .wallet-icon{width:42px;height:42px}}
    `;
    document.head.appendChild(style);
  }
  function renderModal(){
    ensureWalletStyles();
    const wm=manager(),modal=document.getElementById("walletModal"),list=document.getElementById("walletList");
    if(!wm||!modal||!list)return;
    list.innerHTML="";
    wm.listWallets().forEach(row=>{
      const b=document.createElement("button");b.type="button";b.disabled=false;b.className="wallet-option"+(row.detected?"":" unavailable");b.style.cssText="touch-action:manipulation;pointer-events:auto;position:relative;z-index:2;";
      b.innerHTML=`<span class="wallet-icon" style="pointer-events:none">${row.icon?`<img src="${wm.esc(row.icon)}" alt="">`:"◈"}</span><span style="pointer-events:none"><strong>${wm.esc(row.name)}</strong><small>${row.detected?"Detected on this device":"Open wallet app / browser"}</small></span><span class="wallet-arrow" style="pointer-events:none">›</span>`;
      activate(b,async()=>{const notice=document.getElementById("walletNotice");if(row.provider){closeModal();await connect(row.provider,row.name)}else wm.launch(row.name,notice)});
      list.appendChild(b);
    });
    modal.hidden=false;modal.style.setProperty("display","grid","important");
  }
  async function connect(provider,walletName){
    const wm=manager(),button=document.getElementById("connectSellerWallet"),notice=document.getElementById("walletNotice");
    if(!wm){if(notice)notice.textContent="Wallet manager unavailable. Please refresh the page.";return}
    try{
      if(button){button.disabled=true;button.textContent="Connecting…"}
      const result=await wm.connectAndVerify(provider,walletName,{role:"seller",purpose:"seller_wallet_ownership",setNotice:v=>{if(notice)notice.textContent=v}});
      const addressEl=document.getElementById("sellerWalletAddress"),statusEl=document.getElementById("sellerWalletStatus");
      closeModal();
      if(addressEl)addressEl.textContent=wm.short(result.address);
      if(statusEl)statusEl.textContent="Connected & verified ✓";
      if(notice)notice.textContent="Wallet verified and saved to your seller profile.";
      if(button){button.textContent="Wallet Connected ✓";button.disabled=false;button.classList.add("connected")}
      history.replaceState({},"",location.pathname);
      window.dispatchEvent(new CustomEvent("web3market:seller-wallet-connected",{detail:{address:result.address,walletName}}));
    }catch(err){
      console.warn("Web3Market seller wallet connection failed",err);
      if(notice)notice.textContent=err?.message||"Wallet connection failed.";
      if(button){button.disabled=false;button.textContent="Connect Wallet"}
    }
  }
  async function autoConnect(){
    const target=wanted(),wm=manager();
    if(!target||!wm)return;
    const notice=document.getElementById("walletNotice"),modal=document.getElementById("walletModal");
    if(modal){modal.hidden=false;modal.style.setProperty("display","grid","important")}
    if(notice)notice.textContent="Returning to "+target+"… detecting the wallet and preparing your free ownership signature.";
    try{await wm.refreshWalletProviders?.()}catch(e){}
    for(let i=0;i<40;i++){
      const provider=wm.getDetected(target);
      if(provider){
        if(notice)notice.textContent=target+" detected. Requesting wallet connection now; approve the connection and free ownership signature in your wallet.";
        await connect(provider,target);
        return;
      }
      await sleep(250)
    }
    if(notice)notice.textContent=target+" opened, but its provider was not detected. Open this page inside the wallet browser, then tap Connect Wallet.";
    renderModal();
  }
  async function loadWalletState(){
    try{
      const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
      if(!sb?.auth)return;
      const {data:{user}}=await sb.auth.getUser();
      if(!user)return;
      const {data:profile}=await sb.from("profiles").select("wallet_address,wallet_verified,role").eq("id",user.id).maybeSingle();
      const actions=document.querySelector(".wallet-actions"), button=document.getElementById("connectSellerWallet"), addressEl=document.getElementById("sellerWalletAddress"), statusEl=document.getElementById("sellerWalletStatus");
      if(!actions||!button||!profile)return;
      // Wallet action must always remain user-clickable; only the connection flow may temporarily disable it.
      button.disabled=false;
      button.removeAttribute("disabled");
      button.style.pointerEvents="auto";
      button.style.cursor="pointer";
      let disconnect=document.getElementById("disconnectSellerWallet");
      if(profile.wallet_verified && profile.wallet_address){
        if(addressEl)addressEl.textContent=wmShort(profile.wallet_address);
        if(statusEl)statusEl.textContent="Connected & verified ✓";
        button.textContent="Connect Wallet";
        button.classList.add("connected");
        if(!disconnect){
          disconnect=document.createElement("button"); disconnect.id="disconnectSellerWallet"; disconnect.type="button"; disconnect.className="wallet-btn"; disconnect.style.background="#7f1d1d"; disconnect.textContent="Disconnect";
          actions.insertBefore(disconnect,actions.querySelector("#walletNotice"));
          disconnect.addEventListener("click",disconnectWallet);
        }
      }else{
        if(addressEl)addressEl.textContent="Not connected";
        if(statusEl)statusEl.textContent="Wallet ownership not verified";
        button.textContent="Connect Wallet"; button.classList.remove("connected");
        button.disabled=false; button.removeAttribute("disabled"); button.style.pointerEvents="auto"; button.style.cursor="pointer";
        if(disconnect)disconnect.remove();
      }
    }catch(e){console.warn("Wallet state load failed",e)}
  }
  function wmShort(a){const wm=manager();return wm&&wm.short?wm.short(a):(a?a.slice(0,6)+"…"+a.slice(-4):"Not connected")}
  async function disconnectWallet(){
    const wm=manager(), notice=document.getElementById("walletNotice"), button=document.getElementById("disconnectSellerWallet");
    try{
      if(button)button.disabled=true;
      if(notice)notice.textContent="Disconnecting wallet…";
      const sb=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
      const {data:{session}}=await sb.auth.getSession();
      if(!session?.access_token)throw new Error("Your Web3Market login session is unavailable. Please sign in again.");
      const r=await fetch("https://hzhqlexnhtukfljcvnyd.supabase.co/functions/v1/verify-wallet",{
        method:"POST",
        headers:{apikey:"sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI",Authorization:"Bearer "+session.access_token,"Content-Type":"application/json"},
        body:JSON.stringify({action:"disconnect"})
      });
      const data=await r.json().catch(()=>null);
      if(!r.ok||!data?.disconnected)throw new Error(data?.error||"Wallet disconnect failed.");
      if(notice)notice.textContent="Wallet disconnected from your seller profile.";
      await loadWalletState();
    }catch(e){
      if(button)button.disabled=false;
      if(notice)notice.textContent=e?.message||"Wallet disconnect failed.";
    }
  }
  function bind(){
    const b=document.getElementById("connectSellerWallet");
    if(b&&!b.dataset.bound){b.dataset.bound="1";b.disabled=false;b.removeAttribute("disabled");b.style.pointerEvents="auto";b.style.cursor="pointer";b.onclick=e=>{if(e){e.preventDefault();e.stopPropagation()}renderModal();return false}}
    const c=document.getElementById("walletModalClose");
    if(c&&!c.dataset.bound){c.dataset.bound="1";activate(c,closeModal)}
    const m=document.getElementById("walletModal");
    if(m&&!m.dataset.bound){m.dataset.bound="1";m.addEventListener("click",e=>{if(e.target===m)closeModal()});m.addEventListener("touchstart",e=>{if(e.target===m)closeModal()},{passive:true})}
  }
  async function boot(){
    bind();
    const wm=await ensureManager();
    if(!wm){const n=document.getElementById("walletNotice");if(n)n.textContent="Wallet connection engine could not load. Please refresh the page."; const b=document.getElementById("connectSellerWallet"); if(b){b.disabled=false;b.removeAttribute("disabled");b.style.pointerEvents="auto";b.style.cursor="pointer";} return}
    bind();
    await wm.refreshWalletProviders?.();
    autoConnect();
    // Auto-connect only when returning from a wallet app with wm_wallet in the URL.
    loadWalletState();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();
