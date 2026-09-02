"use strict";(function(){
const BSC="0x38";
const short=a=>a.slice(0,8)+"…"+a.slice(-6);
const getSb=()=>window.Web3MarketSupabase?.getClient?.()||window.supabaseClient||window.web3marketSupabase;
const providers=new Map();
let discoveryStarted=false;
function discoverProviders(){
 if(discoveryStarted)return;
 discoveryStarted=true;
 try{
  window.addEventListener("eip6963:announceProvider",e=>{
   const p=e?.detail?.provider;if(p)providers.set(e?.detail?.info?.rdns||String(providers.size),p);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
 }catch(_){ }
 if(window.ethereum)providers.set("injected",window.ethereum);
}
async function getProvider(){
 discoverProviders();
 await new Promise(r=>setTimeout(r,150));
 const list=[...providers.values()];
 if(list.length===1)return list[0];
 if(list.length>1){
  const selected=window.prompt("Select wallet number:\n"+list.map((_,i)=>`${i+1}. Web3 Wallet`).join("\n"),"1");
  const n=Number(selected)-1;
  if(Number.isInteger(n)&&list[n])return list[n];
 }
 return list[0]||null;
}
async function connect(e){
 e.preventDefault();
 const link=e.currentTarget,card=link.closest(".wallet-card"),sb=getSb(),old=link.textContent;
 try{
  const provider=await getProvider();
  if(!provider)throw new Error("No compatible Web3 wallet is available.");
  link.textContent="Connecting…";link.style.pointerEvents="none";
  const accounts=await provider.request({method:"eth_requestAccounts"}),address=accounts?.[0];
  if(!address)throw new Error("No wallet account was selected.");
  let chain=await provider.request({method:"eth_chainId"});
  if(chain!==BSC){
   try{await provider.request({method:"wallet_switchEthereumChain",params:[{chainId:BSC}]})}
   catch(err){
    if(err?.code===4902)await provider.request({method:"wallet_addEthereumChain",params:[{chainId:BSC,chainName:"BNB Smart Chain",nativeCurrency:{name:"BNB",symbol:"BNB",decimals:18},rpcUrls:["https://bsc-dataseed.binance.org/"],blockExplorerUrls:["https://bscscan.com/"]}]});
    else throw err;
   }
  }
  if(await provider.request({method:"eth_chainId"})!==BSC)throw new Error("Please select BNB Smart Chain in your wallet.");
  if(!sb)throw new Error("Unable to connect to Web3Market.");
  const {data:{session},error:se}=await sb.auth.getSession();
  if(se||!session)throw new Error("Please sign in to Web3Market first.");
  const message=`Web3Market Buyer Wallet Verification\n\nI am connecting this wallet to my Web3Market buyer account.\n\nWallet: ${address}\nChain: BNB Smart Chain\nTimestamp: ${new Date().toISOString()}\n\nThis signature does not authorize any transaction or transfer of funds.`;
  link.textContent="Confirm in wallet…";
  const signature=await provider.request({method:"personal_sign",params:[message,address]});
  if(!signature)throw new Error("Wallet verification was not completed.");
  link.textContent="Verifying…";
  const response=await fetch("https://hzhqlexnhtukfljcvnyd.supabase.co/functions/v1/verify-wallet",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+session.access_token},body:JSON.stringify({address,message,signature})});
  const result=await response.json().catch(()=>({error:"Wallet verification failed"}));
  if(!response.ok||!result.ok)throw new Error(result.error||"Wallet verification failed");
  const addr=card?.querySelector(".wallet-address"),txt=card?.querySelector(".wallet-text");
  if(addr)addr.textContent=short(address);
  if(txt)txt.textContent="Wallet connected and verified.";
  link.textContent="Wallet Connected ✓";
 }catch(err){
  link.textContent=old;link.style.pointerEvents="auto";
  const msg=String(err?.message||"");
  if(msg)console.warn("Web3Market wallet connection:",msg);
 }
}
function bind(){document.querySelectorAll(".wallet-card .btn.full").forEach(btn=>{if(btn.dataset.walletBound)return;btn.dataset.walletBound="1";btn.href="#";btn.addEventListener("click",connect)})}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bind);else bind();
new MutationObserver(bind).observe(document.documentElement,{childList:true,subtree:true});
})();
