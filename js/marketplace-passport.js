(() => {
  'use strict';
  const SUPABASE_URL = 'https://hzhqlexnhtukfljcvnyd.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_lO7uEsiM0T8oeHB75DMxkA_287VZ9eI';
  const root = () => document.getElementById('passport');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  const show = html => { if (root()) root().innerHTML = html; };
  const headers = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, Accept: 'application/json' };
  const isUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const safeUrl = value => { try { const u = new URL(String(value || '')); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };
  const field = (label, value) => '<div class="item"><small>' + esc(label) + '</small><strong>' + esc(value || 'Not available') + '</strong></div>';
  async function findProject(query) {
    const q = query.trim();
    if (!q) return null;
    const select = 'id,title,description,short_description,full_description,category,website_url,github_url,technology_stack,blockchain,ai_score,status,project_status,ai_status,created_at,w3m_identity_id,verification';
    let url;
    if (isUuid(q)) {
      url = SUPABASE_URL + '/rest/v1/projects?id=eq.' + encodeURIComponent(q) + '&select=' + select + '&limit=1';
    } else {
      url = SUPABASE_URL + '/rest/v1/projects?title=ilike.' + encodeURIComponent('*' + q.replace(/[,*()]/g, ' ') + '*') + '&select=' + select + '&order=created_at.desc&limit=20';
    }
    const response = await fetch(url, { headers, cache: 'no-store' });
    if (!response.ok) throw new Error('Project lookup failed (' + response.status + ').');
    const rows = await response.json();
    const eligible = (Array.isArray(rows) ? rows : []).filter(p =>
      (isUuid(q) ? ['active', 'sold', 'archived'].includes(String(p.status || '').toLowerCase()) : ['active', 'sold'].includes(String(p.status || '').toLowerCase())) &&
      String(p.project_status || '').toLowerCase() === 'approved' &&
      String(p.ai_status || '').toLowerCase() === 'approved' &&
      p.verification?.ai?.test_mode !== true
    );
    if (isUuid(q)) return eligible[0] || null;
    const exact = eligible.find(p => String(p.title || '').trim().toLowerCase() === q.toLowerCase());
    return exact || (eligible.length === 1 ? eligible[0] : eligible.length ? { matches: eligible } : null);
  }
  async function identityFor(project) {
    if (!project.w3m_identity_id) return null;
    const url = SUPABASE_URL + '/rest/v1/project_identities?id=eq.' + encodeURIComponent(project.w3m_identity_id) + '&select=identity_code,first_seen_at,identity_status&limit=1';
    const response = await fetch(url, { headers, cache: 'no-store' });
    if (!response.ok) return null;
    const rows = await response.json();
    return rows?.[0] || null;
  }
  function renderProject(project, identity) {
    const projectStatus = String(project.status || '').toLowerCase();
    const state = projectStatus === 'sold' ? 'SOLD / COMPLETED' : projectStatus === 'archived' ? 'WITHDRAWN / ARCHIVED' : 'ACTIVE LISTING';
    const website = safeUrl(project.website_url);
    const github = safeUrl(project.github_url);
    let html = '<div class="passport-badge">Official Web3Market Project Passport</div>';
    html += '<section class="passport-card"><h2>' + esc(project.title || 'Web3Market Project') + '</h2><p>' + esc(project.description || 'Official project record from Web3Market.') + '</p><span class="status connected">' + state + '</span>';
    html += '<div class="identity">';
    html += field('W3M Identity', identity?.identity_code || 'Identity not assigned yet');
    html += field('Identity status', identity?.identity_status || 'Pending');
    html += field('First recorded', identity?.first_seen_at || project.created_at || 'Not available');
    html += field('Category', project.category);
    html += field('Technology', project.technology_stack);
    html += field('Blockchain', project.blockchain);
    html += field('AI score', project.ai_score == null ? '' : String(project.ai_score));
    html += field('AI review status', project.ai_status);
    html += '</div>';
    if (website) html += '<p><strong>Official website:</strong> <a href="' + esc(website) + '" target="_blank" rel="noopener noreferrer">' + esc(website) + '</a></p>';
    if (github) html += '<p><strong>GitHub:</strong> <a href="' + esc(github) + '" target="_blank" rel="noopener noreferrer">' + esc(github) + '</a></p>';
    html += '</section>';
    const summary = project.full_description || project.short_description || project.description;
    if (summary) html += '<section class="passport-card"><h2>Project Summary</h2><p>' + esc(summary) + '</p></section>';
    html += '<section class="passport-card"><h2>Technical Code Audit</h2><p>Technical audits remain a separate service. This Passport displays the project identity; audit reports and findings remain in the independent audit archive.</p><a class="view" href="code-audit.html">Open W3M AI Code Audit →</a></section>';
    html += '<section class="passport-card"><p class="muted">This Passport records the Web3Market project and listing state. AI scores are indicators, not a security guarantee. A sold or withdrawn listing does not erase the project identity.</p></section>';
    show(html);
  }
  async function load() {
    const input = document.getElementById('projectId');
    const query = String(input?.value || new URLSearchParams(location.search).get('id') || '').trim();
    if (!query) { show('<p class="muted">Enter a Web3Market project name or project ID. Only approved marketplace projects are eligible for an official Passport.</p>'); return; }
    show('<p class="muted">Checking the Web3Market marketplace records…</p>');
    try {
      const result = await findProject(query);
      if (result?.matches) {
        show('<section class="passport-card"><h2>More than one project matches</h2><p class="muted">Please enter the exact project name or its project ID.</p>' + result.matches.map(p => '<div class="finding"><strong>' + esc(p.title || 'Project') + '</strong><p><button type="button" data-project-id="' + esc(p.id) + '">Open Passport</button></p></div>').join('') + '</section>');
        root().querySelectorAll('[data-project-id]').forEach(button => button.addEventListener('click', () => { input.value = button.dataset.projectId; load(); }));
        return;
      }
      if (!result) { show('<section class="passport-card"><h2>No eligible marketplace project found</h2><p class="muted">Official Passports are available only for approved Web3Market listings. External websites and arbitrary project names cannot create a Passport here.</p><a class="view" href="marketplace.html">Browse the marketplace →</a></section>'); return; }
      const identity = await identityFor(result);
      renderProject(result, identity);
      const next = new URL(location.href); next.searchParams.set('id', result.id); history.replaceState({}, '', next.pathname + next.search);
    } catch (error) {
      show('<section class="passport-card"><h2>Passport could not be loaded</h2><p class="muted">' + esc(error?.message || 'Please retry later.') + '</p></section>');
    }
  }
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('loadBtn')?.addEventListener('click', load);
    document.getElementById('projectId')?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); load(); } });
    const id = new URLSearchParams(location.search).get('id');
    if (id) { const input = document.getElementById('projectId'); if (input) input.value = id; load(); }
  });
})();