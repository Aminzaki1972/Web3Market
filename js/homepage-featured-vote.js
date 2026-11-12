/* Web3Market community spotlight: the active approved project with the most positive votes. */
(function () {
  'use strict';
  function isHomepage() {
    var path = (window.location.pathname || '').replace(/\/+$/, '');
    return path === '' || path === '/' || path === '/index.html' || path.endsWith('/index.html');
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }
  function getClient() {
    return window.Web3MarketSupabase && window.Web3MarketSupabase.getClient
      ? window.Web3MarketSupabase.getClient()
      : (window.supabaseClient || window.web3marketSupabase || null);
  }
  function injectStyles() {
    if (document.getElementById('wm-community-spotlight-style')) return;
    var style = document.createElement('style');
    style.id = 'wm-community-spotlight-style';
    style.textContent = '.wm-community-spotlight{padding:26px 0 8px}.wm-community-spotlight .wm-spotlight-card{display:grid;grid-template-columns:180px 1fr;gap:22px;align-items:center;padding:22px;border:1px solid #dcd9ff;border-radius:20px;background:linear-gradient(120deg,#f7f6ff,#fff);box-shadow:0 12px 28px rgba(81,73,219,.08)}.wm-community-spotlight .wm-spotlight-image{width:100%;height:150px;object-fit:cover;border-radius:14px;background:#e9e7ff}.wm-community-spotlight .wm-spotlight-kicker{font-size:10px;font-weight:950;letter-spacing:1px;color:#5149db}.wm-community-spotlight h2{margin:7px 0;font-size:25px;color:#141820}.wm-community-spotlight p{margin:0;color:#667080;font-size:13px;line-height:1.65}.wm-community-spotlight .wm-spotlight-meta{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0;color:#168253;font-size:12px;font-weight:850}.wm-community-spotlight .wm-spotlight-link{display:inline-flex;align-items:center;justify-content:center;margin-top:4px;min-height:40px;padding:0 14px;border-radius:10px;background:#5149db;color:#fff;text-decoration:none;font-size:12px;font-weight:900}@media(max-width:620px){.wm-community-spotlight .wm-spotlight-card{grid-template-columns:1fr;padding:16px}.wm-community-spotlight .wm-spotlight-image{height:180px}.wm-community-spotlight h2{font-size:21px}}';
    document.head.appendChild(style);
  }
  async function render() {
    if (!isHomepage() || document.getElementById('wm-community-spotlight')) return;
    var sb = getClient();
    if (!sb || typeof sb.rpc !== 'function') return;
    try {
      var result = await sb.rpc('get_featured_project_by_votes');
      if (result.error) throw result.error;
      var project = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!project || !project.id || Number(project.positive_count) < 1) return;
      var host = document.querySelector('.browse') || document.querySelector('.listings') || document.querySelector('main');
      if (!host) return;
      injectStyles();
      var section = document.createElement('section');
      section.id = 'wm-community-spotlight';
      section.className = 'wm-community-spotlight wrap';
      var image = project.cover_image_url || project.logo_url || '';
      var positive = Number(project.positive_count || 0);
      var negative = Number(project.negative_count || 0);
      var total = Number(project.total_votes || 0);
      var description = project.short_description || project.description || 'Explore this community-rated project on Web3Market.';
      section.innerHTML = '<div class="wm-spotlight-card">' +
        (image ? '<img class="wm-spotlight-image" src="'+escapeHtml(image)+'" alt="" loading="lazy">' : '<div class="wm-spotlight-image" aria-hidden="true"></div>') +
        '<div><div class="wm-spotlight-kicker">COMMUNITY SPOTLIGHT · MOST POSITIVE VOTES</div>' +
        '<h2>'+escapeHtml(project.title || 'Community-rated project')+'</h2>' +
        '<p>'+escapeHtml(String(description).slice(0,240))+'</p>' +
        '<div class="wm-spotlight-meta"><span>👍 '+positive+' positive</span><span>👎 '+negative+' negative</span><span>'+total+' total votes</span></div>' +
        '<a class="wm-spotlight-link" href="project.html?id='+encodeURIComponent(project.id)+'">View project →</a>' +
        '</div></div>';
      if (host === document.querySelector('.browse')) host.insertAdjacentElement('beforebegin', section);
      else host.insertAdjacentElement('afterbegin', section);
    } catch (error) {
      console.warn('Web3Market community spotlight unavailable:', error);
    }
  }
  function boot() {
    render();
    setTimeout(render, 1000);
    setTimeout(render, 2500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
