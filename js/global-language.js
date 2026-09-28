(() => {
'use strict';

const LANGS={en:'English',ar:'العربية',fr:'Français',es:'Español',tr:'Türkçe',de:'Deutsch',pt:'Português',ru:'Русский',zh:'中文',ja:'日本語',ko:'한국어'};

const UI={
  en:{passport:'AI Project Passport',market:'Marketplace',cat:'Categories',sell:'Sell',how:'How it works',support:'Support'},
  ar:{passport:'جواز المشروع بالذكاء الاصطناعي',market:'السوق',cat:'التصنيفات',sell:'بيع مشروع',how:'كيف تعمل المنصة',support:'الدعم'},
  fr:{passport:'Passeport du projet IA',market:'Marché',cat:'Catégories',sell:'Vendre',how:'Comment ça marche',support:'Support'},
  es:{passport:'Pasaporte de proyecto IA',market:'Marketplace',cat:'Categorías',sell:'Vender',how:'Cómo funciona',support:'Soporte'},
  tr:{passport:'AI Proje Pasaportu',market:'Pazar',cat:'Kategoriler',sell:'Sat',how:'Nasıl çalışır',support:'Destek'}
};

const AR={
'AI + ON-CHAIN WEB3 MARKETPLACE':'سوق ويب3 المدعوم بالذكاء الاصطناعي وعلى البلوكشين',
'AI-powered on-chain Web3 project marketplace':'سوق مشاريع ويب3 المدعوم بالذكاء الاصطناعي وعلى البلوكشين',
'Web3Market — the marketplace for Web3 commerce':'Web3Market — سوق التجارة لمشاريع Web3',
'BNB Chain ready • Global • Secure by design':'جاهز لشبكة BNB • عالمي • مصمم مع مراعاة الأمان',
'Support':'الدعم',
'Marketplace':'السوق',
'Categories':'التصنيفات',
'Sell':'بيع مشروع',
'How it works':'كيف تعمل المنصة',
'AI Project Passport':'جواز المشروع بالذكاء الاصطناعي',
'Download APK':'تحميل التطبيق',
'Login':'تسجيل الدخول',
'Choose account type':'اختر نوع الحساب',
'The World\'s First Marketplace for Buying & Selling Web3 Projects':'أول سوق لشراء وبيع مشاريع Web3',
'Powered by AI. Built On-Chain.':'مدعوم بالذكاء الاصطناعي ومبني على البلوكشين.',
'Discover, evaluate, buy and sell Web3 projects with AI-powered reviews and blockchain-secured transactions.':'اكتشف وقيّم واشترِ وبِع مشاريع Web3 مع مراجعات مدعومة بالذكاء الاصطناعي ومعاملات مؤمّنة بالبلوكشين.',
'LIST YOUR WEB3 PROJECT FOR FREE':'اعرض مشروع Web3 الخاص بك مجانًا',
'Pay only when your deal successfully closes.':'ادفع فقط عند إتمام الصفقة بنجاح.',
'No upfront listing fees • No monthly fees •':'لا توجد رسوم إدراج مقدمة • لا توجد رسوم شهرية •',
'success fee':'رسوم نجاح',
'Explore marketplace':'استكشف السوق',
'Choose Buyer or Seller':'اختر مشتريًا أو بائعًا',
'Contact Support':'تواصل مع الدعم',
'AI-powered project review':'مراجعة المشروع بالذكاء الاصطناعي',
'On-chain transaction ready':'معاملات على البلوكشين',
'Global Web3 marketplace':'سوق Web3 عالمي',
'Browse Web3 opportunities':'استكشف فرص Web3',
'Real projects, structured information and a clear acquisition path.':'مشاريع حقيقية ومعلومات منظمة ومسار واضح للاستحواذ.',
'View marketplace →':'عرض السوق ←',
'All Projects':'كل المشاريع',
'Micro-SaaS':'Micro-SaaS',
'DeFi':'DeFi',
'AI':'الذكاء الاصطناعي',
'Infrastructure':'البنية التحتية',
'Tools':'الأدوات',
'AI Review':'مراجعة بالذكاء الاصطناعي',
'Structured project evaluation':'تقييم منظم للمشروع',
'On-Chain Ready':'جاهز للمعاملات على البلوكشين',
'Built toward secure transactions':'مصمم نحو معاملات آمنة',
'Buyer + Seller':'مشتري + بائع',
'One marketplace for both sides':'سوق واحد للطرفين',
'Global':'عالمي',
'Web3 projects and buyers worldwide':'مشاريع Web3 ومشترون من جميع أنحاء العالم',
'One marketplace. Two paths.':'سوق واحد. مساران.',
'Buy a Web3 project or list one for acquisition with a structured workflow.':'اشترِ مشروع Web3 أو اعرض مشروعك للاستحواذ من خلال سير عمل منظم.',
'FOR BUYERS':'للمشترين',
'Find your next Web3 opportunity.':'اعثر على فرصة Web3 القادمة.',
'Browse projects, compare opportunities and evaluate available information before moving forward.':'تصفح المشاريع، وقارن الفرص، وقيّم المعلومات المتاحة قبل المتابعة.',
'Browse project categories':'تصفح تصنيفات المشاريع',
'Review seller-provided data':'راجع بيانات البائع',
'Use AI-powered project review':'استخدم مراجعة المشروع بالذكاء الاصطناعي',
'Move toward a protected transaction':'انتقل نحو معاملة محمية',
'Explore Projects':'استكشف المشاريع',
'Create Buyer Account':'إنشاء حساب مشتري',
'FOR SELLERS':'للبائعين',
'Turn your Web3 project into an acquisition opportunity.':'حوّل مشروع Web3 الخاص بك إلى فرصة للاستحواذ.',
'List your project for free, present the important details and connect with serious buyers.':'اعرض مشروعك مجانًا، وقدّم التفاصيل المهمة، وتواصل مع مشترين جادين.',
'Free project listing':'إدراج المشروع مجانًا',
'AI-assisted review':'مراجعة بمساعدة الذكاء الاصطناعي',
'Structured buyer presentation':'عرض منظم للمشترين',
'7.5% success fee only when the deal closes':'رسوم نجاح 7.5% فقط عند إتمام الصفقة',
'List Your Project':'اعرض مشروعك',
'Create Seller Account':'إنشاء حساب بائع',
'How Web3Market works':'كيف تعمل Web3Market',
'A simple path from discovery to a protected on-chain transaction.':'مسار بسيط من اكتشاف المشروع إلى معاملة محمية على البلوكشين.',
'Discover':'اكتشف',
'Browse Web3 projects and use marketplace filters to find opportunities.':'تصفح مشاريع Web3 واستخدم فلاتر السوق للعثور على الفرص.',
'Evaluate with AI':'قيّم بالذكاء الاصطناعي',
'Review available project data and AI-powered scoring before making a decision.':'راجع بيانات المشروع المتاحة وتقييم الذكاء الاصطناعي قبل اتخاذ القرار.',
'Buy & transfer on-chain':'شراء ونقل على البلوكشين',
'Use the Deal Room and blockchain escrow flow as the platform\'s on-chain transaction layer is activated.':'استخدم غرفة الصفقة ومسار الضمان بالبلوكشين مع تفعيل طبقة المعاملات على البلوكشين.',
'Ready to enter the Web3 project market?':'جاهز لدخول سوق مشاريع Web3؟',
'Discover projects, evaluate opportunities with AI and build toward secure on-chain transactions.':'اكتشف المشاريع، وقيّم الفرص بالذكاء الاصطناعي، واتجه نحو معاملات آمنة على البلوكشين.',
'Explore Marketplace':'استكشف السوق',
'Create Account':'إنشاء حساب',
'© 2026 Web3Market. All rights reserved.':'© 2026 Web3Market. جميع الحقوق محفوظة.',
'AI-powered • On-chain ready • Global':'مدعوم بالذكاء الاصطناعي • جاهز على البلوكشين • عالمي',
'Back to Web3Market':'العودة إلى Web3Market',
'How can we help?':'كيف يمكننا مساعدتك؟',
'For support, account questions, marketplace issues, or transaction assistance, contact the Web3Market support team.':'للدعم أو أسئلة الحساب أو مشكلات السوق أو المساعدة في المعاملات، تواصل مع فريق دعم Web3Market.',
'Email support@web3market.xyz':'راسل support@web3market.xyz',
'Support email:':'بريد الدعم:',
'Loading active Web3 projects…':'جارٍ تحميل مشاريع Web3 النشطة…',
'Search':'بحث',
'All categories':'كل التصنيفات',
'Active listings':'الإدراجات النشطة',
'Web3':'Web3',
'Gaming':'الألعاب',
'Loading Buyer Center…':'جارٍ تحميل مركز المشتري…',
'Loading seller dashboard…':'جارٍ تحميل لوحة البائع…'
};

const ATTR_AR={
'Search products & services':'ابحث عن المنتجات والخدمات',
'Search marketplace':'البحث في السوق',
'Filter by category':'التصفية حسب التصنيف',
'Listing status':'حالة الإدراج'
};

function translateExact(value,map){
  const v=String(value||'').trim();
  return map[v] || value;
}

const originalText=new WeakMap();
const originalAttrs=new WeakMap();

function translateNode(node,lang){
  if(node.nodeType===Node.TEXT_NODE){
    if(!node.parentElement || node.parentElement.matches('script,style,noscript,svg,#wm-language')) return;
    if(!originalText.has(node)) originalText.set(node,node.nodeValue);
    const original=originalText.get(node);
    if(lang==='ar'){
      const trimmed=String(original||'').trim();
      if(trimmed && AR[trimmed]) node.nodeValue=String(original).replace(trimmed,AR[trimmed]);
    }else{
      node.nodeValue=original;
    }
    return;
  }
  if(node.nodeType!==Node.ELEMENT_NODE) return;
  if(node.matches('script,style,noscript,svg,#wm-language')) return;

  if(!originalAttrs.has(node)) originalAttrs.set(node,{
    placeholder:node.getAttribute('placeholder'),
    'aria-label':node.getAttribute('aria-label'),
    title:node.getAttribute('title')
  });
  const saved=originalAttrs.get(node);
  if(lang==='ar'){
    if(saved.placeholder && ATTR_AR[saved.placeholder]) node.setAttribute('placeholder',ATTR_AR[saved.placeholder]);
    if(saved['aria-label'] && ATTR_AR[saved['aria-label']]) node.setAttribute('aria-label',ATTR_AR[saved['aria-label']]);
    if(saved.title && ATTR_AR[saved.title]) node.setAttribute('title',ATTR_AR[saved.title]);
  }else{
    ['placeholder','aria-label','title'].forEach(a=>{
      if(saved[a]!==null && saved[a]!==undefined) node.setAttribute(a,saved[a]);
      else node.removeAttribute(a);
    });
  }
  node.childNodes.forEach(child=>translateNode(child,lang));
}

function applyfunction addPicker(){
  if(document.getElementById('wm-language')) return;
  const nav=document.querySelector('.navin')||document.querySelector('.topbar');
  if(!nav) return;
  const wrap=document.createElement('div');
  wrap.id='wm-language';
  wrap.style.cssText='position:relative;margin-left:8px;z-index:10000';
  const b=document.createElement('button');
  b.type='button'; b.setAttribute('aria-label','Language'); b.title='Language'; b.textContent='🌐';
  b.style.cssText='height:40px;min-width:40px;border:1px solid #dce1e8;border-radius:50%;background:#fff;cursor:pointer;font-size:19px';
  const m=document.createElement('div');
  m.style.cssText='display:none;position:absolute;right:0;top:46px;background:#fff;border:1px solid #e1e5eb;border-radius:12px;box-shadow:0 14px 35px rgba(20,24,32,.15);padding:6px;z-index:9999;min-width:150px';
  Object.entries(LANGS).forEach(([c,n])=>{
    const x=document.createElement('button');
    x.type='button'; x.textContent=n;
    x.style.cssText='display:block;width:100%;padding:9px 10px;border:0;background:#fff;text-align:left;border-radius:8px;cursor:pointer';
    x.addEventListener('click',()=>{apply(c);m.style.display='none'});
    m.appendChild(x);
  });
  b.addEventListener('click',e=>{e.stopPropagation();m.style.display=m.style.display==='block'?'none':'block'});
  document.addEventListener('click',()=>m.style.display='none');
  wrap.append(b,m); nav.appendChild(wrap);
}

function init(){
  addPicker();
  apply(localStorage.getItem('wm-language')||'en');
  const observer=new MutationObserver(mutations=>{
    if(localStorage.getItem('wm-language')!=='ar') return;
    for(const m of mutations) m.addedNodes.forEach(n=>translateNode(n,'ar'));
  });
  observer.observe(document.body,{childList:true,subtree:true});
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
else init();
})();