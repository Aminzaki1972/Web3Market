"use strict";
(function(){
  const BSC="0x38";
  const SUPABASE_URL="https://hzhqlexnhtukfljcvnyd.supabase.co";
  const SUPABASE_KEY="sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI";
  const VERIFY_FN=SUPABASE_URL+"/functions/v1/verify-wallet";
  const STORAGE_KEY="web3market-auth";
  const providers=[]; const seen=new Set();
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const short=a=>String(a).slice(0,8)+"…"+String(a).slice(-6);
  function getClient(){
    try{
      const existing=window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
      if(existing?.auth)return existing;
      if(window.supabase?.createClient){
        const c=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:STORAGE_KEY}});
        window.supabaseClient=c; window.web3marketSupabase=c;
        window.Web3MarketSupabase=window.Web3MarketSupabase||{};
        window.Web3MarketSupabase.client=c; window.Web3MarketSupabase.supabase=c; window.Web3MarketSupabase.getClient=()=>c;
        return c;
      }
    }catch(e){console.warn("Web3Market wallet client init:",e)} return null;
  }
  async function waitForClient(){for(let i=0;i<50;i++){const c=getClient();if(c?.auth)return c;await sleep(100)}return null}
  async function restoreSession(c){
    try{
      let s=(await c.auth.getSession())?.data?.session;if(s?.access_token)return s;
      const raw=localStorage.getItem(STORAGE_KEY);if(!raw)return null;
      const saved=JSON.parse(raw);if(!saved?.access_token||!saved?.refresh_token)return null;
      s=(await c.auth.setSession({access_token:saved.access_token,refresh_token:saved.refresh_token}))?.data?.session;
      return s?.access_token?s:null;
    }catch(e){console.warn("Web3Market wallet session restore:",e);return null}
  }
  function addProvider(p,info){if(p&&typeof p.request==="function"&&!seen.has(p)){seen.add(p);providers.push({p,info:info||{}})}}
  function providerName(x){const s=String(x.info?.name||x.info?.rdns||x.p?.name||"").toLowerCase();if(s.includes("metamask"))return"MetaMask";if(s.includes("trust"))return"Trust Wallet";if(s.includes("coinbase"))return"Coinbase Wallet";if(s.includes("okx"))return"OKX Wallet";if(s.includes("binance"))return"Binance Wallet";if(s.includes("safepal"))return"SafePal";if(s.includes("rabby"))return"Rabby Wallet";if(s.includes("phantom"))return"Phantom";if(s.includes("zerion"))return"Zerion";return x.info?.name||x.p?.name||"Web3 Wallet"}
  function discover(){try{if(window.safepalProvider)addProvider(window.safepalProvider,{name:"SafePal",rdns:"com.safepal.wallet"});if(window.okxwallet)addProvider(window.okxwallet,{name:"OKX Wallet",rdns:"com.okex.wallet"});const tw=window.trustwallet?.ethereum||window.trustwallet;if(tw?.request)addProvider(tw,{name:"Trust Wallet",rdns:"com.trustwallet.app"});window.dispatchEvent(new Event("eip6963:requestProvider"));if(window.ethereum?.providers?.length)window.ethereum.providers.forEach(p=>addProvider(p,p.info||{}));else if(window.ethereum)addProvider(window.ethereum,window.ethereum.info||{})}catch(e){console.warn("Wallet discovery:",e)}}
  window.addEventListener("eip6963:announceProvider",e=>{const d=e.detail||{};addProvider(d.provider,d.info||{})});
  window.addEventListener("eip6969:announceProvider",e=>{const d=e.detail||{};addProvider(d.provider,d.info||{})});
  window.addEventListener("trustwallet#initialized",discover);
  function deepLink(name){
    const target=location.origin+location.pathname+"?wm_wallet="+encodeURIComponent(name),u=encodeURIComponent(target);
    if(name==="MetaMask")return"https://metamask.app.link/dapp/"+location.host+location.pathname+"?wm_wallet="+encodeURIComponent(name);
    if(name==="Trust Wallet")return"https://link.trustwallet.com/open_url?coin_id=60&url="+u;
    if(name==="Coinbase Wallet")return"https://go.cb-w.com/dapp?cb_url="+u;
    if(name==="OKX Wallet")return"https://www.okx.com/download?deeplink=okx%3A%2F%2Fwallet%2Fdapp%2Furl%3FdappUrl%3D"+u;
    if(name==="Binance Wallet")return"https://www.binance.com/en/web3wallet?url="+u;
    if(name==="SafePal")return"https://link.safepal.io/wallet/openurl?url="+u;
    return null;
  }
  function launch(name,m){const url=deepLink(name),notice=m.querySelector("#buyerWalletNotice");if(!url){notice.textContent=name+": open the wallet app and use its built-in browser to return to Web3Market.";return}notice.textContent="Opening "+name+"…";if(window.Web3MarketWalletCompat?.open){window.Web3MarketWalletCompat.open(url);return}location.href=url}
  function ensureModal(){let m=document.getElementById("buyerWalletModal");if(m)return m;m=document.createElement("div");m.id="buyerWalletModal";m.hidden=true;m.style.cssText="position:fixed;inset:0;z-index:99999;background:rgba(3,5,15,.78);backdrop-filter:blur(7px);display:grid;place-items:center;padding:18px";m.innerHTML='<div style="width:min(430px,100%);max-height:85vh;overflow:auto;background:#15132a;border:1px solid #443270;border-radius:18px;padding:18px;color:#fff"><div style="display:flex;justify-content:space-between;align-items:center"><div><strong style="font-size:17px">Connect Web3 Wallet</strong><div style="font-size:10px;color:#aaa3c3;margin-top:4px">Choose your wallet to connect and verify ownership</div></div><button id="buyerWalletClose" type="button" style="border:0;background:transparent;color:#aaa3c3;font-size:24px">×</button></div><div id="buyerWalletList"></div><div id="buyerWalletNotice" style="font-size:10px;color:#a9a2bd;margin-top:10px;line-height:1.5"></div></div>';document.body.appendChild(m);m.addEventListener("click",e=>{if(e.target===m)m.hidden=true});m.querySelector("#buyerWalletClose").onclick=()=>m.hidden=true;return m}
  async function connect(entry,name,m){
    const notice=m.querySelector("#buyerWalletNotice"),card=document.querySelector(".wallet-card"),button=card?.querySelector(".btn.full");
    try{
      if(button){button.disabled=true;button.textContent="Connecting…"} notice.textContent="Connecting "+name+"…";
      const p=entry.p,accounts=await p.request({method:"eth_requestAccounts"}),address=accounts?.[0];if(!address)throw Error("No wallet account was selected.");
      let chain=await p.request({method:"eth_chainId"});
      if(String(chain).toLowerCase()!==BSC){try{await p.request({method:"wallet_switchEthereumChain",params:[{chainId:BSC}]})}catch(e){if(e?.code===4902)await p.request({method:"wallet_addEthereumChain",params:[{chainId:BSC,chainName:"BNB Smart Chain",nativeCurrency:{name:"BNB",symbol:"BNB",decimals:18},rpcUrls:["https://bsc-dataseed.binance.org/"],blockExplorerUrls:["https://bscscan.com/"]}]});else throw e}chain=await p.request({method:"eth_chainId"})}
      if(String(chain).toLowerCase()!==BSC)throw Error("Please switch the wallet to BNB Smart Chain.");
      const c=await waitForClient();if(!c?.auth)throw Error("Web3Market connection could not be initialized. Please refresh the page.");
      const session=await restoreSession(c);if(!session?.access_token)throw Error("Your Web3Market session is unavailable. Please sign in again.");
      const message="Web3Market Buyer Wallet Verification\n\nI am connecting this wallet to my Web3Market buyer account.\n\nWallet: "+address+"\nChain: BNB Smart Chain\nTimestamp: "+new Date().toISOString()+"\n\nThis signature does not authorize any transaction or transfer of funds.";
      notice.textContent="Confirm the ownership signature in your wallet…";
      const signature=await p.request({method:"personal_sign",params:[message,address]});if(!signature)throw Error("Wallet signature was cancelled.");
      const response=await fetch(VERIFY_FN,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+session.access_token},body:JSON.stringify({address,message,signature})});
      const result=await response.json().catch(()=>({}));if(!response.ok||result.ok!==true||result.verified!==true)throw Error(result.error||"Wallet verification failed.");
      history.replaceState({},"",location.pathname);m.hidden=true;if(card){card.querySelector(".wallet-address").textContent=short(result.address||address);card.querySelector(".wallet-text").textContent="Connected and ownership verified."}if(button){button.textContent="Wallet Connected ✓";button.disabled=false}
    }catch(e){console.error("Web3Market wallet connect:",e);notice.textContent=e?.message||"Wallet connection failed.";if(button){button.disabled=false;button.textContent="Connect Wallet"}}
  }
  function open(){discover();const m=ensureModal(),list=m.querySelector("#buyerWalletList");list.innerHTML="";const rows=[],used=new Set();providers.forEach(x=>{const n=providerName(x);if(!used.has(n)){used.add(n);rows.push({n,x})}});["MetaMask","Trust Wallet","SafePal","Coinbase Wallet","OKX Wallet","Binance Wallet","Rabby Wallet","Phantom","Zerion"].forEach(n=>{if(!used.has(n)){used.add(n);rows.push({n,x:null})}});rows.forEach(r=>{const b=document.createElement("button");b.type="button";b.style.cssText="width:100%;display:flex;align-items:center;gap:12px;margin:8px 0;padding:13px;border:1px solid #3a3158;border-radius:12px;background:#18152b;color:#fff;cursor:pointer;text-align:left;touch-action:manipulation";b.innerHTML='<span style="font-size:20px">◈</span><span style="flex:1"><strong style="display:block;font-size:12px">'+r.n+'</strong><small style="display:block;color:#89829f;margin-top:3px">'+(r.x?"Detected on this device":"Open wallet app / browser")+'</small></span><span style="color:#7c3aed">›</span>';b.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();r.x?connect(r.x,r.n,m):launch(r.n,m)},{once:true});list.appendChild(b)});m.hidden=false}
  async function refresh(){try{const c=await waitForClient();if(!c?.auth)return;const user=(await c.auth.getUser())?.data?.user;if(!user)return;const p=(await c.from("profiles").select("wallet_address,wallet_verified").eq("id",user.id).maybeSingle())?.data;const card=document.querySelector(".wallet-card");if(!card)return;const addr=p?.wallet_address||"",verified=p?.wallet_verified===true,a=card.querySelector(".wallet-address"),t=card.querySelector(".wallet-text"),b=card.querySelector(".btn.full");if(a)a.textContent=addr?short(addr):"Not connected";if(t)t.textContent=verified?"Connected and ownership verified.":addr?"Wallet connected, but ownership is not verified. Verify the wallet to continue.":"Connect and verify a Web3 wallet for buyer activity.";if(b)b.textContent=verified?"Manage Wallet":addr?"Verify Wallet":"Connect Wallet"}catch(e){console.warn("Web3Market wallet state:",e)}}
  function bind(){document.querySelectorAll(".wallet-card .btn.full").forEach(b=>{if(b.dataset.walletModalBound)return;b.dataset.walletModalBound="1";b.href="#";b.addEventListener("click",e=>{e.preventDefault();open()})});refresh()}
  getClient();discover();if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bind,{once:true});else bind();new MutationObserver(bind).observe(document.documentElement,{childList:true,subtree:true});
})();
