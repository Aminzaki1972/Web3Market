"use strict";
(function(){
const SUPABASE_URL="https://hzhqlexnhtukfljcvnyd.supabase.co";
const SUPABASE_KEY="sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI";
const VERIFY_FN=SUPABASE_URL+"/functions/v1/verify-wallet";
const AUTH_USER=SUPABASE_URL+"/auth/v1/user";
const AUTH_TOKEN=SUPABASE_URL+"/auth/v1/token?grant_type=refresh_token";
const STORAGE_KEY="web3market-auth";
const CHAIN_ID="0x38";
const CHAIN_HEX="0x38";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function esc(v){return String(v??"").replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[m])}
function short(a){return a?a.slice(0,6)+"…"+a.slice(-4):""}
function saved(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||"null")}catch(e){return null}}
async function authUser(token){if(!token)return null;try{const r=await fetch(AUTH_USER,{headers:{apikey:SUPABASE_KEY,Authorization:"Bearer "+token},cache:"no-store"});if(!r.ok)return null;return await r.json()}catch(e){return null}}
async function getAuth(){
 let s=saved();let user=await authUser(s?.access_token);
 if(user?.id)return {session:s,user};
 if(!s?.refresh_token)return null;
 try{
  const r=await fetch(AUTH_TOKEN,{method:"POST",headers:{apikey:SUPABASE_KEY,"Content-Type":"application/json"},body:JSON.stringify({refresh_token:s.refresh_token})});
  if(!r.ok)return null;
  const next=await r.json();
  if(!next?.access_token)return null;
  const merged={...s,...next,refresh_token:next.refresh_token||s.refresh_token};
  localStorage.setItem(STORAGE_KEY,JSON.stringify(merged));
  user=await authUser(merged.access_token);
  return user?.id?{session:merged,user}:null;
 }catch(e){return null}
}
function providers(){return [window.ethereum,...(window.ethereum?.providers||[])].filter(Boolean)}
function findByName(name){const n=String(name||"").toLowerCase();return providers().find(p=>String(p?.info?.name||p?.name||"").toLowerCase().includes(n.split(" ")[0]))||null}
function detect(){
 const p=providers();
 return {metamask:p.find(x=>x.isMetaMask&&!x.isBraveWallet),trust:p.find(x=>x.isTrust),coinbase:p.find(x=>x.isCoinbaseWallet),okx:p.find(x=>x.isOkxWallet||x.isOKExWallet),safepal:p.find(x=>x.isSafePal),binance:p.find(x=>x.isBinance)}
}
function listWallets(){const d=detect();return [
 {name:"MetaMask",provider:d.metamask,icon:"https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg"},
 {name:"Trust Wallet",provider:d.trust,icon:"https://trustwallet.com/assets/images/media/assets/TWT.png"},
 {name:"OKX Wallet",provider:d.okx},
 {name:"SafePal",provider:d.safepal},
 {name:"Coinbase Wallet",provider:d.coinbase},
 {name:"Binance Wallet",provider:d.binance}
 ].map(x=>({...x,detected:!!x.provider}))}
function getDetected(name){return findByName(name)||null}
async function switchBSC(provider){try{await provider.request({method:"wallet_switchEthereumChain",params:[{chainId:CHAIN_HEX}]})}catch(e){if(e?.code!==4902)throw e;await provider.request({method:"wallet_addEthereumChain",params:[{chainId:CHAIN_HEX,chainName:"BNB Smart Chain",nativeCurrency:{name:"BNB",symbol:"BNB",decimals:18},rpcUrls:["https://bsc-dataseed.binance.org"],blockExplorerUrls:["https://bscscan.com"]}]})}}
function message({address,user,role,purpose}){return [
"Web3Market Wallet Ownership Verification","",
"I am connecting this wallet to my authenticated Web3Market account.","",
"Domain: "+location.host,"Account: "+user.id,"Role: "+role,"Purpose: "+purpose,"Wallet: "+address,"Chain ID: 56 (BNB Smart Chain)","Timestamp: "+new Date().toISOString(),"",
"This signature does not authorize any transaction or transfer of funds.","This signature is proof of wallet ownership only.","It does not authorize a transaction, token approval, or transfer of funds."
].join("\n")}
async function connectAndVerify(provider,walletName,opts={}){
 if(!provider)throw Error(walletName+" wallet provider was not detected. Open its wallet browser and try again.");
 const notice=opts.setNotice||(()=>{});
 notice("Connecting to "+walletName+"…");
 const accounts=await provider.request({method:"eth_requestAccounts"});
 const address=accounts?.[0];
 if(!/^0x[a-fA-F0-9]{40}$/.test(address||""))throw Error("Wallet address could not be read.");
 notice("Wallet connected. Preparing free ownership signature…");
 await switchBSC(provider);
 const auth=await getAuth();
 if(!auth)throw Error("Your Web3Market login session is unavailable. Please sign in again.");
 const role=opts.role||"seller",purpose=opts.purpose||"wallet_ownership";
 const msg=message({address,user:auth.user,role,purpose});
 notice("Approve the ownership signature in your wallet. No funds will move.");
 const signature=await provider.request({method:"personal_sign",params:[msg,address]});
 if(!signature)throw Error("Wallet signature was not received.");
 notice("Signature received. Verifying wallet ownership and saving it…");
 const r=await fetch(VERIFY_FN,{method:"POST",headers:{apikey:SUPABASE_KEY,Authorization:"Bearer "+auth.session.access_token,"Content-Type":"application/json"},body:JSON.stringify({address,message:msg,signature,chain_id:56,purpose,role})});
 let data=null;try{data=await r.json()}catch(e){}
 if(!r.ok||!data?.ok||!data?.verified)throw Error(data?.error||data?.message||("Wallet verification failed ("+r.status+")."));
 notice("Wallet ownership verified and saved ✓");
 return {address,user:auth.user,walletName,verified:true,data};
}
function launch(name,notice){
 const n=String(name||"").toLowerCase();const ua=navigator.userAgent.toLowerCase();const mobile=/android|iphone|ipad|ipod/i.test(ua);if(!mobile){if(notice)notice("Open "+name+" in this browser, then connect again.");return false}
 const urls={"metamask":"https://metamask.app.link/dapp/"+location.host+location.pathname,"trust wallet":"https://link.trustwallet.com/open_url?coin_id=20000714&url="+encodeURIComponent(location.href),"okx wallet":"okx://wallet/dapp/details?dappUrl="+encodeURIComponent(location.href),"safepal":"safepalwallet://dapp?url="+encodeURIComponent(location.href),"coinbase wallet":"https://go.cb-w.com/dapp?cb_url="+encodeURIComponent(location.href),"binance wallet":"bnc://app.binance.com/cedefi/dapp?url="+encodeURIComponent(location.href)};const u=urls[n];if(!u){if(notice)notice("Open your wallet browser and visit Web3Market again.");return false}location.href=u;return true
}
window.Web3MarketWalletManager={connectAndVerify,listWallets,getDetected,launch,short,esc,detect,version:"REST-AUTH-20260918-5"};
})();
