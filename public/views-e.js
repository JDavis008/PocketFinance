/* Investments, Watchlists, Money leaks, Taxes tab (inside Reports), Household members. */
'use strict';

const CLASS_COLOR = { us: '#6d4aff', intl: '#0ea5a4', ca: '#e5484d', bonds: '#2f80ed', cash: '#94a3b8', crypto: '#e08a00', realestate: '#a16207', other: '#e0418f' };

// ======================= INVESTMENTS =======================
VIEWS.invest = async el => {
  const p = await api('/invest');
  if (!p.accounts.length) { el.innerHTML = `<div class="card empty"><div class="big">📈</div><strong>No investment accounts yet.</strong><div class="small muted" style="margin:6px 0 12px">Connect a brokerage or 401(k) through Plaid, add a crypto wallet, or add an account by hand.</div><a class="btn" href="#/accounts?add=1">+ Add account</a></div>`; return; }
  const F = p.fees;
  const feeCls = F.avgPct == null ? '' : F.avgPct <= 0.1 ? 'pos' : F.avgPct <= 0.5 ? '' : 'neg';
  el.innerHTML = `<div class="grid g4">
      <div class="card stat"><div class="label">Invested</div><div class="value num">${money(p.total, { cents: false })}</div><div class="sub">${p.change != null ? `<span class="${p.change >= 0 ? 'pos' : 'neg'}">${money(p.change, { sign: true, cents: false })}</span> over the past year` : `${p.accounts.length} account${p.accounts.length > 1 ? 's' : ''}`}</div></div>
      <div class="card stat"><div class="label">Gain on cost</div><div class="value num ${!p.gains ? '' : p.gains.gain >= 0 ? 'pos' : 'neg'}">${p.gains ? money(p.gains.gain, { sign: true, cents: false }) : '—'}</div><div class="sub">${p.gains ? `${p.gains.pct}% on ${money(p.gains.cost, { cents: false })} invested` : 'Your broker didn\'t share cost basis'}</div></div>
      <div class="card stat"><div class="label">Fees you pay</div><div class="value num ${feeCls}">${F.avgPct != null ? money(F.yearly, { cents: false }) + '<span class="small muted" style="font-weight:500">/yr</span>' : '—'}</div><div class="sub">${F.avgPct != null ? `Average expense ratio ${(+F.avgPct).toFixed(2)}%${F.avgPct <= 0.2 ? ' · nice and low ✓' : ''}` : 'Add fund tickers to see fees'}</div></div>
      <div class="card stat"><div class="label">Dividends &amp; interest</div><div class="value num pos">${money(p.dividends.total, { cents: false })}</div><div class="sub">last 12 months</div></div></div>
    <div class="grid invest-top" style="margin-top:16px"><div class="card"><h2>Asset mix</h2><div class="chart-box" style="height:220px"><canvas id="mix"></canvas></div>
        <div class="legend" style="margin-top:10px">${p.allocation.map(a => `<a><span class="legend-dot" style="background:${CLASS_COLOR[a.key]}"></span><span class="n">${a.label}</span><strong>${a.pct}%</strong></a>`).join('')}</div></div>
      <div class="card"><h2>Value over the past year</h2><div class="chart-box lg"><canvas id="ivh"></canvas></div></div></div>
    ${F.drag && F.drag.lost > 100 && F.avgPct > 0.2 ? `<div class="card banner-warn" style="margin-top:16px"><div style="font-size:26px">💸</div><div><strong>Fees could cost you ${money(F.drag.lost, { cents: false })} over 30 years.</strong>
      <div class="small muted">At ${(+F.avgPct).toFixed(2)}% a year, ${money(p.total, { cents: false })} grows to about ${money(F.drag.yours, { cents: false })} in 30 years (7% returns). In ${F.avgPct > 0.05 ? 'low-cost index funds (~0.05%)' : 'similar funds'} it would be about ${money(F.drag.cheap, { cents: false })}.</div></div></div>` : ''}
    <div class="card" style="margin-top:16px"><div class="card-h"><h2>Holdings</h2><span class="small muted">Expense ratio = yearly fee. Click one to correct it.</span></div>
      <table class="t"><thead><tr><th>Holding</th><th class="hide-sm">Account</th><th class="num">Value</th><th class="num hide-sm">Gain</th><th class="num">Fee</th></tr></thead><tbody>
      ${p.holdings.map(h => `<tr><td><strong>${esc(h.ticker || '')}</strong> <span class="small ${h.ticker ? 'muted' : ''}">${esc(h.name)}</span><div>${h.classes.map(c => `<span class="legend-dot" title="${c}" style="background:${CLASS_COLOR[c]}"></span>`).join('')}</div></td>
        <td class="hide-sm small muted">${esc(h.account)}</td><td class="num">${money(h.value, { cents: false })}<div class="small muted">${p.total ? (h.value / p.total * 100).toFixed(1) : 0}%</div></td>
        <td class="num hide-sm">${h.gain != null ? `<span class="${h.gain >= 0 ? 'pos' : 'neg'}">${money(h.gain, { sign: true, cents: false })}</span>` : '<span class="muted">—</span>'}</td>
        <td class="num">${h.ticker && !h.crypto && h.type !== 'cash' ? `<button class="btn sm fee-btn" data-t="${esc(h.ticker)}" data-v="${h.fee ?? ''}">${h.fee != null ? h.fee + '%' : 'Add'}</button>${h.feeYear ? `<div class="small muted">${money(h.feeYear, { cents: false })}/yr</div>` : ''}` : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table>
      ${F.unknown.length ? `<p class="small muted">No fee on file for ${F.unknown.map(esc).join(', ')} — tap <strong>Add</strong> and enter the expense ratio from the fund's page.</p>` : ''}</div>
    ${p.dividends.months.length ? `<div class="card" style="margin-top:16px"><h2>Dividends &amp; interest by month</h2><div class="chart-box"><canvas id="divc"></canvas></div></div>` : ''}
    <p class="small muted" style="margin-top:12px">Asset mix is estimated from fund names and tickers (target-date funds are split by their year). Holdings detail comes from Plaid; other accounts count as one block.</p>`;
  chart($('#mix', el), { type: 'doughnut', data: { labels: p.allocation.map(a => a.label), datasets: [{ data: p.allocation.map(a => a.value), backgroundColor: p.allocation.map(a => CLASS_COLOR[a.key]), borderWidth: 0, spacing: 2, borderRadius: 5 }] },
    options: { cutout: '68%', plugins: { tooltip: { callbacks: { label: c => `${c.label}: ${money(c.raw, { cents: false })}` } } } } });
  if (p.history.length > 1) chart($('#ivh', el), { type: 'line', data: { labels: p.history.map(h => fdate(h.date, { month: 'short', day: 'numeric' })), datasets: [{ data: p.history.map(h => h.value), borderColor: cssVar('--accent'), backgroundColor: gradFill(cssVar('--accent'), '44'), fill: true, pointRadius: 0, tension: .25, borderWidth: 2.5 }] },
    options: { scales: { y: { ticks: moneyTick }, x: { ticks: { maxTicksLimit: 8 } } }, plugins: { tooltip: { callbacks: { label: c => money(c.raw) } } } } });
  if ($('#divc', el)) chart($('#divc', el), { type: 'bar', data: { labels: p.dividends.months.map(m => fdate(m.m + '-01', { month: 'short', year: '2-digit' })), datasets: [{ data: p.dividends.months.map(m => m.v), backgroundColor: cssVar('--pos'), borderRadius: 5 }] },
    options: { scales: { y: { ticks: moneyTick } }, plugins: { tooltip: { callbacks: { label: c => money(c.raw) } } } } });
  $$('.fee-btn', el).forEach(b => b.onclick = () => openDrawer(`<h2>${esc(b.dataset.t)} expense ratio</h2><p class="small muted">The yearly fee in %, from the fund's page (e.g. 0.03 for VOO). Leave blank to use the built-in value.</p>
    <form class="form" id="feeF"><label class="f"><span>Expense ratio (%)</span><input name="pct" type="number" step="0.001" min="0" max="5" value="${esc(b.dataset.v)}"></label><button class="btn primary">Save</button></form>`, d => {
    $('#feeF', d).onsubmit = async e => { e.preventDefault(); await run(e.submitter, () => api('/invest/fee', { method: 'PUT', body: { ticker: b.dataset.t, pct: formData(e.target).pct } }), 'Saved'); closeDrawer(); route(); };
  }));
};

// ======================= WATCHLISTS =======================
VIEWS.watch = async el => {
  const list = await api('/watchlists');
  el.innerHTML = `<div class="toolbar"><span class="grow small muted">Keep an eye on spending at a store, in a category, or under a tag — with an optional monthly limit and an alert when you get close.</span><button class="btn primary" id="addW">+ Watch something</button></div>
    ${list.length ? `<div class="grid g3">${list.map(w => {
      const max = Math.max(...w.series.map(s => s.spent), w.monthly_limit || 0, 1);
      const pct = w.monthly_limit ? Math.min(100, w.spent / w.monthly_limit * 100) : null;
      return `<div class="card watch" data-id="${w.id}"><div class="row between"><div><div class="small muted">${{ merchant: '🏪 Store', category: '🏷️ Category', tag: '#️⃣ Tag' }[w.kind]}</div><h2 style="margin:2px 0 0">${esc(w.name)}</h2></div><button class="icon-btn" data-edit="${w.id}" title="Edit">⋯</button></div>
        <div class="row between" style="margin-top:10px;align-items:flex-end"><div><div class="value num" style="font-size:26px;font-weight:800">${money(w.spent, { cents: false })}</div><div class="small muted">this month · ${w.count} purchase${w.count === 1 ? '' : 's'}</div></div>
          <div class="small muted" style="text-align:right">${w.avg != null ? `usual ${money(w.avg, { cents: false })}/mo` : ''}${w.monthly_limit ? `<div>limit ${money(w.monthly_limit, { cents: false })}</div>` : ''}</div></div>
        ${pct != null ? `<div class="bar ${pct >= 100 ? 'over' : pct >= 80 ? 'near' : ''}" style="margin-top:8px"><span style="width:${pct}%"></span></div>` : ''}
        <div class="mini-bars">${w.series.map(s => `<div title="${fmonth(s.month)}: ${money(s.spent)}"><i style="height:${Math.max(2, s.spent / max * 100)}%"></i><span>${fdate(s.month + '-01', { month: 'narrow' })}</span></div>`).join('')}</div>
        <div class="list" style="margin-top:6px">${w.recent.slice(0, 3).map(t => `<div class="item small" data-tx="${t.id}"><div class="main"><div class="t">${esc(t.merchant)}</div><div class="s">${fdate(t.date)}</div></div><div class="amt">${txAmt(t.amount)}</div></div>`).join('')}</div></div>`; }).join('')}</div>`
      : '<div class="card empty"><div class="big">👀</div>Nothing watched yet. Try your coffee shop, takeout, or a tag like #vacation.</div>'}`;
  $('#addW', el).onclick = () => watchDrawer(null);
  $$('[data-edit]', el).forEach(b => b.onclick = () => watchDrawer(list.find(w => w.id === Number(b.dataset.edit))));
  $$('.watch [data-tx]', el).forEach(i => i.onclick = () => editTx(Number(i.dataset.tx), route));
};
async function watchDrawer(w) {
  if (w) return openDrawer(`<h2>${esc(w.name)}</h2><form class="form" id="wf"><label class="f"><span>Name</span><input name="name" value="${esc(w.name)}"></label>
    <label class="f"><span>Monthly limit (optional)</span><input name="monthly_limit" type="number" min="0" step="1" value="${w.monthly_limit ?? ''}"></label>
    <div class="row"><button class="btn primary">Save</button><span style="flex:1"></span><button type="button" class="btn danger" id="delW">Stop watching</button></div></form>`, d => {
    $('#wf', d).onsubmit = async e => { e.preventDefault(); await run(e.submitter, () => api('/watchlists/' + w.id, { method: 'PATCH', body: formData(e.target) }), 'Saved'); closeDrawer(); route(); };
    $('#delW', d).onclick = async () => { await api('/watchlists/' + w.id, { method: 'DELETE' }); closeDrawer(); route(); };
  });
  const [tags, top] = await Promise.all([loadTags(true), api('/reports/range?groupBy=merchant&from=' + iso(new Date(Date.now() - 90 * 864e5)))]);
  openDrawer(`<h2>Watch something</h2><form class="form" id="wf">
    <div class="seg" id="wk"><button type="button" data-k="merchant" class="on">Store</button><button type="button" data-k="category">Category</button><button type="button" data-k="tag">Tag</button></div>
    <label class="f"><span id="wvl">Store</span><select name="value" id="wv"></select></label>
    <label class="f"><span>Monthly limit (optional)</span><input name="monthly_limit" type="number" min="0" step="1" placeholder="e.g. 60"></label>
    <button class="btn primary">Start watching</button></form>`, d => {
    let kind = 'merchant';
    const opts = { merchant: top.groups.map(g => `<option value="${esc(g.key)}">${esc(g.name)} · ${money(g.total, { cents: false })} in 90 days</option>`).join('') || '<option value="">No purchases yet</option>',
      category: catOptions(''), tag: tags.map(t => `<option value="${esc(t.name)}">#${esc(t.name)}</option>`).join('') || '<option value="">No tags yet — add some to transactions first</option>' };
    const fill = () => { $('#wv', d).innerHTML = opts[kind]; $('#wvl', d).textContent = { merchant: 'Store', category: 'Category', tag: 'Tag' }[kind]; };
    $$('#wk button', d).forEach(b => b.onclick = () => { kind = b.dataset.k; $$('#wk button', d).forEach(x => x.classList.toggle('on', x === b)); fill(); });
    fill();
    $('#wf', d).onsubmit = async e => { e.preventDefault(); const f = formData(e.target); await run(e.submitter, () => api('/watchlists', { method: 'POST', body: { kind, value: f.value, monthly_limit: f.monthly_limit } }), 'Watching'); closeDrawer(); route(); };
  });
}

// ======================= MONEY LEAKS =======================
const LEAK_ICON = { fees: '🏦', interest: '💳', fx: '🌍', duplicate: '👯', newsub: '🆕', spike: '📈' };
VIEWS.leaks = async el => {
  const r = await api('/leaks');
  el.innerHTML = `<div class="card"><div class="row between wrap"><div><h2 style="margin:0">${r.items.length ? `${r.items.length} thing${r.items.length > 1 ? 's' : ''} worth a look` : 'No leaks found 🎉'}</h2>
      <div class="small muted">Bank fees, card interest, foreign fees, double charges, new subscriptions and spending spikes from the last 90 days.</div></div>
      ${r.yearlyTotal ? `<div style="text-align:right"><div class="small muted">Fees &amp; interest at this rate</div><div class="neg num" style="font-size:26px;font-weight:800">${money(r.yearlyTotal, { cents: false })}/yr</div></div>` : ''}</div></div>
    <div class="stack" style="margin-top:16px">${r.items.map(x => `<div class="card leak" data-key="${esc(x.key)}"><div class="row" style="gap:14px;align-items:flex-start"><div class="wr-ico">${LEAK_ICON[x.type]}</div>
      <div class="grow"><div class="row between wrap"><strong>${esc(x.title)}</strong><span class="num ${['fees', 'interest', 'fx', 'duplicate'].includes(x.type) ? 'neg' : ''}"><strong>${money(x.amount)}</strong>${x.yearly && x.type !== 'duplicate' ? ` <span class="small muted">· ~${money(x.yearly, { cents: false })}/yr</span>` : ''}</span></div>
        <div class="small muted" style="margin:4px 0 8px">${esc(x.tip)}</div>
        ${x.items ? `<div class="list">${x.items.map(t => `<div class="item small" data-tx="${t.id}"><div class="main"><div class="t">${esc(t.merchant)}</div><div class="s">${fdate(t.date)} · ${esc(t.account || '')}</div></div><div class="amt">${txAmt(t.amount)}</div></div>`).join('')}</div>` : ''}
        <div class="row" style="margin-top:8px">${x.link ? `<a class="btn sm" href="${x.link}">Open</a>` : ''}<button class="btn sm" data-dis="${esc(x.key)}">Dismiss</button></div></div></div></div>`).join('')}</div>`;
  $$('.leak [data-tx]', el).forEach(i => i.onclick = () => editTx(Number(i.dataset.tx), route));
  $$('[data-dis]', el).forEach(b => b.onclick = async () => { await api('/leaks/dismiss', { method: 'POST', body: { key: b.dataset.dis } }); b.closest('.leak').remove(); toast('Dismissed'); });
};

// ======================= TAXES (Reports tab) =======================
async function taxView(box, year, onYear) {
  const r = await api('/reports/tax?year=' + year);
  const years = [...new Set([...(r.years || []), r.year])].sort((a, b) => b - a);
  box.innerHTML = `<div class="toolbar"><select id="ty">${years.map(y => `<option ${y === r.year ? 'selected' : ''}>${y}</option>`).join('')}</select><span class="grow"></span><a class="btn" href="/api/export/tax.csv?year=${r.year}">⬇ CSV for your accountant</a></div>
    <div class="grid g3"><div class="card stat"><div class="label">Marked tax deductible</div><div class="value num">${money(r.total, { cents: false })}</div><div class="sub">${r.flagged.length} transaction${r.flagged.length === 1 ? '' : 's'}</div></div>
      <div class="card stat"><div class="label">Missing receipts</div><div class="value num ${r.missingReceipts ? 'neg' : 'pos'}">${r.missingReceipts}</div><div class="sub">attach them from each transaction</div></div>
      <div class="card stat"><div class="label">Income</div><div class="value num pos">${money(r.incomeTotal, { cents: false })}</div><div class="sub">${r.income.map(i => esc(i.name)).slice(0, 3).join(' · ') || '—'}</div></div></div>
    <div class="grid g2" style="margin-top:16px"><div class="card"><h2>Deductions by category</h2>${r.categories.length ? `<table class="t"><tbody>${r.categories.map(c => `<tr><td>${catIcon(c.name)} ${esc(c.name)}<div class="small muted">${c.n} items · ${c.receipts} with receipts</div></td><td class="num">${money(c.total)}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty small">Nothing marked yet. Open a transaction and tick <strong>Tax deductible</strong>.</div>'}</div>
      <div class="card"><h2>Worth reviewing</h2><p class="small muted" style="margin-top:0">Spending in categories that are often deductible, not marked yet.</p>${r.review.length ? `<div class="list">${r.review.map(c => `<a class="item" href="#/transactions?category=${encodeURIComponent(c.name)}&from=${r.year}-01-01&to=${r.year}-12-31"><div class="ico">${catIcon(c.name)}</div><div class="main"><div class="t">${esc(c.name)}</div><div class="s">${esc(c.hint)}</div></div><div class="amt num">${money(c.total, { cents: false })}<div class="small muted">${c.n} items</div></div></a>`).join('')}</div>` : '<div class="empty small">Nothing to review.</div>'}</div></div>
    ${r.flagged.length ? `<div class="card" style="margin-top:16px"><h2>Deductible transactions</h2><div class="list">${r.flagged.map(t => `<div class="item" data-tx="${t.id}"><div class="ico">${catIcon(t.category)}</div><div class="main"><div class="t">${esc(t.merchant)}${t.att ? ' 📎' : ''}</div><div class="s">${fdate(t.date, { month: 'short', day: 'numeric', year: 'numeric' })} · ${esc(t.category)}${t.notes ? ' · ' + esc(t.notes) : ''}</div></div><div class="amt num">${money(t.amount)}</div></div>`).join('')}</div></div>` : ''}
    <p class="small muted" style="margin-top:12px">A summary to bring to tax time — not tax advice.</p>`;
  $('#ty', box).onchange = e => onYear(Number(e.target.value));
  $$('[data-tx]', box).forEach(i => i.onclick = () => editTx(Number(i.dataset.tx), () => taxView(box, r.year, onYear)));
}

// ======================= HOUSEHOLD (Settings) =======================
async function householdCard(slot) {
  const h = await api('/members');
  slot.innerHTML = `<div class="card"><h2>👪 Household</h2><p class="small" style="margin-top:0">You're the <span class="pill acc">🛡️ Admin</span> of this PocketFinance — the only one who can add people, change passwords, bank and API keys, and network settings.</p><p class="small muted">Give a partner or family member their own password. <strong>Full</strong> access can edit; <strong>View only</strong> can look but not change anything. Bank keys, passwords and network settings stay yours.</p>
    <form class="form" id="ownF"><label class="f"><span>Your name</span><input name="owner_name" value="${esc(h.owner_name)}" placeholder="e.g. Alex"></label></form>
    <div class="list">${h.members.map(m => `<div class="item mem" style="cursor:default"><div class="ico">${m.role === 'full' ? '✏️' : '👁️'}</div><div class="main"><div class="t">${esc(m.name)} <span class="pill ${m.role === 'full' ? 'acc' : ''}">${m.role === 'full' ? 'Full access' : 'View only'}</span></div>
      <div class="s">${m.last_login ? 'Last signed in ' + new Date(m.last_login).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Has not signed in yet'}</div></div>
      <button class="btn sm" data-role="${m.id}" data-to="${m.role === 'full' ? 'view' : 'full'}">${m.role === 'full' ? 'Make view only' : 'Give full access'}</button><button class="btn sm danger" data-rm="${m.id}" data-n="${esc(m.name)}">Remove</button></div>`).join('') || '<div class="small muted">Just you so far.</div>'}</div>
    <form class="form" id="memF" style="margin-top:10px"><div class="two"><input name="name" placeholder="Their name" required maxlength="40"><input name="password" type="password" placeholder="Their password (8+)" required minlength="8" autocomplete="new-password"></div>
      <div class="row"><select name="role"><option value="view">View only</option><option value="full">Full access</option></select><button class="btn primary">Add person</button></div>
      <p class="small muted" style="margin:0">Everyone signs in on the same page with just their own password, so passwords must all be different.</p></form></div>`;
  $('#ownF input', slot).onchange = e => api('/settings', { method: 'PUT', body: { owner_name: e.target.value } }).then(() => { STATE.user.name = e.target.value.trim() || 'Owner'; setWhoChip(); toast('Saved'); });
  $('#memF', slot).onsubmit = async e => { e.preventDefault(); await run(e.submitter, () => api('/members', { method: 'POST', body: formData(e.target) }), 'Added — they can sign in now'); householdCard(slot); };
  $$('[data-role]', slot).forEach(b => b.onclick = async () => { await api('/members/' + b.dataset.role, { method: 'PATCH', body: { role: b.dataset.to } }); toast('Updated — they will need to sign in again'); householdCard(slot); });
  $$('[data-rm]', slot).forEach(b => b.onclick = async () => { if (!confirm(`Remove ${b.dataset.n}? They are signed out right away.`)) return; await api('/members/' + b.dataset.rm, { method: 'DELETE' }); householdCard(slot); });
}
// what household members see in Settings
function memberSettings(el) {
  const u = STATE.user || {};
  el.innerHTML = `<div class="grid g2"><div class="card"><h2>👋 ${esc(u.name || 'Household member')}</h2><p class="small muted">You're signed in with ${u.role === 'full' ? '<strong>full access</strong> — you can edit transactions, budgets and goals' : '<strong>view-only access</strong> — you can see everything but not change it'}. Bank connections, passwords and network settings are managed by the owner.</p>
      <div class="row wrap"><label class="f"><span>Theme</span><select id="theme"><option value="">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label></div>
      <button class="btn" id="logout" style="margin-top:10px">Sign out</button></div>
    <div id="connSlotM" class="span2"></div>
    <div class="card"><h2>💾 Data</h2><div class="row wrap"><a class="btn" href="/api/export/transactions.csv">Export transactions (CSV)</a></div></div></div>`;
  try { $('#theme', el).value = localStorage.getItem('pp-theme') || ''; } catch {}
  $('#theme', el).onchange = e => { const v = e.target.value; if (v) document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme; try { v ? localStorage.setItem('pp-theme', v) : localStorage.removeItem('pp-theme'); } catch {} };
  $('#logout', el).onclick = async () => { await api('/auth/logout', { method: 'POST' }); showAuth(false); };
  connectCard($('#connSlotM', el)).catch(() => {});
}
