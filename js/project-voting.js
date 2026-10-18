/* Web3Market community project voting — authenticated users only. */
(function () {
  'use strict';
  var projectId = new URLSearchParams(window.location.search).get('id');
  if (!projectId) return;
  var sectionId = 'wm-community-vote';
  var client = function () {
    return window.Web3MarketSupabase && window.Web3MarketSupabase.getClient
      ? window.Web3MarketSupabase.getClient()
      : (window.supabaseClient || window.web3marketSupabase || null);
  };
  var escapeHtml = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  };
  function ensureStyle() {
    if (document.getElementById('wm-community-vote-style')) return;
    var style = document.createElement('style');
    style.id = 'wm-community-vote-style';
    style.textContent = '#'+sectionId+'{max-width:1100px;margin:24px auto;padding:22px;border:1px solid #e1e5ed;border-radius:18px;background:#fff;box-shadow:0 8px 26px rgba(20,24,32,.05)}#'+sectionId+' h2{margin:0 0 6px;font-size:22px;color:#141820}#'+sectionId+' .wm-vote-sub{margin:0 0 16px;color:#737b88;font-size:13px}#'+sectionId+' .wm-vote-actions{display:grid;grid-template-columns:1fr 1fr;gap:12px}#'+sectionId+' .wm-vote-btn{display:flex;align-items:center;justify-content:center;gap:10px;min-height:64px;border:1px solid #dfe4eb;border-radius:13px;background:#f9fafb;color:#202631;font-weight:850;cursor:pointer}#'+sectionId+' .wm-vote-btn:disabled{opacity:.65;cursor:wait}#'+sectionId+' .wm-vote-btn[data-vote="1"]{border-color:#16a34a}#'+sectionId+' .wm-vote-btn[data-vote="-1"]{border-color:#dc2626}#'+sectionId+' .wm-vote-count{font-size:22px;font-weight:950}#'+sectionId+' .wm-vote-positive{color:#168253}#'+sectionId+' .wm-vote-negative{color:#c13c3c}#'+sectionId+' .wm-vote-meter{height:8px;margin-top:15px;border-radius:999px;overflow:hidden;background:#f0dada;display:flex}#'+sectionId+' .wm-vote-meter-positive{background:#16a34a;height:100%}#'+sectionId+' .wm-vote-message{margin:12px 0 0;color:#737b88;font-size:12px}#'+sectionId+' .wm-vote-login{color:#5149db;font-weight:850}@media(max-width:520px){#'+sectionId+'{margin:18px 12px;padding:16px}#'+sectionId+' .wm-vote-actions{grid-template-columns:1fr}}';
    document.head.appendChild(style);
  }
  async function readSummary(sb) {
    var result = await sb.rpc('get_project_vote_summary', { p_project_id: projectId });
    if (result.error) throw result.error;
    var row = Array.isArray(result.data) ? result.data[0] : result.data;
    return row || null;
  }
  function render(summary, signedIn, message) {
    var section = document.getElementById(sectionId);
    if (!section) return;
    var positive = Number(summary && summary.positive_count || 0);
    var negative = Number(summary && summary.negative_count || 0);
    var total = Number(summary && summary.total_votes || 0);
    var current = summary && summary.user_vote != null ? Number(summary.user_vote) : 0;
    var ratio = total ? Math.round(positive * 100 / total) : 0;
    section.innerHTML = '<h2>Community Project Rating</h2>' +
      '<p class="wm-vote-sub">Help the community discover promising projects. Community votes are opinions, not a security audit or a guarantee of quality.</p>' +
      '<div class="wm-vote-actions">' +
        '<button type="button" class="wm-vote-btn" data-vote="1" '+(!signedIn?'disabled':'')+' aria-label="Vote positive">' +
          '<span aria-hidden="true">👍</span><span>Positive</span><span class="wm-vote-count wm-vote-positive">'+positive+'</span>' +
        '</button>' +
        '<button type="button" class="wm-vote-btn" data-vote="-1" '+(!signedIn?'disabled':'')+' aria-label="Vote negative">' +
          '<span aria-hidden="true">👎</span><span>Negative</span><span class="wm-vote-count wm-vote-negative">'+negative+'</span>' +
        '</button>' +
      '</div>' +
      '<div class="wm-vote-meter" role="img" aria-label="'+ratio+' percent positive votes"><div class="wm-vote-meter-positive" style="width:'+ratio+'%"></div></div>' +
      '<p class="wm-vote-message" role="status">'+escapeHtml(message || (current ? 'Your vote is recorded. You can change it at any time.' : (signedIn ? 'One vote per account for each project. You can change your vote later.' : 'Sign in to vote. Visitors can view the totals, but only registered users can vote.')))+'</p>' +
      (!signedIn ? '<a class="wm-vote-login" href="login.html?next='+encodeURIComponent(window.location.pathname + window.location.search)+'">Sign in to vote</a>' : '') +
      '<p class="wm-vote-message">Total votes: <strong>'+total+'</strong> · '+ratio+'% positive</p>' +
      '<p class="wm-vote-message wm-community-spotlight-note"><strong>Community Spotlight:</strong> The project with the highest number of positive community votes may be featured on the Web3Market homepage. Only approved, active, non-test projects are eligible. Community votes are separate from AI analysis and security reviews.</p>';
    section.querySelectorAll('[data-vote]').forEach(function (button) {
      var vote = Number(button.getAttribute('data-vote'));
      button.disabled = !signedIn;
      button.setAttribute('aria-pressed', current === vote ? 'true' : 'false');
      if (current === vote) button.style.background = vote === 1 ? '#effaf3' : '#fff1f1';
      button.addEventListener('click', async function () {
        var activeClient = client();
        if (!activeClient || !signedIn) return;
        section.querySelectorAll('[data-vote]').forEach(function (b) { b.disabled = true; });
        var status = section.querySelector('[role="status"]');
        if (status) status.textContent = 'Saving your vote…';
        try {
          var result = await activeClient.rpc('cast_project_vote', { p_project_id: projectId, p_vote: vote });
          if (result.error) throw result.error;
          var row = Array.isArray(result.data) ? result.data[0] : result.data;
          render(row, true, 'Your vote has been saved. You can change it later.');
        } catch (error) {
          console.error('Web3Market project vote failed:', error);
          try { render(await readSummary(activeClient), true, 'Could not save your vote. Please try again.'); }
          catch (_) { render(summary, true, 'Could not save your vote. Please try again.'); }
        }
      });
    });
  }
  async function mount() {
    if (document.getElementById(sectionId)) return;
    var page = document.getElementById('page');
    if (!page || !page.textContent || /Loading project/i.test(page.textContent)) return;
    var sb = client();
    if (!sb) return;
    ensureStyle();
    var section = document.createElement('section');
    section.id = sectionId;
    section.setAttribute('aria-live', 'polite');
    page.insertAdjacentElement('afterend', section);
    try {
      var auth = await sb.auth.getUser();
      var signedIn = !!(auth && !auth.error && auth.data && auth.data.user && !auth.data.user.is_anonymous);
      var summary = await readSummary(sb);
      if (!summary) {
        section.remove();
        return;
      }
      render(summary, signedIn, '');
    } catch (error) {
      console.warn('Web3Market project voting unavailable:', error);
      section.innerHTML = '<h2>Community Project Rating</h2><p class="wm-vote-message">Community voting is temporarily unavailable.</p>';
    }
  }
  function boot() {
    var page = document.getElementById('page');
    if (!page) return;
    var observer = new MutationObserver(function () { mount(); });
    observer.observe(page, { childList: true, subtree: true, characterData: true });
    mount();
    setTimeout(mount, 800);
    setTimeout(mount, 2200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
