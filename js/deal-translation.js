/* Web3Market Deal Room translation layer.
   Presentation-only: original deal_messages.message is never modified. */
(() => {
  'use strict';
  const LANGS = ['en','zh','hi','es','ar','fr','pt','ru','ja','de','ko','tr','he'];
  const cache = new Map();
  const pending = new Set();
  let preferred = 'en';
  let observerStarted = false;

  function getSupabase() { return window.supabaseClient || window.sb || null; }
  function esc(s) { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

  async function loadPreferredLanguage() {
    const sb = getSupabase();
    if (!sb) return;
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const { data } = await sb.from('profiles').select('preferred_language').eq('id', user.id).maybeSingle();
      if (data && LANGS.includes(data.preferred_language)) preferred = data.preferred_language;
    } catch (_) {}
  }

  function dealId() { return new URLSearchParams(location.search).get('id') || ''; }

  async function translate(text, target) {
    const key = target + '|' + text;
    if (cache.has(key)) return cache.get(key);
    const sb = getSupabase();
    if (!sb) return null;
    const p = sb.functions.invoke('translate-deal-message', { body: { deal_id: dealId(), text, target_language: target } });
    const { data, error } = await p;
    if (error || !data || typeof data.translated_text !== 'string') return null;
    cache.set(key, data.translated_text);
    return data.translated_text;
  }

  function addControls(msg, original, translated) {
    if (msg.querySelector('.translation-controls')) return;
    const box = document.createElement('div');
    box.className = 'translation-controls';
    box.style.cssText = 'margin-top:6px;font-size:10px;display:flex;gap:8px;align-items:center;';
    const toggle = document.createElement('button');
    toggle.type='button'; toggle.textContent='Original';
    toggle.style.cssText='border:0;background:none;padding:0;cursor:pointer;text-decoration:underline;font-size:10px;';
    const label = document.createElement('span');
    label.textContent='Translated'; label.style.opacity='.65';
    let showingOriginal=false;
    toggle.addEventListener('click', () => {
      const textNode = msg.querySelector('.translation-text');
      if (!textNode) return;
      showingOriginal=!showingOriginal;
      textNode.textContent=showingOriginal ? original : translated;
      toggle.textContent=showingOriginal ? 'Translation' : 'Original';
      label.textContent=showingOriginal ? 'Original' : 'Translated';
    });
    box.append(toggle,label);
    msg.appendChild(box);
  }

  async function processMessages() {
    if (!LANGS.includes(preferred) || preferred === 'en') return;
    const root=document.getElementById('messages');
    if (!root) return;
    const nodes=root.querySelectorAll('.msg');
    for (const msg of nodes) {
      if (msg.dataset.translationReady === '1' || msg.dataset.translationBusy === '1') continue;
      const small=msg.querySelector('small');
      if (!small) continue;
      const original=msg.dataset.originalMessage || '';
      if (!original) continue;
      msg.dataset.translationBusy='1';
      const key=preferred+'|'+original;
      try {
        let translated=cache.get(key);
        if (!translated && !pending.has(key)) {
          pending.add(key);
          translated=await translate(original,preferred);
          pending.delete(key);
        }
        if (translated && translated !== original) {
          const text=msg.querySelector('.translation-text');
          if (text) { text.textContent=translated; addControls(msg,original,translated); }
        }
      } finally {
        msg.dataset.translationBusy='0';
        if (translated) msg.dataset.translationReady='1';
      }
    }
  }

  function captureOriginalMessages() {
    const root=document.getElementById('messages');
    if (!root) return;
    root.querySelectorAll('.msg').forEach(msg => {
      if (!msg.dataset.originalMessage) {
        const text=msg.querySelector('.translation-text');
        if (text) msg.dataset.originalMessage=text.textContent || '';
      }
    });
  }

  function startObserver() {
    if (observerStarted) return;
    const root=document.getElementById('messages');
    if (!root) return;
    observerStarted=true;
    const observer=new MutationObserver(() => { captureOriginalMessages(); processMessages(); });
    observer.observe(root,{childList:true,subtree:true});
    captureOriginalMessages(); processMessages();
  }

  async function init() {
    await loadPreferredLanguage();
    startObserver();
    setTimeout(() => { captureOriginalMessages(); processMessages(); }, 600);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
