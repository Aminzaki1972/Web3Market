"use strict";(function(){
const BSC="0x38";
const short=a=>a.slice(0,8)+"…"+a.slice(-6);
const getSb=()=>window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
const providers=new Map();let discoveryStarted=false;
function discoverProviders(){
 if(discoveryStarted)return;discoveryStarted=true;
 try{window.addEventListener("eip6963:announceProvider",e=>{const p=e?.detail?.provider;if(p)providers.set(e?.detail?.info?.rdns||String(providers.size),p)});window.dispatchEvent(new Event("eip6963:requestProvider"));}catch(_){ }
 if(window.ethereum)providers.set("injected",window.ethereum);
}
function chooseProvider(list){
 if(list.length<=1)return Promise.resolve(list[0]||null);
 return new Promise(resolve=>{
  const old=document.getElementById("wm-wallet-chooser");if(old)old.remove();
  const box=document.createElement("div");box.id="wm-wallet-chooser";box.style.cssText="position:fixed;inset:0;z-index:99999;display:grid;place-items:center;background:rgba(0,0,0,.55);padding:20px";
  const card=document.createElement("div");card.style.cssText="width:min(92vw,360px);background:#fff;color:#141820;border-radius:16px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.3);font-family:system-ui,sans-serif";
  const title=document.createElement("div");title.textContent="Choose a Web3 Wallet";title.style.cssText="font-weight:900;font-size:18px;margin-bottom:14px";card.appendChild(title);
  list.forEach((p,i)=>{const b=document.createElement("button");b.type="button";b.textContent=`Web3 Wallet ${i+1}`;b.style.cssText="display:block;width:100%;padding:12px;margin:8px 0;border:1px solid #ddd;border-radius:10px;background:#f8f9fb;font-weight:800;cursor:pointer";b.onclick=()=>{box.remove();resolve(p)};card.appendChild(b)});
  const cancel=document.createElement("button");cancel.type="button";cancel.textContent="Cancel";cancel.style.cssText="display:block;width:100%;padding:10px;margin-top:10px;border:0;background:transparent;color:#666;cursor:pointer";cancel.onclick=()=>{box.remove();resolve(null)};card.appendChild(cancel);box.appendChild(card);document.body.appendChild(box);
 });
}
async function getProvider(){discoverProviders();await new Promise(r=>setTimeout(r,150));return chooseProvider([...providers.values()]);}
async function connect(e){
 e.preventDefault();const link=e.currentTarget,card=link.closest(".wallet-card"),sb=getSb(),old=link.textContent;
 try{
  const provider=await getProvider();if(!provider)throw new Error("No compatible Web3 wallet is available.");
  link.textContent="Connecting…";link.style.pointerEvents="none";
  const accounts=await provider.request({method:"eth_requestAccounts"}),address=accounts?.[0];if(!address)throw new Error("No wallet account was selected.");
  let chain=await provider.request({method:"eth_chainId"});
  if(chain!==BSC){try{await provider.request({method:"wallet_switchEthereumChain",params:[{chainId:BSC}]})}catch(err){if(err?.code===4902)await provider.request({method:"wallet_addEthereumChain",params:[{chainId:BSC,chainName:"BNB Smart Chain",nativeCurrency:{name:"BNB",symbol:"BNB",decimals:18},rpcUrls:["https://bsc-dataseed.binance.org/"],blockExplorerUrls:["https://bscscan.com/"]}]});else throw err;}}
  if(await provider.request({method:"eth_chainId"})!==BSC)throw new Error("Please select BNB Smart Chain in your wallet.");
  if(!sb)throw new Error("Unable to connect to Web3Market.");
  const {data:{session},error:se}=await sb.auth.getSession();if(se||!session)throw new Error("Please sign in to Web3Market first.");
  const message=`Web3Market Buyer Wallet Verification\n\nI am connecting this wallet to my Web3Market buyer account.\n\nWallet: ${address}\nChain: BNB Smart Chain\nTimestamp: ${new Date().toISOString()}\n\nThis signature does not authorize any transaction or transfer of funds.`;
  link.textContent="Confirm in wallet…";
  const signature=await provider.request({method:"personal_sign",params:[message,address]});if(!signature)throw new Error("Wallet verification was not completed.");
  link.textContent="Verifying…";
  const response=await fetch("https://hzhqlexnhtukfljcvnyd.supabase.co/functions/v1/verify-wallet",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+session.access_token},body:JSON.stringify({address,message,signature})});
  const result=await response.json().catch(()=>({error:"Wallet verification failed"}));if(!response.ok||!result.ok)throw new Error(result.error||"Wallet verification failed");
  const addr=card?.querySelector(".wallet-address"),txt=card?.querySelector(".wallet-text");if(addr)addr.textContent=short(address);if(txt)txt.textContent="Wallet connected and verified.";link.textContent="Wallet Connected ✓";
 }catch(err){link.textContent=old;link.style.pointerEvents="auto";const msg=String(err?.message||"");if(msg)console.warn("Web3Market wallet connection:",msg);}
}
function bind(){document.querySelectorAll(".wallet-card .btn.full").forEach(btn=>{if(btn.dataset.walletBound)return;btn.dataset.walletBound="1";btn.href="#";btn.addEventListener("click",connect)})}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bind);else bind();new MutationObserver(bind).observe(document.documentElement,{childList:true,subtree:true});
})();
