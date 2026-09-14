/* Web3Market project image source-of-truth layer.
 * Images come only from the matching public.projects row.
 */
(function () {
  'use strict';

  const SUPABASE_URL = 'https://hzhqlexnhtukfljcvnyd.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI';

  function client() {
    return window.Web3MarketSupabase?.getClient?.() || window.supabaseClient || window.web3marketSupabase ||
      (window.supabase?.createClient ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null);
  }

  function values(value) {
    if (!value) return [];
    if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
    if (Array.isArray(value)) return value.flatMap(values);
    if (typeof value === 'object') return [value.url, value.src, value.image_url, value.cover_image_url, value.logo_url].flatMap(values);
    return [];
  }

  function listingImages(project) {
    if (!project) return [];
    return [...new Set([
      ...values(project.cover_image_url),
      ...values(project.logo_url),
      ...values(project.screenshots),
      ...values(project.assets)
    ])].filter((url) => {
      try { return ['http:', 'https:'].includes(new URL(url, location.href).protocol); } catch (_) { return false; }
    });
  }

  function setCardImage(card, url) {
    const art = card.querySelector('.listingArt');
    if (!art || !url) return;
    art.style.backgroundImage = `url("${String(url).replace(/"/g, '%22')}")`;
    art.style.backgroundSize = 'cover';
    art.style.backgroundPosition = 'center';
    art.style.backgroundColor = '#fff';
    art.classList.remove('a2', 'a3', 'a4');
    art.style.setProperty('--wm-no-generated-art', '1');
  }

  async function patchHomepage() {
    const cards = [...document.querySelectorAll('.listing[data-project-id]')];
    if (!cards.length) return;
    const sb = client();
    if (!sb) return;
    const ids = [...new Set(cards.map((c) => c.dataset.projectId).filter(Boolean))];
    const { data, error } = await sb.from('projects').select('id,cover_image_url,logo_url,screenshots,assets').in('id', ids);
    if (error || !Array.isArray(data)) return;
    const byId = new Map(data.map((p) => [String(p.id), p]));
    cards.forEach((card) => setCardImage(card, listingImages(byId.get(String(card.dataset.projectId)))[0]));
  }

  async function patchDetail() {
    const id = new URLSearchParams(location.search).get('id');
    if (!id || !document.getElementById('page')) return;
    const sb = client();
    if (!sb) return;
    const { data: project, error } = await sb.from('projects').select('id,title,cover_image_url,logo_url,screenshots,assets').eq('id', id).maybeSingle();
    if (error || !project) return;
    const images = listingImages(project);
    if (!images.length) return;
    const page = document.getElementById('page');
    const existing = document.getElementById('wm-project-listing-image');
    if (existing) return;
    const wrap = document.createElement('div');
    wrap.id = 'wm-project-listing-image';
    wrap.style.cssText = 'margin:0 0 24px;border-radius:18px;overflow:hidden;border:1px solid #e5e7eb;background:#fff;';
    const img = document.createElement('img');
    img.src = images[0];
    img.alt = project.title || 'Project';
    img.loading = 'eager';
    img.referrerPolicy = 'no-referrer';
    img.style.cssText = 'display:block;width:100%;max-height:440px;object-fit:cover;';
    wrap.appendChild(img);
    page.insertBefore(wrap, page.firstChild);
  }

  function boot() {
    patchHomepage().catch(() => {});
    patchDetail().catch(() => {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
  window.addEventListener('load', boot, { once: true });
  [800, 1800, 3500].forEach((ms) => setTimeout(boot, ms));

  window.Web3MarketProjectImages = { listingImages };
})();
