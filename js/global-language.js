(() => {
'use strict';

const LANGS={
  en:'English',ar:'العربية',fr:'Français',es:'Español',tr:'Türkçe',
  de:'Deutsch',pt:'Português',ru:'Русский',zh:'中文',ja:'日本語',ko:'한국어'
};

function setGoogleLanguage(lang){
  const target=lang==='en'?'en':lang;
  try{ localStorage.setItem('wm-language',lang); }catch(e){}
  document.documentElement.lang=lang;
  document.documentElement.dir=lang==='ar'?'rtl':'ltr';

  const select=document.querySelector('.goog-te-combo');
  if(select){
    select.value=target;
    select.dispatchEvent(new Event('change'));
    return true;
  }

  // Google Translate stores the selected language in this cookie.
  const value='/en/'+target;
  document.cookie='googtrans='+value+';path=/';
  document.cookie='googtrans='+value+';path=/;domain='+location.hostname;
  if(lang==='en'){
    document.cookie='googtrans=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
    document.cookie='googtrans=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain='+location.hostname;
  }
  location.reload();
  return true;
}

window.googleTranslateElementInit=function(){
  if(window.__wmGoogleTranslateReady) return;
  window.__wmGoogleTranslateReady=true;
  if(typeof google==='undefined' || !google.translate) return;
  new google.translate.TranslateElement({
    pageLanguage:'en',
    includedLanguages:Object.keys(LANGS).join(','),
    autoDisplay:false
  },'google_translate_element');

  setTimeout(()=>{
    const saved=localStorage.getItem('wm-language')||'en';
    if(saved!=='en'){
      const select=document.querySelector('.goog-te-combo');
      if(select){select.value=saved;select.dispatchEvent(new Event('change'));}
    }
  },700);
};

function addPicker(){
  if(document.getElementById('wm-language')) return;
  const nav=document.querySelector('.navin')||document.querySelector('.topbar');
  if(!nav) return;

  const wrap=document.createElement('div');
  wrap.id='wm-language';
  wrap.style.cssText='position:relative;margin-left:8px;z-index:10000';

  const b=document.createElement('button');
  b.type='button';
  b.setAttribute('aria-label','Language');
  b.title='Language';
  b.textContent='🌐';
  b.style.cssText='height:40px;min-width:40px;border:1px solid #dce1e8;border-radius:50%;background:#fff;cursor:pointer;font-size:19px';

  const m=document.createElement('div');
  m.style.cssText='display:none;position:absolute;right:0;top:46px;background:#fff;border:1px solid #e1e5eb;border-radius:12px;box-shadow:0 14px 35px rgba(20,24,32,.15);padding:6px;z-index:99999;min-width:160px;max-height:70vh;overflow:auto';

  Object.entries(LANGS).forEach(([code,name])=>{
    const x=document.createElement('button');
    x.type='button';
    x.textContent=name;
    x.style.cssText='display:block;width:100%;padding:9px 10px;border:0;background:#fff;text-align:left;border-radius:8px;cursor:pointer';
    x.addEventListener('click',()=>{
      m.style.display='none';
      setGoogleLanguage(code);
    });
    m.appendChild(x);
  });

  b.addEventListener('click',e=>{
    e.stopPropagation();
    m.style.display=m.style.display==='block'?'none':'block';
  });
  document.addEventListener('click',()=>{m.style.display='none';});
  wrap.append(b,m);
  nav.appendChild(wrap);

  const holder=document.createElement('div');
  holder.id='google_translate_element';
  holder.style.cssText='position:absolute;left:-99999px;top:-99999px;width:1px;height:1px;overflow:hidden';
  document.body.appendChild(holder);
}

function init(){
  addPicker();
  const saved=localStorage.getItem('wm-language')||'en';
  document.documentElement.lang=saved;
  document.documentElement.dir=saved==='ar'?'rtl':'ltr';
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
else init();
})();