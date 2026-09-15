/* Web3Market homepage enhancements — cache-busting deployment marker: 20260911-2 */
(function () {
  'use strict';
  var styles=`.wmx-section{padding:76px 0}.wmx-about{background:#fff;border-top:1px solid #e4e7eb;border-bottom:1px solid #e4e7eb}.wmx-head{max-width:760px;margin:0 auto;text-align:center}.wmx-kicker{display:inline-block;color:#635bff;font-size:11px;font-weight:950;letter-spacing:1px;margin-bottom:10px}.wmx-head h2{margin:0 0 12px;font-size:38px;letter-spacing:-1.4px;color:#141820}.wmx-head p{margin:0;color:#737b88;font-size:15px;line-height:1.75}.wmx-about-grid,.wmx-roadmap-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:30px}.wmx-card{background:#f8f9fb;border:1px solid #e3e6eb;border-radius:18px;padding:25px}.wmx-card strong{display:block;font-size:17px;margin-bottom:8px;color:#141820}.wmx-card p{margin:0;color:#737b88;font-size:13px;line-height:1.7}.wmx-roadmap{background:#f6f7f9}.wmx-phase{background:#fff;border:1px solid #e3e6eb;border-radius:20px;padding:25px}.wmx-phase.current{border-color:#c9c5ff;box-shadow:0 12px 30px rgba(99,91,255,.08)}.wmx-phase-badge{display:inline-flex;padding:6px 9px;border-radius:999px;background:#eeedff;color:#5149db;font-size:10px;font-weight:950;letter-spacing:.6px}.wmx-phase h3{margin:14px 0 7px;font-size:20px}.wmx-phase p{margin:0 0 16px;color:#737b88;font-size:13px;line-height:1.65}.wmx-phase ul{padding:0;margin:0;list-style:none;display:grid;gap:9px}.wmx-phase li{font-size:12px;color:#515966}.wmx-phase li:before{content:'✓';color:#635bff;font-weight:950;margin-right:8px}.wmx-ai{background:#141820;color:#fff}.wmx-ai .wmx-head h2{color:#fff}.wmx-ai .wmx-head p{color:#b3bac5}.wmx-ai-shell{max-width:900px;margin:30px auto 0;background:#202631;border:1px solid #343b48;border-radius:22px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.18)}.wmx-ai-top{padding:18px 20px;border-bottom:1px solid #343b48;display:flex;justify-content:space-between;align-items:center;gap:15px}.wmx-ai-title{font-weight:950}.wmx-ai-title span{color:#9e98ff}.wmx-ai-status{font-size:10px;color:#aeb6c4}.wmx-chat{height:330px;overflow:auto;padding:20px;display:grid;gap:12px}.wmx-msg{max-width:82%;padding:12px 14px;border-radius:14px;font-size:13px;line-height:1.6}.wmx-msg.ai{background:#2a313d;color:#e8ebf0;justify-self:start}.wmx-msg.user{background:#635bff;color:#fff;justify-self:end}.wmx-quick{display:flex;gap:8px;flex-wrap:wrap;padding:0 20px 15px}.wmx-q{border:1px solid #3b4351;background:#272e39;color:#e5e8ee;border-radius:999px;padding:8px 11px;font-size:11px;font-weight:800;cursor:pointer}.wmx-input{display:flex;gap:8px;padding:15px 20px;border-top:1px solid #343b48}.wmx-input input{flex:1;min-width:0;height:42px;border:1px solid #3b4351;background:#171c24;color:#fff;border-radius:11px;padding:0 12px;outline:none}.wmx-input button{height:42px;border:0;border-radius:11px;background:#635bff;color:#fff;padding:0 15px;font-weight:900;cursor:pointer}@media(max-width:700px){.wmx-section{padding:58px 0}.wmx-head h2{font-size:30px}.wmx-about-grid,.wmx-roadmap-grid{grid-template-columns:1fr}.wmx-msg{max-width:92%}.wmx-chat{height:360px}.wmx-ai-top{align-items:flex-start;flex-direction:column}}`;
  var st=document.createElement('style');st.id='wmx-enhancement-styles';st.textContent=styles;document.head.appendChild(st);
  var section=document.createElement('div');section.id='wmx-enhancements';section.innerHTML=`<section class="wmx-section wmx-about" id="about"><div class="wrap"><div class="wmx-head"><span class="wmx-kicker">ABOUT WEB3MARKET</span><h2>A marketplace built for Web3 project ownership</h2><p>Web3Market brings discovery, project intelligence and transaction workflows together in one global marketplace for buying and selling Web3 projects.</p></div><div class="wmx-about-grid"><article class="wmx-card"><strong>Discover & acquire</strong><p>Find Web3 projects, compare opportunities and move from discovery toward acquisition through a dedicated marketplace.</p></article><article class="wmx-card"><strong>AI-powered intelligence</strong><p>Use available AI project review and valuation features to understand project information before making decisions.</p></article><article class="wmx-card"><strong>On-chain transaction vision</strong><p>Web3Market is designed around secure, transparent transaction workflows with Deal Room and blockchain infrastructure.</p></article></div></div></section><section class="wmx-section wmx-roadmap" id="roadmap"><div class="wrap"><div class="wmx-head"><span class="wmx-kicker">ROADMAP</span><h2>From marketplace foundation to a complete Web3 acquisition layer</h2><p>A transparent roadmap focused on useful product milestones rather than unsupported promises.</p></div><div class="wmx-roadmap-grid"><article class="wmx-phase"><span class="wmx-phase-badge">PHASE 01 • FOUNDATION</span><h3>Marketplace Core</h3><p>Establish the core buying and selling experience.</p><ul><li>Project listings</li><li>Buyer and seller accounts</li><li>Project discovery</li><li>Marketplace workflows</li></ul></article><article class="wmx-phase current"><span class="wmx-phase-badge">PHASE 02 • CURRENT</span><h3>AI + Deal Experience</h3><p>Make evaluation and transaction follow-up more useful and understandable.</p><ul><li>AI project review</li><li>AI valuation experience</li><li>Deal Room workflow</li><li>Wallet and transaction UX</li></ul></article><article class="wmx-phase"><span class="wmx-phase-badge">PHASE 03 • NEXT</span><h3>On-Chain Acquisition</h3><p>Expand the on-chain transaction layer as contracts and operational safeguards are finalized.</p><ul><li>Escrow infrastructure</li><li>On-chain payment flow</li><li>Delivery confirmation</li><li>Dispute and settlement tooling</li></ul></article></div></div></section><section class="wmx-section wmx-ai" id="ai-guide"><div class="wrap"><div class="wmx-head"><span class="wmx-kicker">WEB3MARKET AI GUIDE</span><h2>Your AI guide to using Web3Market</h2><p>Ask how to create an account, connect a Web3 wallet, find a project, or understand the steps of a deal. This assistant provides platform guidance only.</p></div><div class="wmx-ai-shell"><div class="wmx-ai-top"><div class="wmx-ai-title">Web3Market <span>Assistant</span></div><div class="wmx-ai-status">● Online guide • No wallet access</div></div><div class="wmx-chat" id="wmxChat"><div class="wmx-msg ai">Hi! I can guide you through Web3Market. Try “How do I create an account?”, “How do I connect my wallet?”, or “How do I complete a deal?”</div></div><div class="wmx-quick"><button class="wmx-q" type="button" data-q="How do I create an account?">Create account</button><button class="wmx-q" type="button" data-q="How do I connect my Web3 wallet?">Connect wallet</button><button class="wmx-q" type="button" data-q="How do I find and evaluate a project?">Find a project</button><button class="wmx-q" type="button" data-q="How do I complete a deal?">Complete a deal</button></div><form class="wmx-input" id="wmxForm"><input id="wmxInput" autocomplete="off" placeholder="Ask about using Web3Market…" aria-label="Ask Web3Market Assistant"><button type="submit">Ask</button></form></div></div></section>`;
  function answer(q){q=String(q||'').toLowerCase();if(/account|register|sign up|create/.test(q))return'To create an account, choose Create Account/Register from Web3Market, select the appropriate buyer or seller role, complete the registration details, then sign in. After signing in, continue to your dashboard.';if(/wallet|connect|web3/.test(q))return'To connect a Web3 wallet, sign in first and use the wallet connection option provided by the relevant Web3Market page. Approve the connection request in your wallet only when the site and network details are correct. Never share your seed phrase or private key.';if(/find|browse|market|project|evaluate|valuation|ai/.test(q))return'Open Marketplace, browse or filter projects, open a project to review its information, and use the available AI review/valuation information as supporting analysis. Always verify important project claims yourself before buying.';if(/deal|buy|purchase|transaction|payment|escrow|delivery|dispute/.test(q))return'A typical Web3Market deal path is: choose a project → communicate/review terms → proceed through the Deal Room → follow the available payment/escrow steps → confirm delivery when the agreed deliverables are received. If a dispute occurs, use the dispute process shown in the Deal Room. Available on-chain steps depend on the current platform implementation.';if(/sell|list/.test(q))return'To sell, create a seller account, use the seller/project listing workflow, provide accurate project information, and follow the Deal Room process when a buyer engages. Do not publish private keys, seed phrases, or other sensitive credentials.';return'I am the Web3Market usage guide. I can explain account creation, wallet connection, marketplace browsing, AI review, selling a project, Deal Room steps, payment/escrow workflow, delivery and disputes. Ask me one of those and I will walk you through it.';}
  function add(t,k){var c=document.getElementById('wmxChat');if(!c)return;var e=document.createElement('div');e.className='wmx-msg '+k;e.textContent=t;c.appendChild(e);c.scrollTop=c.scrollHeight}
  function init(){var m=document.querySelector('main');if(!m||document.getElementById('wmx-enhancements'))return;m.appendChild(section);var f=document.getElementById('wmxForm'),i=document.getElementById('wmxInput');f.addEventListener('submit',function(e){e.preventDefault();var q=i.value.trim();if(q){add(q,'user');i.value='';setTimeout(function(){add(answer(q),'ai')},120)}});document.querySelectorAll('.wmx-q').forEach(function(b){b.addEventListener('click',function(){var q=b.getAttribute('data-q');add(q,'user');setTimeout(function(){add(answer(q),'ai')},120)})})}
  function boot(){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();setTimeout(init,1000);setTimeout(init,2500)}
  boot();
})();

/* Premium homepage presentation — UI-only; homepage status counters have been removed. */
(function(){
  'use strict';
  function polish(){
    if(document.getElementById('wm-premium-home-style'))return;
    var style=document.createElement('style');style.id='wm-premium-home-style';style.textContent=`.hero{padding:84px 0 58px!important;background:linear-gradient(180deg,#fff 0%,#fafbfc 72%,#f6f7f9 100%)!important}.heroGrid{gap:58px!important}.hero h1{font-weight:950!important}.hero h1 .claim{color:#5149db!important}.heroActions .btn.supportLink{display:none!important}.heroActions .btn:not(.accent){background:#fff!important}.sellerOffer{border-color:#dedbff!important;box-shadow:0 18px 40px rgba(99,91,255,.07)!important}.browse{padding-top:62px!important}.browseBar{margin-bottom:22px!important}.trust{margin-top:8px!important}.wmx-section{scroll-margin-top:80px}@media(max-width:950px){.hero{padding-top:62px!important}.heroGrid{gap:34px!important}}@media(max-width:620px){.hero{padding:48px 0 38px!important}.heroActions{gap:8px!important}.heroActions .btn{min-height:40px!important;padding:0 13px!important}.browse{padding-top:46px!important}}`;
    document.head.appendChild(style);
    var offer=document.querySelector('.sellerOffer');
    if(offer){var fee=offer.querySelector('.feeLine');if(fee)fee.innerHTML='No upfront listing fees • No monthly fees • <b>7.5% success fee</b> when your deal closes.';}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',polish,{once:true});else polish();setTimeout(polish,900);setTimeout(polish,2200);
})();

/* Live marketplace bootstrap — independent of the removed homepage counters. */
(function(){
  'use strict';
  function load(){
    if(!document.querySelector('.listingGrid')||document.getElementById('wm-live-marketplace-bootstrap'))return;
    var s=document.createElement('script');
    s.id='wm-live-marketplace-bootstrap';
    s.src='/js/real-marketplace.js?v=20260911-2';
    s.async=true;
    s.onload=function(){console.log('Web3Market live marketplace loaded')};
    s.onerror=function(){console.warn('Web3Market live marketplace unavailable')};
    (document.head||document.body||document.documentElement).appendChild(s);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load,{once:true});else load();
  window.addEventListener('load',load,{once:true});
  setTimeout(load,1500);
})();

/* Logo background visibility fix — use the supplied Web3Market artwork as a real background layer.
   This intentionally overrides the old negative-z-index pseudo-element implementation. */
(function(){
  'use strict';
  function applyLogoBackground(){
    if(document.getElementById('wm-logo-background-fix'))return;
    var style=document.createElement('style');
    style.id='wm-logo-background-fix';
    style.textContent=`
      .hero{
        position:relative!important;
        isolation:isolate!important;
        overflow:hidden!important;
        min-height:620px!important;
        padding:84px 0 58px!important;
        color:#fff!important;
        background-color:#04091e!important;
        background-image:
          linear-gradient(90deg,rgba(4,9,30,.98) 0%,rgba(4,9,30,.94) 28%,rgba(4,9,30,.70) 54%,rgba(4,9,30,.18) 82%,rgba(4,9,30,.06) 100%),
          url("assets/web3market-home-background.svg")!important;
        background-position:center,right 5% center!important;
        background-size:cover,620px 620px!important;
        background-repeat:no-repeat!important;
      }
      .hero:before{display:none!important}
      .hero:after{z-index:0!important;pointer-events:none!important;background:radial-gradient(circle at 78% 46%,rgba(38,133,255,.10),transparent 34%),linear-gradient(180deg,rgba(3,7,25,.03),rgba(3,7,25,.22))!important}
      .heroGrid{position:relative!important;z-index:2!important;min-height:480px!important}
      .heroGrid>div{max-width:700px!important}
      @media(max-width:950px){
        .hero{min-height:640px!important;background-position:center,right center!important;background-size:cover,560px 560px!important}
        .heroGrid{min-height:520px!important}
      }
      @media(max-width:620px){
        .hero{min-height:720px!important;padding:48px 0 34px!important;background-image:linear-gradient(180deg,rgba(4,9,30,.97) 0%,rgba(4,9,30,.91) 45%,rgba(4,9,30,.57) 72%,rgba(4,9,30,.18) 100%),url("assets/web3market-home-background.svg")!important;background-position:center,center bottom!important;background-size:cover,100% auto!important}
        .heroGrid{min-height:610px!important;align-items:start!important}
      }
    `;
    document.head.appendChild(style);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',applyLogoBackground,{once:true});else applyLogoBackground();
  setTimeout(applyLogoBackground,400);
  setTimeout(applyLogoBackground,1200);
})();

/* Social footer — Join Our Ecosystem */
(function(){
  'use strict';
  function addSocialFooter(){
    if(document.getElementById('wm-social-footer'))return;
    var footer=document.querySelector('.footer');
    if(!footer)return;
    var wrap=footer.querySelector('.wrap')||footer.querySelector('.footerIn');
    if(!wrap)return;
    var section=document.createElement('div');
    section.id='wm-social-footer';
    section.innerHTML=`<div class="wm-social-title">Join Our Ecosystem</div><div class="wm-social-links"><a href="https://x.com/Web3MarketXYZ" target="_blank" rel="noopener noreferrer" aria-label="Web3Market on X">𝕏 <span>X / Twitter</span></a><a href="https://t.me/Web3market_Global" target="_blank" rel="noopener noreferrer" aria-label="Web3Market on Telegram">✈ <span>Telegram</span></a></div>`;
    var style=document.createElement('style');
    style.id='wm-social-footer-style';
    style.textContent=`#wm-social-footer{width:100%;padding:0 0 24px;margin:0 0 24px;border-bottom:1px solid rgba(255,255,255,.12);text-align:center}.wm-social-title{color:#fff;font-size:15px;font-weight:900;letter-spacing:.2px;margin-bottom:12px}.wm-social-links{display:flex;justify-content:center;align-items:center;gap:12px;flex-wrap:wrap}.wm-social-links a{display:inline-flex;align-items:center;gap:7px;padding:9px 13px;border:1px solid rgba(255,255,255,.14);border-radius:999px;color:#c9d0da;font-size:12px;font-weight:800;transition:all .2s ease}.wm-social-links a:hover{color:#fff;border-color:rgba(255,255,255,.35);transform:translateY(-1px)}.wm-social-links a:first-child{font-size:12px}.wm-social-links a:first-child::first-letter{font-size:17px}@media(max-width:620px){#wm-social-footer{padding-bottom:20px;margin-bottom:20px}.wm-social-links{gap:8px}.wm-social-links a{padding:8px 11px}}`;
    document.head.appendChild(style);
    wrap.insertBefore(section,wrap.firstChild);
  }
  function boot(){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',addSocialFooter,{once:true});else addSocialFooter();setTimeout(addSocialFooter,800);setTimeout(addSocialFooter,2000)}
  boot();
})();