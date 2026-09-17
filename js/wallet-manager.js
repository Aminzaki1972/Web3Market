"use strict";
(function(){
  const BSC="0x38",BSC_DECIMAL=56;
  const SUPABASE_URL="https://hzhqlexnhtukfljcvnyd.supabase.co";
  const SUPABASE_KEY="sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI";
  const VERIFY_FN=SUPABASE_URL+"/functions/v1/verify-wallet",STORAGE_KEY="web3market-auth";
  const providers=[],seen=new Set(),sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const short=a=>String(a).slice(0,8)+"…"+String(a).slice(-6);
  const esc=v=>String(v??"").replace(/[&<>\"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
  function getClient(){try{const c=window.Web3MarketSupabase?.getClient?.()||window.Web3MarketSupabase?.client||window.supabaseClient||window.web3marketSupabase;return c?.auth?c:null}catch(e){return null}}
  async function waitForClient(){for(let i=0;i<80;i++){let c=getClient();if(c)return c;if(window.supabase?.createClient){try{c=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:STORAGE_KEY}});if(c){window.Web3MarketSupabase={client:c,supabase:c,getClient:()=>c};window.supabaseClient=c;window.web3marketSupabase=c;return c}}catch(e){}}await sleep(100)}return null}
  async function restoreSession(c){try{let s=(await c.auth.getSession())?.data?.session;if(s?.access_token)return s;if(typeof window.Web3MarketSupabaseRestoreSession==="function"){s=await window.Web3MarketSupabaseRestoreSession();if(s?.access_token)return s}const raw=localStorage.getItem(STORAGE_KEY);if(!raw)return null;const saved=JSON.parse(raw);if(!saved?.access_token||!saved?.refresh_token)return null;s=(await c.auth.setSession({access_token:saved.access_token,refresh_token:saved.refresh_token}))?.data?.session;return s?.access_token?s:null}catch(e){return null}}
  function addProvider(provider,info){if(!provider||typeof provider.request!=="function"||seen.has(provider))return;seen.add(provider);providers.push({provider,info:info||{}})}
  function discover(){try{if(window.safepalProvider)addProvider(window.safepalProvider,{name:"SafePal",rdns:"com.safepal.wallet"});if(window.okxwallet)addProvider(window.okxwallet,{name:"OKX Wallet",rdns:"com.okex.wallet"});const tw=window.trustwallet?.ethereum||window.trustwallet;if(tw?.request)addProvider(tw,{name:"Trust Wallet",rdns:"com.trustwallet.app"});const eth=window.ethereum;if(eth?.providers?.length)eth.providers.forEach(p=>addProvider(p,p.info||{}));else if(eth)addProvider(eth,eth.info||{});window.dispatchEvent(new Event("eip6963:requestProvider"))}catch(e){}}
  window.addEventListener("eip6963:announceProvider",e=>{const d=e.detail||{};addProvider(d.provider,d.info||{})});window.addEventListener("trustwallet#initialized",discover);
  function providerName(x){const s=String(x.info?.name||x.info?.rdns||x.provider?.name||"").toLowerCase();if(s.includes("metamask"))return"MetaMask";if(s.includes("trust"))return"Trust Wallet";if(s.includes("coinbase"))return"Coinbase Wallet";if(s.includes("okx")||s.includes("okex"))return"OKX Wallet";if(s.includes("binance"))return"Binance Wallet";if(s.includes("safepal"))return"SafePal";if(s.includes("rabby"))return"Rabby Wallet";if(s.includes("phantom"))return"Phantom";if(s.includes("zerion"))return"Zerion";return x.info?.name||x.provider?.name||"Web3 Wallet"}
  function getDetected(name){discover();return providers.find(x=>providerName(x)===name)?.provider||null}
  function pageUrl(name){return location.origin+location.pathname+"?wm_wallet="+encodeURIComponent(name)}
  function deepLink(name){const target=pageUrl(name),u=encodeURIComponent(target);if(name==="MetaMask")return"https://metamask.app.link/dapp/"+location.host+location.pathname+"?wm_wallet="+encodeURIComponent(name);if(name==="Trust Wallet")return"https://link.trustwallet.com/open_url?coin_id=60&url="+u;if(name==="Coinbase Wallet")return"https://go.cb-w.com/dapp?cb_url="+u;if(name==="SafePal")return"https://link.safepal.io/wallet/openurl?url="+u;if(name==="OKX Wallet")return"https://www.okx.com/download?deeplink=okx%3A%2F%2Fwallet%2Fdapp%2Furl%3FdappUrl%3D"+u;if(name==="Binance Wallet")return"https://www.binance.com/en/web3wallet?url="+u;return null}
  function launch(name,notice){const url=deepLink(name);if(!url){if(notice)notice.textContent="Open "+name+" and use its built-in browser to visit Web3Market.";return false}if(notice)notice.textContent="Opening "+name+"…";try{if(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent))location.assign(url);else{const w=window.open(url,"_blank","noopener,noreferrer");if(!w)location.assign(url)}return true}catch(e){try{location.assign(url);return true}catch(_){return false}}}
  async function connectAndVerify(provider,walletName,opts={}){
    if(!provider||typeof provider.request!=="function")throw new Error("Wallet provider is unavailable. Open Web3Market inside the wallet browser.");
    const purpose=String(opts.purpose||"wallet_ownership"),role=String(opts.role||"user").toLowerCase(),setNotice=typeof opts.setNotice==="function"?opts.setNotice:()=>{};
    setNotice("Connecting "+walletName+"…");
    const accounts=await provider.request({method:"eth_requestAccounts"}),address=accounts?.[0];
    if(!/^0x[0-9a-fA-F]{40}$/.test(String(address||"")))throw new Error("No valid wallet account was selected.");
    let chain=String(await provider.request({method:"eth_chainId"})).toLowerCase();
    if(chain!==BSC){try{await provider.request({method:"wallet_switchEthereumChain",params:[{chainId:BSC}]})}catch(e){if(e?.code===4902)await provider.request({method:"wallet_addEthereumChain",params:[{chainId:BSC,chainName:"BNB Smart Chain",nativeCurrency:{name:"BNB",symbol:"BNB",decimals:18},rpcUrls:["https://bsc-dataseed.binance.org/"],blockExplorerUrls:["https://bscscan.com/"]}]});else throw e}chain=String(await provider.request({method:"eth_chainId"})).toLowerCase()}
    if(chain!==BSC)throw new Error("Please switch the wallet to BNB Smart Chain.");
    const sb=await waitForClient();if(!sb?.auth)throw new Error("Web3Market connection could not be initialized. Please refresh the page.");
    let session=await restoreSession(sb);if(!session?.access_token)throw new Error("Your Web3Market session is unavailable. Please sign in again.");
    let user=(await sb.auth.getUser())?.data?.user;if(!user?.id)throw new Error("Your Web3Market session is invalid. Please sign in again.");
    const timestamp=new Date().toISOString(),host=location.host;
    const message=["Web3Market Wallet Ownership Verification","","I am connecting this wallet to my authenticated Web3Market account.","","Domain: "+host,"Account: "+user.id,"Role: "+role,"Purpose: "+purpose,"Wallet: "+address,"Chain ID: "+BSC_DECIMAL+" (BNB Smart Chain)","Timestamp: "+timestamp,"","This signature does not authorize any transaction or transfer of funds.","This signature is proof of wallet ownership only.","It does not authorize a transaction, token approval, or transfer of funds."].join("\n");
    setNotice("Confirm the ownership signature in your wallet…");
    const signature=await provider.request({method:"personal_sign",params:[message,address]});if(!signature)throw new Error("Wallet signature was cancelled.");
    setNotice("Signature received. Verifying wallet ownership and saving it…");
    const send=async token=>fetch(VERIFY_FN,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},body:JSON.stringify({address,message,signature,chain_id:BSC_DECIMAL,purpose,role})});
    let response=await send(session.access_token);let result=await response.json().catch(()=>({}));
    if((response.status===401||response.status===403)&&session.refresh_token){session=(await sb.auth.refreshSession())?.data?.session||session;if(session.access_token){response=await send(session.access_token);result=await response.json().catch(()=>({}))}}
    if(!response.ok||result.ok!==true||result.verified!==true)throw new Error(result.error||`Wallet verification failed (${response.status}).`);
    setNotice("Wallet ownership verified and saved ✓");
    return {address:String(result.address||address),walletName,role,chainId:BSC_DECIMAL,signature,result};
  }
  function listWallets(){discover();const preferred=["MetaMask","Trust Wallet","SafePal","Coinbase Wallet","OKX Wallet","Binance Wallet","Rabby Wallet","Phantom","Zerion"],rows=[],used=new Set();providers.forEach(x=>{const name=providerName(x);if(!used.has(name)){used.add(name);rows.push({name,provider:x.provider,detected:true,icon:x.info?.icon||""})}});preferred.forEach(name=>{if(!used.has(name)){used.add(name);rows.push({name,provider:null,detected:false,icon:""})}});return rows}
  window.Web3MarketWalletManager={BSC,discover,getDetected,listWallets,launch,deepLink,connectAndVerify,short,esc};discover();
})();
