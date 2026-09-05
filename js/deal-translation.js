/* Web3Market Deal Room translation layer.
   Presentation-only: original deal_messages.message is never modified. */
(() => {
  'use strict';
  const LANGS = {en:'English',zh:'中文',hi:'हिन्दी',es:'Español',ar:'العربية',fr:'Français',pt:'Português',ru:'Русский',ja:'日本語',de:'Deutsch',ko:'한국어',tr:'Türkçe',he:'עברית'};
  const cache = new Map();
  const pending = new Map();
  let preferred = 'en';
  let userId = null;

  function getSupabase() { return window.supabaseClient || window.Web3MarketSupabase?.getClient?.() || window.web3marketSupabase || null; }
  function getDealId() { const p=new URLSearchParams(location.search); return p.get('deal') || p.get('id') || ''; }

  async function loadPreferredLanguage() {
    const sb=getSupabase(); if(!sb) return;
    try {
      const {data:{user}}=await sb.auth.getUser(); if(!user)return;
      userId=user.id;
      const {data}=await sb.from('profiles').select('preferred_language').eq('id',user.id).maybeSingle();
      if(data && Object.prototype.hasOwnProperty.call(LANGS,data.preferred_language)) preferred=data.preferred_language;
    } catch(e) { console.warn('language preference unavailable',e); }
  }

  function addLanguagePicker() {
    const head=document.querySelector('.head'); if(!head || document.getElementById('dealLanguagePicker')) return;
    const wrap=document.createElement('div');
    wrap.style.cssText='margin-top:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;';
    const label=document.createElement('label'); label.htmlFor='dealLanguagePicker'; label.textContent='Preferred Language'; label.style.cssText='font-size:11px;color:#64748b;font-weight:700;';
    const select=document.createElement('select'); select.id='dealLanguagePicker'; select.setAttribute('aria-label','Preferred Language');
    select.style.cssText='padding:8px 10px;border:1px solid #dbe1ea;border-radius:9px;background:#fff;font-size:12px;';
    Object.entries(LANGS).forEach(([code,name])=>{const o=document.createElement('option');o.value=code;o.textContent=name;select.appendChild(o);});
    select.value=preferred;
    const note=document.createElement('span'); note.id='dealLanguageNote'; note.textContent='Used for Deal Room messages.'; note.style.cssText='font-size:10px;color:#64748b;';
    select.addEventListener('change',async()=>{
      const next=select.value; if(!Object.prototype.hasOwnProperty.call(LANGS,next))return;
      const old=preferred; preferred=next; select.disabled=true; note.textContent='Saving…';
      const sb=getSupabase(); let ok=false;
      try { if(sb&&userId){const {error}=await sb.from('profiles').update({preferred_language:next}).eq('id',userId);ok=!error;if(error)console.warn('language save',error);} } catch(e){console.warn('language save',e);}
      select.disabled=false;
      if(!ok){preferred=old;select.value=old;note.textContent='Could not save. Please try again.';return;}
      note.textContent='Language saved.'; cache.clear(); resetTranslations(); processMessages();
    });
    wrap.append(label,select,note); head.appendChild(wrap);
  }

  function resetTranslations() {
    document.querySelectorAll('#messages .msg').forEach(msg=>{
      msg.dataset.translationReady='0';
      msg.dataset.translationBusy='0';
      const text=msg.querySelector('.translation-text');
      if(text && msg.dataset.originalMessage) text.textContent=msg.dataset.originalMessage;
      const controls=msg.querySelector('.translation-controls'); if(controls)controls.remove();
    });
  }

  async function translate(text,target) {
    const key=target+'|'+text;
    if(cache.has(key)) return cache.get(key);
    if(pending.has(key)) return pending.get(key);
    const sb=getSupabase(); if(!sb)return null;
    const promise=(async()=>{
      try {
        const {data,error}=await sb.functions.invoke('translate-deal-message',{body:{deal_id:getDealId(),text,target_language:target}});
        if(error || !data || typeof data.translated_text!=='string') return null;
        const value=data.translated_text.trim(); if(!value)return null;
        cache.set(key,value); return value;
      } catch(e) { console.warn('translation unavailable',e); return null; }
      finally { pending.delete(key); }
    })();
    pending.set(key,promise); return promise;
  }

  function addControls(msg,original,translated) {
    if(msg.querySelector('.translation-controls'))return;
    const box=document.createElement('div'); box.className='translation-controls'; box.style.cssText='margin-top:6px;font-size:10px;display:flex;gap:8px;align-items:center;';
    const toggle=document.createElement('button'); toggle.type='button'; toggle.textContent='Original'; toggle.style.cssText='border:0;background:none;padding:0;cursor:pointer;text-decoration:underline;font-size:10px;';
    const label=document.createElement('span'); label.textContent='Translated'; label.style.opacity='.65';
    let originalShown=false;
    toggle.addEventListener('click',()=>{const node=msg.querySelector('.translation-text');if(!node)return;originalShown=!originalShown;node.textContent=originalShown?original:translated;toggle.textContent=originalShown?'Translation':'Original';label.textContent=originalShown?'Original':'Translated';});
    box.append(toggle,label); msg.appendChild(box);
  }

  function captureOriginalMessages() {
    const root=document.getElementById('messages'); if(!root)return;
    root.querySelectorAll('.msg').forEach(msg=>{
      if(msg.dataset.originalMessage)return;
      let text=msg.querySelector('.translation-text');
      if(!text){
        const first=Array.from(msg.childNodes).find(n=>n.nodeType===Node.TEXT_NODE && n.textContent.trim());
        if(first){text=document.createElement('span');text.className='translation-text';text.textContent=first.textContent;first.replaceWith(text);}
      }
      if(text)msg.dataset.originalMessage=text.textContent||'';
    });
  }

  async function processMessages() {
    if(preferred==='en')return;
    const root=document.getElementById('messages'); if(!root)return;
    const nodes=Array.from(root.querySelectorAll('.msg'));
    for(const msg of nodes){
      if(msg.dataset.translationReady==='1'||msg.dataset.translationBusy==='1')continue;
      const original=msg.dataset.originalMessage||''; if(!original.trim())continue;
      msg.dataset.translationBusy='1';
      try {
        const translated=await translate(original,preferred);
        const node=msg.querySelector('.translation-text');
        if(translated && translated!==original && node){node.textContent=translated;addControls(msg,original,translated);msg.dataset.translationReady='1';}
      } finally { msg.dataset.translationBusy='0'; }
    }
  }

  function startObserver() {
    const root=document.getElementById('messages'); if(!root)return;
    const observer=new MutationObserver(()=>{captureOriginalMessages();processMessages();});
    observer.observe(root,{childList:true,subtree:true});
    captureOriginalMessages(); processMessages();
  }

  async function init(){
    await loadPreferredLanguage();
    addLanguagePicker();
    startObserver();
    setTimeout(()=>{captureOriginalMessages();processMessages();},500);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
