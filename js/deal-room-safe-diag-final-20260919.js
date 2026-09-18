"use strict";
(async function(){
 const src=document.querySelector('script[data-safe-diag-source]');
 if(src){return;}
 const root=document.querySelector('#dealApp')||document.querySelector('.room');
 if(!root)return;
 const script=document.createElement('script');
 script.src='js/deal-room-safe-diag-20260919.js?final='+Date.now();
 script.dataset.safeDiagSource='1';
 document.head.appendChild(script);
})();
