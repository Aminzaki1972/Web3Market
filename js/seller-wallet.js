"use strict";
(function(){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  function manager(){return window.Web3MarketWalletManager||null}
  async function ensureManager(){
    let wm=manager();
    if(wm)return wm;
    const notice=document.getElementById("walletNotice");
    if(notice)notice.textContent="Loading wallet connection…";
    try{
      const s=document.createElement("script");
      s.src="js/wallet-manager.js?v=20260918-walletfix11";
      s.async=false;
      document.head.appendChild(s);
    }catch(e){console.warn("Web3Market wallet manager reload failed",e)}
    for(let i=0;i<60;i++){
      wm=manager();
      if(wm)return wm;
      await sleep(100);
    }
    return null;
  }
  const wanted=()=>new URLSearchParams(location.search).get("wm_wallet");
  function closeModal(){const m=document.getElementById("walletModal");if(m){m.hidden=true;m.style.display="none"}}
  function renderModal(){
    const wm=manager(),modal=document.getElementById("walletModal"),list=document.getElementById("walletList");
    if(!wm||!modal||!list)return;
    list.innerHTML="";
    wm.listWallets().forEach(row=>{
      const b=document.createElement("button");b.type="button";b.className="wallet-option"+(row.detected?"":" unavailable");b.style.touchAction="manipulation";
      b.innerHTML=`<span class="wallet-icon">${row.icon?`<img src="${wm.esc(row.icon)}" alt="">`:"◈"}</span><span><strong>${wm.esc(row.name)}</strong><small>${row.detected?"Detected on this device":"Open wallet app / browser"}</small></span><span class="wallet-arrow">›</span>`;
      b.addEventListener("click",async e=>{e.preventDefault();e.stopPropagation();const notice=document.getElementById("walletNotice");if(row.provider){closeModal();await connect(row.provider,row.name)}else wm.launch(row.name,notice)});
      list.appendChild(b);
    });
    modal.hidden=false;
  }
  async function connect(provider,walletName){
    const wm=manager(),button=document.getElementById("connectSellerWallet"),notice=document.getElementById("walletNotice");
    if(!wm){if(notice)notice.textContent="Wallet manager unavailable. Please refresh the page.";return}
    try{
      if(button){button.disabled=true;button.textContent="Connecting…"}
      const result=await wm.connectAndVerify(provider,walletName,{role:"seller",purpose:"seller_wallet_ownership",setNotice:v=>{if(notice)notice.textContent=v}});
      const addressEl=document.getElementById("sellerWalletAddress"),statusEl=document.getElementById("sellerWalletStatus");
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
    for(let i=0;i<40;i++){
      const provider=wm.getDetected(target);
      if(provider){await connect(provider,target);return}
      await sleep(250)
    }
    if(notice)notice.textContent=`${target} opened, but its wallet provider was not exposed to this page. Tap Connect Wallet inside the wallet browser.`;
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
    if(b&&!b.dataset.bound){b.dataset.bound="1";b.addEventListener("click",e=>{e.preventDefault();renderModal()})}
    const c=document.getElementById("walletModalClose");
    if(c&&!c.dataset.bound){c.dataset.bound="1";c.addEventListener("click",closeModal)}
    const m=document.getElementById("walletModal");
    if(m&&!m.dataset.bound){m.dataset.bound="1";m.addEventListener("click",e=>{if(e.target===m)closeModal()})}
  }
  async function boot(){
    const wm=await ensureManager();
    if(!wm){const n=document.getElementById("walletNotice");if(n)n.textContent="Wallet connection engine failed to load. Please open this page inside your wallet browser.";return}
    bind();
    // Do not open the wallet modal automatically on dashboard load.\n    // The user must explicitly press Connect Wallet.\n    loadWalletState();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();
