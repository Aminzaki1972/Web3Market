(() => {
'use strict';
const LANGS={en:'English',ar:'العربية',fr:'Français',es:'Español',tr:'Türkçe',de:'Deutsch',pt:'Português',ru:'Русский',zh:'中文',ja:'日本語',ko:'한국어'};
const STORAGE_KEY='wm-language';
const GOOGLE_SCRIPT_ID='wm-google-translate-script';

function getSavedLanguage(){try{return localStorage.getItem(STORAGE_KEY)||'en';}catch(e){return'en';}}
function applyDirection(lang){
  const safe=LANGS[lang]?lang:'en';
  document.documentElement.lang=safe;
  document.documentElement.dir=safe==='ar'?'rtl':'ltr';
  document.documentElement.setAttribute('data-wm-language',safe);
  if(document.body) document.body.setAttribute('data-wm-language',safe);
}
function saveLanguage(lang){try{localStorage.setItem(STORAGE_KEY,lang);}catch(e){}applyDirection(lang);}
function selectGoogleLanguage(lang){
  const select=document.querySelector('.goog-te-combo');
  if(!select)return false;
  if(select.value!==lang)select.value=lang;
  select.dispatchEvent(new Event('change',{bubbles:true}));
  return true;
}
function setGoogleCookie(lang){
  const value='/en/'+lang;
  if(lang==='en'){
    document.cookie='googtrans=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
    try{document.cookie='googtrans=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain='+location.hostname;}catch(e){}
    return;
  }
  document.cookie='googtrans='+value+';path=/';
  try{document.cookie='googtrans='+value+';path=/;domain='+location.hostname;}catch(e){}
}
function setGoogleLanguage(lang){
  if(!LANGS[lang])return;
  saveLanguage(lang);
  if(selectGoogleLanguage(lang))return;
  let attempts=0;
  const timer=setInterval(()=>{
    attempts++;
    if(selectGoogleLanguage(lang)||attempts>=25){
      clearInterval(timer);
      if(attempts>=25&&!selectGoogleLanguage(lang)){setGoogleCookie(lang);location.reload();}
    }
  },200);
}
window.googleTranslateElementInit=function(){
  if(window.__wmGoogleTranslateReady)return;
  if(typeof google==='undefined'||!google.translate)return;
  const holder=document.getElementById('google_translate_element');
  if(!holder)return;
  window.__wmGoogleTranslateReady=true;
  new google.translate.TranslateElement({pageLanguage:'en',includedLanguages:Object.keys(LANGS).join(','),autoDisplay:false,multilanguagePage:true},'google_translate_element');
  const saved=getSavedLanguage();
  applyDirection(saved);
  let attempts=0;
  const timer=setInterval(()=>{attempts++;if(selectGoogleLanguage(saved)||attempts>=30)clearInterval(timer);},200);
};
function loadGoogleTranslate(){
  if(window.__wmGoogleTranslateReady||document.getElementById(GOOGLE_SCRIPT_ID))return;
  const script=document.createElement('script');
  script.id=GOOGLE_SCRIPT_ID;
  script.src='https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
  script.async=true;
  document.head.appendChild(script);
}
function addPicker(){
  if(document.getElementById('wm-language'))return;
  const nav=document.querySelector('.navin')||document.querySelector('.topbar')||document.querySelector('header')||document.body;
  if(!nav)return;
  const wrap=document.createElement('div');wrap.id='wm-language';wrap.style.cssText='position:relative;display:inline-flex;align-items:center;margin-left:8px;z-index:10000';
  const b=document.createElement('button');b.type='button';b.setAttribute('aria-label','Language');b.title='Language';b.textContent='🌐';b.style.cssText='height:40px;min-width:40px;border:1px solid #dce1e8;border-radius:50%;background:#fff;cursor:pointer;font-size:19px';
  const m=document.createElement('div');m.style.cssText='display:none;position:absolute;right:0;top:46px;background:#fff;border:1px solid #e1e5eb;border-radius:12px;box-shadow:0 14px 35px rgba(20,24,32,.15);padding:6px;z-index:99999;min-width:160px;max-height:70vh;overflow:auto';
  Object.entries(LANGS).forEach(([code,name])=>{const x=document.createElement('button');x.type='button';x.textContent=name;x.style.cssText='display:block;width:100%;padding:9px 10px;border:0;background:#fff;text-align:left;border-radius:8px;cursor:pointer';x.addEventListener('click',()=>{m.style.display='none';setGoogleLanguage(code);});m.appendChild(x);});
  b.addEventListener('click',e=>{e.stopPropagation();m.style.display=m.style.display==='block'?'none':'block';});
  document.addEventListener('click',()=>{m.style.display='none';});
  wrap.append(b,m);nav.appendChild(wrap);
  const holder=document.createElement('div');holder.id='google_translate_element';holder.style.cssText='position:absolute;left:-99999px;top:-99999px;width:1px;height:1px;overflow:hidden';document.body.appendChild(holder);
}
function hideGoogleArtifacts(){
  if(document.getElementById('wm-google-translate-style'))return;
  const style=document.createElement('style');style.id='wm-google-translate-style';
  style.textContent='.goog-te-banner-frame,.skiptranslate{display:none!important}body{top:0!important}.goog-tooltip,.goog-tooltip:hover{display:none!important}.goog-text-highlight{background:transparent!important;box-shadow:none!important}';
  document.head.appendChild(style);
}
function init(){const saved=getSavedLanguage();applyDirection(saved);addPicker();hideGoogleArtifacts();loadGoogleTranslate();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();