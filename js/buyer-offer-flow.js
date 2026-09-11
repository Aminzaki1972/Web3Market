"use strict";
(function(){
 const id=new URLSearchParams(location.search).get('id');
 if(!id)return;
 const returnTo='project.html?id='+encodeURIComponent(id);
 try{localStorage.setItem('web3market_offer_return_to',returnTo)}catch(_){}
 document.addEventListener('click',e=>{const a=e.target.closest?.('a[href*="register.html?role=buyer"]');if(a){try{localStorage.setItem('web3market_offer_return_to',returnTo)}catch(_){} }},true);
 document.addEventListener('submit',e=>{if(e.target?.id==='offerForm'){try{localStorage.setItem('web3market_offer_return_to',returnTo)}catch(_){} }},true);
})();
