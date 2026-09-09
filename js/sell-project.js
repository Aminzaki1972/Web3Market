// sell-project.js — robust form collection/save for Web3Market
(() => {
  const SUPABASE_URL = 'https://hzhqlexnhtukfljcvnyd.supabase.co';
  const SUPABASE_KEY = window.SUPABASE_PUBLISHABLE_KEY || window.SUPABASE_ANON_KEY || '';
  const numericFields = ['price','asking_price','year_created','monthly_revenue','yearly_revenue','monthly_profit','yearly_profit','monthly_net_profit','yearly_net_profit','monthly_expenses','total_sales','monthly_volume','active_users','customers_count','monthly_visits','users_count','ai_score','growth_rate','conversion_rate'];

  function normalizeNumber(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim().replace(/%/g, '').replace(/,/g, '');
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function normalizePayload(p) {
    numericFields.forEach(k => { if (Object.prototype.hasOwnProperty.call(p, k)) p[k] = normalizeNumber(p[k]); });
    if (p.last_active_date === '') p.last_active_date = null;
    return p;
  }

  const form = document.querySelector('form');
  if (!form) return;
  const value = name => { const el = form.querySelector(`[name="${name}"]`); return el ? el.value : ''; };

  function collect() {
    const p = {};
    form.querySelectorAll('input[name],select[name],textarea[name]').forEach(el => {
      if (el.type === 'checkbox') p[el.name] = el.checked;
      else if (el.type === 'number') p[el.name] = normalizeNumber(el.value);
      else p[el.name] = el.value;
    });
    normalizePayload(p);
    p.price = normalizeNumber(value('asking_price') || p.asking_price || p.price);
    p.performance = {
      users_count: p.users_count,
      active_users: p.active_users,
      customers_count: p.customers_count,
      monthly_visits: p.monthly_visits,
      total_sales: p.total_sales,
      monthly_volume: p.monthly_volume,
      growth_rate: p.growth_rate,
      conversion_rate: p.conversion_rate
    };
    p.financials = {
      monthly_revenue: p.monthly_revenue,
      yearly_revenue: p.yearly_revenue,
      monthly_profit: p.monthly_profit,
      yearly_profit: p.yearly_profit,
      monthly_net_profit: p.monthly_net_profit,
      yearly_net_profit: p.yearly_net_profit,
      monthly_expenses: p.monthly_expenses
    };
    delete p.users_count;
    delete p.currency_code;
    return normalizePayload(p);
  }

  function saveLocal() {
    try { localStorage.setItem('web3market_sell_project_draft', JSON.stringify(collect())); } catch (_) {}
  }

  form.addEventListener('input', saveLocal);
  form.addEventListener('change', saveLocal);
  window.addEventListener('beforeunload', saveLocal);

  async function getClient() {
    if (window.supabaseClient) return window.supabaseClient;
    if (!window.supabase || !SUPABASE_KEY) return null;
    window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    return window.supabaseClient;
  }

  async function saveDraft() {
    const client = await getClient();
    if (!client) throw new Error('Supabase client is not available');
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('Please sign in first');
    const p = collect();
    p.owner_id = user.id;
    p.status = p.status || 'draft';
    delete p.id;
    const existingId = localStorage.getItem('web3market_sell_project_id');
    let result;
    if (existingId) result = await client.from('projects').update(p).eq('id', existingId).eq('owner_id', user.id).select().single();
    else result = await client.from('projects').insert(p).select().single();
    if (result.error) throw result.error;
    if (result.data?.id) localStorage.setItem('web3market_sell_project_id', result.data.id);
    return result.data;
  }

  const saveBtn = form.querySelector('[type="submit"],#saveDraft,#save-draft');
  if (saveBtn) saveBtn.addEventListener('click', async e => {
    e.preventDefault();
    try {
      saveLocal();
      await saveDraft();
      alert('Draft saved successfully.');
    } catch (err) {
      console.error('Web3Market Save Draft error:', err, collect());
      alert((err && err.message) ? err.message : 'Could not save draft. Your form is also saved on this device.');
    }
  });
})();
