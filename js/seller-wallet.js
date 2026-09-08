"use strict";
(function(){
  const BSC="0x38";
  const SUPABASE_FUNCTION="https://hzhqlexnhtukfljcvnyd.supabase.co/functions/v1/verify-wallet";
  const discovered=[];
  const seen=new Set();
  const short=a=>a.slice(0,8)+"…"+a.slice(-6);
  const getSb=()=>window.Web3MarketSupabase?.getClient?.()||window.Web3MarketSupabase?.client||window.supabaseClient||window.web3marketSupabase;
  const esc=v=>String(v??"").replace(/[&<>\"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));

  function addProvider(provider,info){
    if(!provider||typeof provider.request!=="function"||seen.has(provider))return;
    seen.add(provider);
    discovered.push({provider,info:info||{name:"Web3 Wallet",icon:""}});
  }

  function detectInjected(){
    const eth=window.ethereum;
    if(eth?.providers?.length) eth.providers.forEach(p=>addProvider(p,p.info||{}));
    else if(eth) addProvider(eth,eth.info||{});
  }

  function nameOf(info,provider){
    const n=String(info?.name||info?.rdns||"").toLowerCase();
    if(n.includes("metamask"))return "MetaMask";
    if(n.includes("trust"))return "Trust Wallet";
    if(n.includes("coinbase"))return "Coinbase Wallet";
    if(n.includes("okx"))return "OKX Wallet";
    if(n.includes("binance"))return "Binance Wallet";
    if(n.includes("rabby"))return "Rabby Wallet";
    if(n.includes("phantom"))return "Phantom";
    if(n.includes("zerion"))return "Zerion";
    return info?.name||provider?.name||"Web3 Wallet";
  }

  function iconOf(info){return info?.icon||""}

  function openModal(){
    detectInjected();
    const modal=document.getElementById("walletModal");
    const list=document.getElementById("walletList");
    if(!modal||!list)return;
    list.innerHTML="";
    const preferred=["MetaMask","Trust Wallet","Coinbase Wallet","OKX Wallet","Binance Wallet","Rabby Wallet","Phantom","Zerion"];
    const rows=[];
    const used=new Set();
    discovered.forEach(x=>{
      const n=nameOf(x.info,x.provider); if(!used.has(n)){used.add(n);rows.push({name:n,provider:x.provider,icon:iconOf(x.info),detected:true});}
    });
    preferred.forEach(n=>{if(!used.has(n)){used.add(n);rows.push({name:n,provider:null,icon:"",detected:false});}});
    rows.forEach(row=>{
      const b=document.createElement("button");
      b.type="button"; b.className="wallet-option"+(row.detected?"":" unavailable");
      b.innerHTML=`<span class="wallet-icon">${row.icon?`<img src="${esc(row.icon)}" alt="">`:"◈"}</span><span><strong>${esc(row.name)}</strong><small>${row.detected?"Detected on this device":"Open wallet app / browser"}</small></span><span class="wallet-arrow">›</span>`;
      b.addEventListener("click",()=>row.provider?connect(row.provider,row.name):openWalletApp(row.name));
      list.appendChild(b);
    });
    modal.hidden=false;
  }

  function closeModal(){const m=document.getElementById("walletModal");if(m)m.hidden=true}

  function openWalletApp(name){
    const page=encodeURIComponent(location.href.split("#")[0]);
    const links={
      "MetaMask":`https://metamask.app.link/dapp/${location.host}${location.pathname}`,
      "Trust Wallet":`https://link.trustwallet.com/open_url?url=${page}`,
      "OKX Wallet":`okx://wallet/dapp/url?dappUrl=${page}`,
      "Binance Wallet":`https://www.binance.com/en/web3wallet?url=${page}`,
      "Coinbase Wallet":`https://go.cb-w.com/dapp?cb_url=${page}`,
      "Rabby Wallet":`https://rabby.io/`,
      "Phantom":`https://phantom.app/` ,
      "Zerion":`https://zerion.io/`
    };
    const url=links[name];
    if(url){
      window.location.href=url;
      setTimeout(()=>{const note=document.getElementById("walletNotice");if(note)note.textContent="If the wallet did not open, open its app and use its built-in browser, then return to Web3Market.";},1200);
    }
  }

  async function connect(provider,walletName){
    const button=document.getElementById("connectSellerWallet");
    const notice=document.getElementById("walletNotice");
    try{
      closeModal();
      if(button){button.disabled=true;button.textContent="Connecting…"}
      if(notice)notice.textContent=`Connecting ${walletName}…`;
      const accounts=await provider.request({method:"eth_requestAccounts"});
      const address=accounts?.[0]; if(!address)throw new Error("No wallet account was returned.");
      let chain=await provider.request({method:"eth_chainId"});
      if(chain!==BSC){
        try{await provider.request({method:"wallet_switchEthereumChain",params:[{chainId:BSC}]})}
        catch(err){
          if(err?.code===4902) await provider.request({method:"wallet_addEthereumChain",params:[{chainId:BSC,chainName:"BNB Smart Chain",nativeCurrency:{name:"BNB",symbol:"BNB",decimals:18},rpcUrls:["https://bsc-dataseed.binance.org/"],blockExplorerUrls:["https://bscscan.com/"]}]});
          else throw err;
        }
        chain=await provider.request({method:"eth_chainId"});
      }
      if(chain!==BSC)throw new Error("Please switch the wallet to BNB Smart Chain.");
      const sb=getSb(); if(!sb?.auth)throw new Error("Web3Market authentication is unavailable.");
      const {data:{session}}=await sb.auth.getSession(); if(!session?.access_token)throw new Error("Please sign in again.");
      const message=`Web3Market Seller Wallet Verification\n\nI am connecting this wallet to my Web3Market seller account.\n\nWallet: ${address}\nChain: BNB Smart Chain\nTimestamp: ${new Date().toISOString()}\n\nThis signature does not authorize any transaction or transfer of funds.`;
      if(notice)notice.textContent="Confirm the verification signature in your wallet…";
      const signature=await provider.request({method:"personal_sign",params:[message,address]});
      if(!signature)throw new Error("Signature was cancelled.");
      if(notice)notice.textContent="Verifying and saving your wallet…";
      const r=await fetch(SUPABASE_FUNCTION,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+session.access_token},body:JSON.stringify({address,message,signature})});
      const body=await r.json().catch(()=>({}));
      if(!r.ok||!body.ok)throw new Error(body.error||"Wallet verification failed.");
      const addressEl=document.getElementById("sellerWalletAddress");
      const statusEl=document.getElementById("sellerWalletStatus");
      if(addressEl)addressEl.textContent=short(address);
      if(statusEl)statusEl.textContent="Connected & verified ✓";
      if(notice)notice.textContent="Wallet verified and saved to your seller profile.";
      if(button){button.textContent="Wallet Connected ✓";button.disabled=false;button.classList.add("connected")}
      window.dispatchEvent(new CustomEvent("web3market:seller-wallet-connected",{detail:{address,walletName}}));
    }catch(err){
      console.warn("Web3Market seller wallet connection failed",err);
      if(notice)notice.textContent=err?.message||"Wallet connection failed.";
      if(button){button.disabled=false;button.textContent="Connect Wallet"}
    }
  }

  function bind(){
    const button=document.getElementById("connectSellerWallet");
    if(button&&!button.dataset.bound){button.dataset.bound="1";button.addEventListener("click",openModal)}
    const close=document.getElementById("walletModalClose"); if(close&&!close.dataset.bound){close.dataset.bound="1";close.addEventListener("click",closeModal)}
    const modal=document.getElementById("walletModal"); if(modal&&!modal.dataset.bound){modal.dataset.bound="1";modal.addEventListener("click",e=>{if(e.target===modal)closeModal()})}
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bind,{once:true});else bind();
})();
