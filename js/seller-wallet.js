"use strict";
(function(){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  function loadManager(){
    if(window.Web3MarketWalletManager)return Promise.resolve();
    return new Promise(resolve=>{
      const id="wm-wallet-manager-loader";
      let s=document.getElementById(id);
      if(!s){s=document.createElement("script");s.id=id;s.src="js/wallet-manager.js?v=20260918-walletmanager1";s.async=false;s.onload=()=>resolve();s.onerror=()=>resolve();document.head.appendChild(s)}else s.addEventListener("load",resolve,{once:true});
      setTimeout(resolve,2500);
    });
  }
  const manager=()=>window.Web3MarketWalletManager||null;
  const wanted=()=>new URLSearchParams(location.search).get("wm_wallet");
  function closeModal(){const m=document.getElementById("walletModal");if(m)m.hidden=true}
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
      if(addressEl)addressEl.textContent=wm.short(result.address);if(statusEl)statusEl.textContent="Connected & verified ✓";
      if(notice)notice.textContent="Wallet verified and saved to your seller profile.";
      if(button){button.textContent="Wallet Connected ✓";button.disabled=false;button.classList.add("connected")}
      history.replaceState({},"",location.pathname);window.dispatchEvent(new CustomEvent("web3market:seller-wallet-connected",{detail:{address:result.address,walletName}}));
    }catch(err){console.warn("Web3Market seller wallet connection failed",err);if(notice)notice.textContent=err?.message||"Wallet connection failed.";if(button){button.disabled=false;button.textContent="Connect Wallet"}}
  }
  async function autoConnect(){
    const target=wanted(),wm=manager();if(!target||!wm)return;const notice=document.getElementById("walletNotice"),modal=document.getElementById("walletModal");if(modal)modal.hidden=false;
    for(let i=0;i<40;i++){const provider=wm.getDetected(target);if(provider){await connect(provider,target);return}await sleep(250)}
    if(notice)notice.textContent=`${target} opened, but its wallet provider was not exposed to this page. Tap Connect Wallet inside the wallet browser.`;
  }
  function bind(){
    const b=document.getElementById("connectSellerWallet");if(b&&!b.dataset.bound){b.dataset.bound="1";b.addEventListener("click",e=>{e.preventDefault();renderModal()})}
    const c=document.getElementById("walletModalClose");if(c&&!c.dataset.bound){c.dataset.bound="1";c.addEventListener("click",closeModal)}
    const m=document.getElementById("walletModal");if(m&&!m.dataset.bound){m.dataset.bound="1";m.addEventListener("click",e=>{if(e.target===m)closeModal()})}
  }
  async function boot(){await loadManager();if(!manager()){const n=document.getElementById("walletNotice");if(n)n.textContent="Wallet connection is unavailable. Please refresh the page.";return}bind();autoConnect()}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();
