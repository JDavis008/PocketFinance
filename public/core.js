/* PocketFinance web app: shared helpers, API, router, drawer, charts. */
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const VIEWS = {};
const STATE = { cats: [], accounts: [], charts: [] };

try { const th = localStorage.getItem('pp-theme'); if (th) document.documentElement.dataset.theme = th; } catch {}

function money(n, { sign = false, cents = true, abs = false } = {}) {
  const v = Number(n) || 0;
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  if (abs) return '$' + s;
  if (sign) return (v > 0 ? '+$' : v < 0 ? '−$' : '$') + s;
  return (v < 0 ? '−$' : '$') + s;
}
const short = n => { const v = Math.abs(n); const s = v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e4 ? (v / 1e3).toFixed(0) + 'k' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : v.toFixed(0); return (n < 0 ? '−$' : '$') + s; };
const txAmt = n => `<span class="${n > 0 ? 'pos' : ''} num">${n > 0 ? '+' : ''}${money(Math.abs(n))}</span>`;
const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayISO = () => iso(new Date());
const fdate = (s, o = { month: 'short', day: 'numeric' }) => (s ? pd(s).toLocaleDateString('en-US', o) : '');
const fmonth = m => pd(m + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const shiftMonth = (m, n) => { const d = pd(m + '-01'); d.setMonth(d.getMonth() + n); return iso(d).slice(0, 7); };
const relDay = s => { const diff = Math.round((pd(s) - pd(todayISO())) / 864e5); return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : diff > 1 && diff < 7 ? `In ${diff} days` : fdate(s); };
const CAD_LABEL = { weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', quarterly: 'Quarterly', semiannual: 'Every 6 months', annual: 'Yearly' };
const TYPE_LABEL = { depository: 'Cash', credit: 'Credit cards', loan: 'Loans', investment: 'Investments', crypto: 'Crypto', property: 'Real estate', vehicle: 'Vehicles', other: 'Other assets' };
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const catIcon = name => (STATE.cats.find(c => c.name === name) || {}).icon || '🏷️';
const catColor = name => (STATE.cats.find(c => c.name === name) || {}).color || '#94a3b8';

async function api(path, { method = 'GET', body } = {}, retried = false) {
  const res = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', 'X-PP': '1' }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && !path.startsWith('/auth')) {
    if (!retried && await autoLogin()) return api(path, { method, body }, true); // the phone app signs itself back in
    showAuth(); throw new Error('Signed out');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastT;
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), ms); }
async function run(btn, fn, okMsg) {
  const old = btn && btn.textContent; if (btn) { btn.disabled = true; btn.textContent = 'Working…'; }
  try { const r = await fn(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); return r; }
  catch (e) { toast(e.message, 4500); throw e; }
  finally { if (btn) { btn.disabled = false; btn.textContent = old; } }
}

// ---------- drawer ----------
function openDrawer(html, mount) {
  $('#drawerBody').innerHTML = html; $('#drawer').classList.remove('hidden');
  if (mount) mount($('#drawerBody'));
}
function closeDrawer() { $('#drawer').classList.add('hidden'); $('#drawerBody').innerHTML = ''; }
document.addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target.classList.contains('drawer-bg')) closeDrawer(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

// ---------- charts ----------
function chart(canvas, cfg) {
  if (!window.Chart || !canvas) return null;
  const grid = cssVar('--border'), text = cssVar('--muted');
  Chart.defaults.color = text; Chart.defaults.font.family = cssVar('--font');
  const o = cfg.options || {};
  cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: { duration: 300 } }, o, {
    plugins: Object.assign({ legend: { display: false }, tooltip: { mode: 'index', intersect: false } }, o.plugins || {}) });
  if (cfg.type !== 'doughnut') {
    cfg.options.scales = cfg.options.scales || {};
    for (const ax of ['x', 'y']) cfg.options.scales[ax] = Object.assign({ grid: { color: grid, drawTicks: false }, border: { display: false }, ticks: { padding: 6 } }, cfg.options.scales[ax] || {});
    cfg.options.interaction = { mode: 'index', intersect: false };
  }
  const c = new Chart(canvas, cfg); STATE.charts.push(c); return c;
}
const moneyTick = { callback: v => short(v) };
// vertical gradient fill for line charts (hex colors)
const gradFill = (hex, top = '66', bottom = '00') => ctx => {
  const { ctx: c, chartArea: a } = ctx.chart; if (!a) return hex + '22';
  const g = c.createLinearGradient(0, a.top, 0, a.bottom); g.addColorStop(0, hex + top); g.addColorStop(1, hex + bottom); return g;
};
function clearCharts() { STATE.charts.forEach(c => c.destroy()); STATE.charts = []; }

// ---------- shared pickers ----------
async function loadCats(force) { if (!STATE.cats.length || force) STATE.cats = await api('/categories'); return STATE.cats; }
function catOptions(sel, { any = false } = {}) {
  const groups = {}; STATE.cats.forEach(c => (groups[c.grp] ||= []).push(c));
  return (any ? '<option value="">All categories</option>' : '') + Object.entries(groups).map(([g, cs]) =>
    `<optgroup label="${esc(g)}">${cs.map(c => `<option value="${esc(c.name)}" ${c.name === sel ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('')}</optgroup>`).join('');
}
function acctOptions(sel, list = STATE.accounts, { any = false } = {}) {
  return (any ? '<option value="">All accounts</option>' : '') + list.map(a => `<option value="${a.id}" ${String(a.id) === String(sel) ? 'selected' : ''}>${esc(a.name)}${a.mask ? ' ••' + esc(a.mask) : ''}</option>`).join('');
}
// Minimal, safe markdown for AI answers (escapes first, then formats).
function md(src) {
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const out = []; let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of String(src || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { close(); continue; }
    if ((m = line.match(/^#{1,4}\s+(.*)/))) { close(); out.push(`<h4>${inline(m[1])}</h4>`); continue; }
    if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    close(); out.push(`<p>${inline(line)}</p>`);
  }
  close(); return out.join('');
}
const formData = form => Object.fromEntries(new FormData(form).entries());

// ---------- auth ----------
// Inside the PocketFinance phone app: a device key (kept by the app, one per server) signs you in automatically.
const PFAPP = window.PocketFinanceApp;
const canRemember = () => !!(PFAPP && typeof PFAPP.saveToken === 'function');
let serverIdCache = '';
async function serverId() {
  if (!serverIdCache) try { serverIdCache = (await fetch('/api/hello').then(r => r.json())).id || ''; } catch {}
  return serverIdCache;
}
async function autoLogin() {
  if (!canRemember()) return false;
  try { if (sessionStorage.getItem('pf-signed-out')) return false; } catch {}
  const id = await serverId(), token = id && PFAPP.getToken(id);
  if (!token) return false;
  const r = await fetch('/api/auth/device-login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PP': '1' }, body: JSON.stringify({ token }) }).catch(() => null);
  if (r && r.ok) return true;
  if (r && r.status === 401) PFAPP.clearToken(id); // key was revoked (password changed, or removed in Settings)
  return false;
}
async function rememberThisPhone() {
  if (!canRemember()) return;
  try {
    const name = typeof PFAPP.deviceName === 'function' ? PFAPP.deviceName() : 'Phone';
    const r = await api('/auth/device', { method: 'POST', body: { name } });
    PFAPP.saveToken(r.server, r.token); serverIdCache = r.server;
  } catch {}
}
async function signOut() {
  const id = canRemember() ? await serverId() : '', token = id ? PFAPP.getToken(id) : '';
  await api('/auth/logout', { method: 'POST', body: token ? { device_token: token } : {} }).catch(() => {});
  if (token) PFAPP.clearToken(id);
  try { sessionStorage.setItem('pf-signed-out', '1'); } catch {}
  showAuth(false);
}
function showAuth(setup) {
  $('#shell').classList.add('hidden'); $('#auth').classList.remove('hidden');
  $('#codeForm').classList.add('hidden'); $('#authForm').classList.remove('hidden');
  if (setup !== undefined) {
    $('#authPw2').classList.toggle('hidden', !setup); $('#authPw2').required = !!setup;
    $('#authEmail').classList.toggle('hidden', !setup); $('#authLinks').classList.toggle('hidden', !!setup);
    $('#authBtn').textContent = setup ? 'Create password' : 'Sign in';
    $('#authMsg').textContent = setup ? 'Welcome! Create a password to protect your financial data.' : 'Your money, all in one place.';
    $('#authForm').dataset.mode = setup ? 'setup' : 'login';
  }
  if (!PFAPP) setTimeout(() => $('#authPw').focus(), 50); // in the phone app, don't pop the keyboard (it would also cover the lock screen)
}
$('#authForm').addEventListener('submit', async e => {
  e.preventDefault(); $('#authErr').textContent = '';
  const setup = $('#authForm').dataset.mode === 'setup';
  const pw = $('#authPw').value;
  if (setup && pw !== $('#authPw2').value) { $('#authErr').textContent = "Passwords don't match."; return; }
  try {
    await api(setup ? '/auth/setup' : '/auth/login', { method: 'POST', body: setup ? { password: pw, email: $('#authEmail').value.trim() } : { password: pw } }); $('#authPw').value = $('#authPw2').value = '';
    try { sessionStorage.removeItem('pf-signed-out'); } catch {}
    await rememberThisPhone(); start();
  }
  catch (err) { $('#authErr').textContent = err.message; }
});

// "Forgot password?" and "Email me a sign-in code": email → 6-digit code (→ new password) → signed in
let codeMode = 'login', codeSent = false;
function showCodeForm(mode) {
  codeMode = mode; codeSent = false;
  $('#authForm').classList.add('hidden'); $('#codeForm').classList.remove('hidden');
  $('#codeMsg').textContent = mode === 'reset' ? "Enter the email on your account and we'll send a code to set a new password." : "Enter the email on your account and we'll send a code to sign in.";
  ['#codeNum', '#codePw', '#codePw2'].forEach(x => { $(x).classList.add('hidden'); $(x).value = ''; });
  $('#codeAgain').hidden = true; $('#codeErr').textContent = ''; $('#codeEmail').disabled = false;
  $('#codeGo').textContent = 'Email me a code';
  if (!PFAPP) setTimeout(() => $('#codeEmail').focus(), 50);
}
$('#forgotBtn').onclick = () => showCodeForm('reset');
$('#codeLink').onclick = () => showCodeForm('login');
$('#codeBack').onclick = () => showAuth(false);
async function sendCode() {
  const email = $('#codeEmail').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('#codeErr').textContent = 'Enter your email address.'; return false; }
  await api('/auth/email-code', { method: 'POST', body: { email, purpose: codeMode } });
  codeSent = true; $('#codeEmail').disabled = true;
  $('#codeMsg').textContent = `If ${email} is on this PocketFinance, a 6-digit code is on its way. It works for 15 minutes — check spam too.`;
  $('#codeNum').classList.remove('hidden');
  if (codeMode === 'reset') { $('#codePw').classList.remove('hidden'); $('#codePw2').classList.remove('hidden'); }
  $('#codeGo').textContent = codeMode === 'reset' ? 'Set new password' : 'Sign in'; $('#codeAgain').hidden = false;
  setTimeout(() => $('#codeNum').focus(), 50);
  return true;
}
$('#codeAgain').onclick = async () => { $('#codeErr').textContent = ''; try { await sendCode(); toast('New code sent'); } catch (err) { $('#codeErr').textContent = err.message; } };
$('#codeForm').addEventListener('submit', async e => {
  e.preventDefault(); $('#codeErr').textContent = '';
  const btn = $('#codeGo'); btn.disabled = true;
  try {
    if (!codeSent) { await sendCode(); return; }
    const code = $('#codeNum').value.replace(/\D/g, '');
    if (code.length !== 6) { $('#codeErr').textContent = 'Enter the 6-digit code from the email.'; return; }
    const body = { email: $('#codeEmail').value.trim(), code };
    if (codeMode === 'reset') {
      if ($('#codePw').value.length < 8) { $('#codeErr').textContent = 'Use at least 8 characters.'; return; }
      if ($('#codePw').value !== $('#codePw2').value) { $('#codeErr').textContent = "Passwords don't match."; return; }
      body.password = $('#codePw').value;
    }
    await api('/auth/email-login', { method: 'POST', body });
    try { sessionStorage.removeItem('pf-signed-out'); } catch {}
    if (codeMode === 'reset') toast('Password changed — you are signed in');
    await rememberThisPhone(); start();
  } catch (err) { $('#codeErr').textContent = err.message; }
  finally { btn.disabled = false; }
});

// ---------- router ----------
const TITLES = { advisor: 'AI Advisor', dashboard: 'Dashboard', accounts: 'Accounts', transactions: 'Transactions', recurring: 'Recurring', budgets: 'Budgets', spending: 'Spending',
  networth: 'Net worth', goals: 'Savings goals', review: 'Review', reports: 'Reports', debt: 'Debt payoff', retire: 'Retirement', invest: 'Investments', watch: 'Watchlists', leaks: 'Money leaks', negotiate: 'Lower my bills', credit: 'Credit score', owed: 'Split & IOUs', family: 'Family', settings: 'Settings', more: 'More' };
function route() {
  const [name, query] = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?');
  const v = VIEWS[name] ? name : 'dashboard';
  $$('[data-r]').forEach(a => a.classList.toggle('on', a.dataset.r === v));
  $('#title').textContent = TITLES[v];
  document.title = `${TITLES[v]} · PocketFinance`;
  $('#shell').classList.remove('nav-open');
  clearCharts(); closeDrawer();
  // fresh container per render: if two renders overlap, the older one writes into a detached node
  const old = $('#view'), el = old.cloneNode(false); old.replaceWith(el);
  el.innerHTML = '<div class="empty muted">Loading…</div>';
  Promise.resolve(VIEWS[v](el, new URLSearchParams(query || ''))).catch(e => { if (e.message !== 'Signed out') el.innerHTML = `<div class="card empty">⚠️ ${esc(e.message)}</div>`; });
  window.scrollTo(0, 0);
  if (window.refreshReview) refreshReview();
}
window.addEventListener('hashchange', route);
$('#menuBtn').addEventListener('click', () => $('#shell').classList.toggle('nav-open'));
$('#syncBtn').addEventListener('click', async () => {
  const b = $('#syncBtn'); b.classList.add('spin');
  try { const r = await api('/sync', { method: 'POST' }); const errs = Object.values(r.results).filter(x => x.error).length; toast(errs ? `Synced with ${errs} problem(s) — see Accounts` : 'All accounts synced'); route(); refreshBell(); }
  catch (e) { toast(e.message); } finally { b.classList.remove('spin'); }
});

// ---------- alerts bell ----------
async function refreshBell() {
  try { const a = await api('/alerts'); const n = a.filter(x => !x.read).length; $('#bellCount').textContent = n; $('#bellCount').classList.toggle('hidden', !n); return a; } catch { return []; }
}
const ALERT_ICON = { watch: '👀', leak: '🕳️', recap: '🗓️', subscription: '🔄', price: '📈', cancel: '🚫', balance: '🪫', large: '💸', bill: '📅', budget: '🎯', connection: '🔌' };
$('#bellBtn').addEventListener('click', async () => {
  const a = await refreshBell();
  openDrawer(`<h2>Alerts</h2><div class="row between" style="margin-bottom:8px"><span class="muted small">${a.filter(x => !x.read).length} unread</span><button class="btn sm" id="readAll">Mark all read</button></div>
    <div class="list">${a.length ? a.map(x => `<a class="item" href="${esc(x.link || '#/dashboard')}" data-id="${x.id}" style="${x.read ? 'opacity:.6' : ''}">
      <div class="ico">${ALERT_ICON[x.type] || '🔔'}</div><div class="main"><div class="t">${esc(x.title)}</div><div class="s">${esc(x.body)}</div></div>
      <div class="small muted">${new Date(x.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div></a>`).join('') : '<div class="empty"><div class="big">🎉</div>No alerts</div>'}</div>`, el => {
    $('#readAll', el).onclick = async () => { await api('/alerts/read', { method: 'POST', body: {} }); refreshBell(); closeDrawer(); };
    $$('.item', el).forEach(i => i.addEventListener('click', () => api('/alerts/read', { method: 'POST', body: { id: Number(i.dataset.id) } }).then(refreshBell)));
  });
});

// Top-bar badge: "Admin" for the owner (the account that controls everything), name + access for household members.
function setWhoChip() {
  const u = STATE.user, chip = $('#whoChip'), admin = u.role === 'owner';
  const named = u.name && u.name !== 'Owner';
  chip.classList.remove('hidden');
  chip.classList.toggle('acc', admin); chip.classList.toggle('admin', admin);
  chip.title = admin ? 'Admin: you control household members, passwords, bank keys and network settings' : (u.role === 'view' ? 'View-only access' : 'Full access');
  chip.innerHTML = admin ? `<span class="ic">🛡️ </span>${named ? `<span class="nm">${esc(u.name)} · </span>` : ''}Admin`
    : u.role === 'view' ? `👁️ ${esc(u.name)} · view only` : `✏️ ${esc(u.name)}`;
}

async function start() {
  let s = await fetch('/api/auth/status').then(r => r.json());
  if (!s.authed && s.setup && await autoLogin()) s = await fetch('/api/auth/status').then(r => r.json());
  if (!s.authed) return showAuth(!s.setup);
  STATE.user = s.user || { role: 'owner' };
  setWhoChip();
  $('#auth').classList.add('hidden'); $('#shell').classList.remove('hidden');
  await loadCats(true);
  STATE.accounts = (await api('/accounts')).accounts;
  route(); refreshBell();
}
