"use strict";(function(){
const BSC="0x38";
const short=a=>a.slice(0,8)+"…"+a.slice(-6);
const getSb=()=>window.Web3MarketSupabase?.getClient?.()||window.Web3MarketSupabase?.client||window.Web3MarketSupabase?.supabase||window.supabaseClient||window.web3marketSupabase;
function provider(){try{return window.ethereum&&typeof window.ethereum.request==="function"?window.ethereum:null}catch(_){return null}}
async function connect(e){
 e.preventDefault();
 const link=e.currentTarget,card=link.closest(".wallet-card"),sb=getSb(),old=link.textContent;
 try{
  const p=provider();if(!p)return;
  link.style.pointerEvents="none";
  const accounts=await p.request({method:"eth_requestAccounts"});
  const address=accounts?.[0];if(!address)return;
  if(await p.request({method:"eth_chainId"})!==BSC){
   try{await p.request({method:"wallet_switchEthereumChain",params:[{chainId:BSC}]})}
   catch(err){if(err?.code===4902)await p.request({method:"wallet_addEthereumChain",params:[{chainId:BSC,chainName:"BNB Smart Chain",nativeCurrency:{name:"BNB",symbol:"BNB",decimals:18},rpcUrls:["https://bsc-dataseed.binance.org/"],blockExplorerUrls:["https://bscscan.com/"]}]});else throw err}
  }
  if(await p.request({method:"eth_chainId"})!==BSC)return;
  if(!sb?.auth)return;
  const {data:{session}}=await sb.auth.getSession();if(!session?.access_token)return;
  const message=`Web3Market Buyer Wallet Verification\n\nI am connecting this wallet to my Web3Market buyer account.\n\nWallet: ${address}\nChain: BNB Smart Chain\nTimestamp: ${new Date().toISOString()}\n\nThis signature does not authorize any transaction or transfer of funds.`;
  const signature=await p.request({method:"personal_sign",params:[message,address]});if(!signature)return;
  const r=await fetch("https://hzhqlexnhtukfljcvnyd.supabase.co/functions/v1/verify-wallet",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+session.access_token},body:JSON.stringify({address,message,signature})});
  const body=await r.json().catch(()=>({}));if(!r.ok||!body.ok)return;
  const a=card?.querySelector(".wallet-address"),t=card?.querySelector(".wallet-text");if(a)a.textContent=short(address);if(t)t.textContent="Wallet connected and verified.";link.textContent="Wallet Connected ✓";
 }catch(err){link.textContent=old;link.style.pointerEvents="auto";console.warn("Web3Market wallet connection failed",err)}
}
function bind(){document.querySelectorAll(".wallet-card .btn.full").forEach(b=>{if(b.dataset.walletV2)return;b.dataset.walletV2="1";b.href="#";b.addEventListener("click",connect)})}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bind,{once:true});else bind();
new MutationObserver(bind).observe(document.documentElement,{childList:true,subtree:true});
})();
