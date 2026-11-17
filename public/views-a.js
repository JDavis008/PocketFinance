/* Dashboard, Accounts (+ connecting), Transactions */
'use strict';

// ======================= DASHBOARD =======================
VIEWS.dashboard = async el => {
  const d = await api('/dashboard');
  const A = d.accounts;
  const noData = !STATE.accounts.length;
  const dayIdx = d.daily.current.length - 1;
  const spentNow = d.daily.current[dayIdx] || 0, spentPrevSame = d.daily.previous[Math.min(dayIdx, d.daily.previous.length - 1)] || 0;
  const diff = spentNow - spentPrevSame;
  const nw = d.netWorth; const nwChange = nw.length > 30 ? nw[nw.length - 1].net - nw[nw.length - 31].net : null;
  const hr = new Date().getHours();
  const hello = hr < 5 ? 'Good evening' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const util = A.utilization;
  const cats = d.topCategories; const catTotal = cats.reduce((s, c) => s + c.total, 0);
  const chip = date => { const n = Math.round((pd(date) - pd(todayISO())) / 864e5); const dt = pd(date); return `<div class="date-chip ${n <= 2 ? 'soon' : ''}"><small>${dt.toLocaleDateString('en-US', { month: 'short' })}</small><b>${dt.getDate()}</b></div>`; };
  el.innerHTML = `
  <div class="greet"><div><h2>${hello} 👋</h2><p>${pd(todayISO()).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · here's where your money stands.</p></div>
    ${noData ? '' : `<div class="row wrap">${d.review ? `<a class="btn" href="#/review">📥 ${d.review} to review</a>` : ''}<a class="btn primary" href="#/accounts?add=1">+ Add account</a></div>`}</div>
  ${noData ? `<div class="banner"><div style="font-size:28px">🚀</div><div class="grow"><strong>Welcome to PocketFinance.</strong><div class="small muted">Connect a bank, import a statement, or explore with sample data first.</div></div>
    <a class="btn primary" href="#/accounts?add=1">Connect an account</a><button class="btn" id="demoBtn">Try demo data</button></div>` : ''}
  <div id="qlSlot"></div>
  <div class="dash-top">
    <a class="hero" href="#/networth">
      <div class="row between"><span class="lbl">NET WORTH</span>${nwChange != null ? `<span class="chip">${nwChange >= 0 ? '▲' : '▼'} ${money(Math.abs(nwChange), { cents: false })} · 30 days</span>` : '<span class="chip">Tracking starts today</span>'}</div>
      <div class="big num">${money(A.netWorth, { cents: false })}</div>
      <div class="spark"><canvas id="nwSpark"></canvas></div>
      <div class="split"><div><span>Assets</span><strong class="num">${money(A.assets, { cents: false })}</strong></div><div><span>Debts</span><strong class="num">${money(A.liabilities, { cents: false })}</strong></div><div><span>Investments</span><strong class="num">${money(A.investments + A.crypto, { cents: false })}</strong></div></div>
    </a>
    <div class="card safe"><div class="card-h"><h2>Safe to spend</h2><a class="tile-link" href="#/recurring">Bills ›</a></div>
      <div class="amount num">${money(d.forecast.safeToSpend, { cents: false })}</div>
      <div class="small muted">Cash after ${money(d.forecast.billsBeforePay, { cents: false })} in bills due ${d.forecast.nextPaycheck ? 'before payday (' + relDay(d.forecast.nextPaycheck.date).toLowerCase() + ')' : 'in the next 30 days'}.</div>
      <div class="chart-box sm" style="margin-top:12px;height:130px"><canvas id="fcChart"></canvas></div>
      <div class="small muted">30-day low <strong class="${d.forecast.low < 0 ? 'neg' : ''}">${money(d.forecast.low, { cents: false })}</strong> on ${fdate(d.forecast.lowDate)}</div></div>
  </div>
  <div class="kpis">
    <a class="card kpi" href="#/accounts" style="--c:var(--teal)"><div class="badge">🏦</div><div class="label">Cash</div><div class="value num">${money(A.cash, { cents: false })}</div><div class="sub">Checking &amp; savings</div></a>
    <a class="card kpi" href="#/accounts" style="--c:var(--pink)"><div class="badge">💳</div><div class="label">Credit cards</div><div class="value num">${money(A.credit, { cents: false })}</div>
      ${util != null ? `<div class="meter"><i style="width:${Math.min(100, util)}%;${util > 30 ? 'background:var(--neg)' : ''}"></i></div><div class="sub">${util}% of limits used</div>` : '<div class="sub">Balance owed</div>'}</a>
    <a class="card kpi" href="#/spending" style="--c:var(--warn)"><div class="badge">🛍️</div><div class="label">Spent this month</div><div class="value num">${money(d.thisMonth.spending, { cents: false })}</div>
      <div class="sub"><span class="${diff > 0 ? 'neg' : 'pos'}">${diff > 0 ? '▲' : '▼'} ${money(Math.abs(diff), { cents: false })}</span> vs last month</div></a>
    <a class="card kpi" href="#/spending" style="--c:var(--pos)"><div class="badge">💵</div><div class="label">Income this month</div><div class="value num">${money(d.thisMonth.income, { cents: false })}</div>
      <div class="sub">Net <span class="${d.thisMonth.net >= 0 ? 'pos' : 'neg'}">${money(d.thisMonth.net, { sign: true, cents: false })}</span></div></a>
  </div>
  <div id="aiSlot" style="margin-top:16px"></div>
  ${recurringCard(d)}
  <div class="dash-mid">
    <div class="card"><div class="card-h"><h2>Spending pace</h2><div class="seg-legend"><span><i style="background:var(--accent)"></i>This month</span><span><i style="background:var(--muted);opacity:.6"></i>Last month</span></div></div>
      <div class="chart-box" style="height:260px"><canvas id="cumChart"></canvas></div></div>
    <div class="card"><div class="card-h"><h2>Where it went</h2><a class="tile-link" href="#/spending">Details ›</a></div>
      ${cats.length ? `<div class="ring-wrap"><div class="ring-box"><canvas id="catRing"></canvas><div class="ring-center"><div><strong class="num">${money(catTotal, { cents: false })}</strong><span>top ${cats.length}</span></div></div></div>
        <div class="legend">${cats.map(c => `<a href="#/transactions?category=${encodeURIComponent(c.name)}"><span class="legend-dot" style="background:${c.color}"></span><span class="n">${esc(c.name)}</span><strong>${money(c.total, { cents: false })}</strong></a>`).join('')}</div></div>`
        : '<div class="empty small">No spending yet this month.</div>'}</div>
  </div>
  <div class="grid g3" style="margin-top:16px">
    <div class="card"><div class="card-h"><h2>Upcoming</h2><a class="tile-link" href="#/recurring">Calendar ›</a></div>
      <div class="list">${d.upcoming.length ? d.upcoming.slice(0, 6).map(u => `<a class="item" href="#/recurring">${chip(u.date)}
        <div class="main"><div class="t">${esc(u.name)}</div><div class="s">${relDay(u.date)}${u.overdue ? ' · <span class="neg">late?</span>' : ''}</div></div><div class="amt">${u.kind === 'income' ? txAmt(u.amount) : money(u.amount)}</div></a>`).join('')
        : '<div class="empty small">No bills in the next 2 weeks.</div>'}</div></div>
    <div class="card"><div class="card-h"><h2>Budgets</h2><a class="tile-link" href="#/budgets">Manage ›</a></div>
      ${d.budgets.list.length ? `<div class="small muted" style="margin-bottom:4px">${money(d.budgets.spent, { cents: false })} of ${money(d.budgets.total, { cents: false })} used</div>` +
        d.budgets.list.sort((a, b) => b.pct - a.pct).slice(0, 4).map(b => budgetBar(b)).join('') : '<div class="empty small">No budgets yet. <a href="#/budgets">Create one</a></div>'}</div>
    <div class="stack">
      <a class="card kpi" href="#/recurring?tab=subscription" style="--c:var(--accent);display:block"><div class="row between"><div class="label">Subscriptions</div><span class="pill acc">${d.subs.count} recurring</span></div>
        <div class="value num">${money(d.subs.subscriptionsMonthly)}<span class="small muted" style="font-weight:500"> /mo</span></div>
        <div class="sub">${money(d.subs.subscriptionsMonthly * 12, { cents: false })} a year · bills ${money(d.subs.billsMonthly, { cents: false })}/mo</div></a>
      ${d.credit ? `<a class="card kpi" href="#/credit" style="--c:var(--sky);display:block"><div class="label">Credit score</div><div class="row"><span class="value">${d.credit.score}</span><span class="pill acc">${scoreBand(d.credit.score)}</span></div>
        <div class="meter"><i style="width:${Math.max(0, Math.min(100, (d.credit.score - 300) / 550 * 100))}%"></i></div><div class="sub">Updated ${fdate(d.credit.date)}</div></a>`
        : `<a class="card kpi" href="#/goals" style="--c:var(--pos);display:block"><div class="label">Savings goals</div><div class="value">🏁</div><div class="sub">Set a goal and track it</div></a>`}
      ${d.ious && d.ious.n ? `<a class="card kpi" href="#/owed" style="--c:var(--teal);display:block"><div class="row between"><div class="label">Split &amp; IOUs</div><span class="pill">${d.ious.n} open</span></div>
        <div class="value num pos">${money(d.ious.owed_me, { cents: false })}<span class="small muted" style="font-weight:500"> owed to you</span></div><div class="sub">${d.ious.i_owe ? `You owe ${money(d.ious.i_owe, { cents: false })}` : 'You owe nobody'}</div></a>` : ''}
    </div>
  </div>
  <div class="card" style="margin-top:16px"><div class="card-h"><h2>Recent activity</h2><a class="tile-link" href="#/transactions">See all ›</a></div>
    <div class="list">${d.recent.length ? d.recent.map(txRow).join('') : '<div class="empty small">No transactions yet.</div>'}</div></div>`;
  if ($('#demoBtn', el)) $('#demoBtn', el).onclick = e => run(e.target, async () => { await api('/demo/load', { method: 'POST' }); STATE.accounts = (await api('/accounts')).accounts; route(); refreshBell(); }, 'Demo data loaded');
  $$('.item[data-tx]', el).forEach(i => i.onclick = () => editTx(Number(i.dataset.tx), route));
  wireRecurringCard(el, d);
  loadAiCard($('#aiSlot', el));
  quickLoginBar($('#qlSlot', el)).catch(() => {});
  const acc = cssVar('--accent'), mut = cssVar('--muted'), pos = cssVar('--pos');
  const days = Array.from({ length: Math.max(d.daily.previous.length, 31) }, (_, i) => i + 1);
  const noAxes = { x: { display: false }, y: { display: false } };
  chart($('#nwSpark'), { type: 'line', data: { labels: nw.map(p => fdate(p.date)), datasets: [{ data: nw.map(p => p.net), borderColor: '#ffffff', backgroundColor: gradFill('#ffffff', '55', '00'), fill: true, pointRadius: 0, tension: .35, borderWidth: 2.5 }] },
    options: { scales: noAxes, plugins: { tooltip: { callbacks: { label: c => money(c.raw) } } } } });
  chart($('#cumChart'), { type: 'line', data: { labels: days, datasets: [
    { data: d.daily.current, borderColor: acc, backgroundColor: gradFill(acc, '55'), fill: true, tension: .35, pointRadius: 0, pointHoverRadius: 5, borderWidth: 3, label: 'This month' },
    { data: d.daily.previous, borderColor: mut + '99', borderDash: [6, 5], tension: .35, pointRadius: 0, borderWidth: 1.5, label: 'Last month' }] },
    options: { scales: { y: { beginAtZero: true, ticks: moneyTick, grid: { color: cssVar('--border') } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } } }, plugins: { tooltip: { callbacks: { title: i => `Day ${i[0].label}`, label: c => `${c.dataset.label}: ${money(c.raw)}` } } } } });
  chart($('#fcChart'), { type: 'line', data: { labels: d.forecast.points.map(p => fdate(p.date)), datasets: [{ data: d.forecast.points.map(p => p.balance), borderColor: pos, backgroundColor: gradFill(pos, '44'), fill: true, pointRadius: 0, tension: .3, borderWidth: 2.5 }] },
    options: { scales: noAxes, plugins: { tooltip: { callbacks: { label: c => money(c.raw) } } } } });
  if (cats.length) chart($('#catRing'), { type: 'doughnut', data: { labels: cats.map(c => c.name), datasets: [{ data: cats.map(c => c.total), backgroundColor: cats.map(c => c.color), borderWidth: 0, spacing: 3, borderRadius: 6 }] },
    options: { cutout: '74%', plugins: { tooltip: { callbacks: { label: c => `${c.label}: ${money(c.raw)}` } } } } });
};

// ---- Recurring payments card (dashboard) ----
function recurringCard(d) {
  const list = d.recurring || [];
  const monthEnd = iso(new Date(pd(todayISO()).getFullYear(), pd(todayISO()).getMonth() + 1, 0));
  const paid = list.filter(r => r.paidThisMonth).reduce((s, r) => s + r.amount, 0);
  const left = list.filter(r => !r.paidThisMonth && r.next_date && r.next_date <= monthEnd).reduce((s, r) => s + r.amount, 0);
  const total = list.reduce((s, r) => s + r.monthly, 0);
  const subs = list.filter(r => r.kind === 'subscription').length, bills = list.length - subs;
  return `<div class="card rec-card" style="margin-top:16px">
    <div class="card-h wrap"><div><h2>Recurring payments</h2><div class="small muted">${list.length} active · <strong class="num" style="color:var(--text)">${money(total)}</strong>/mo · ${money(total * 12, { cents: false })}/yr</div></div>
      <div class="row"><div class="seg" id="recF"><button class="on" data-k="all">All ${list.length}</button><button data-k="subscription">Subscriptions ${subs}</button><button data-k="bill">Bills ${bills}</button></div><a class="tile-link" href="#/recurring">Manage ›</a></div></div>
    ${list.length ? `<div class="rec-progress"><div class="row between small"><span><span class="pos">●</span> Paid this month <strong class="num">${money(paid, { cents: false })}</strong></span><span class="muted">Still due <strong class="num" style="color:var(--text)">${money(left, { cents: false })}</strong></span></div>
      <div class="bar" style="margin-top:6px;height:8px"><span style="width:${paid + left ? paid / (paid + left) * 100 : 0}%;background:linear-gradient(90deg,var(--pos),var(--teal))"></span></div></div>
      <div class="rec-grid" id="recList"></div><div id="recMore" style="text-align:center;margin-top:8px"></div>`
      : `<div class="empty small">No recurring payments found yet. They're detected automatically once an account has a couple of months of history — or <a href="#/recurring">add one manually</a>.</div>`}
  </div>`;
}
function recItem(r) {
  const n = Math.round((pd(r.next_date || todayISO()) - pd(todayISO())) / 864e5);
  const status = r.paidThisMonth ? `<span class="pill green">✓ Paid ${fdate(r.last_date)}</span>`
    : n < 0 ? `<span class="pill red">Overdue</span>` : n <= 3 ? `<span class="pill amber">${n === 0 ? 'Due today' : n === 1 ? 'Due tomorrow' : `Due in ${n} days`}</span>`
    : `<span class="pill">Due ${fdate(r.next_date)}</span>`;
  const up = r.prev_amount && r.amount > r.prev_amount;
  return `<a class="rec-item" href="#/recurring?tab=${r.kind}" style="--c:${esc(r.color || cssVar('--accent'))}"><div class="rec-ico">${r.icon || '🔄'}</div>
    <div class="main"><div class="t">${esc(r.name)}${up ? ` <span class="pill red" title="was ${money(r.prev_amount)}">↑</span>` : ''}</div><div class="s">${CAD_LABEL[r.cadence] || r.cadence}${r.account_name ? ' · ' + esc(r.account_name) : ''}</div></div>
    <div class="amt"><div class="num">${money(r.amount)}</div>${status}</div></a>`;
}
function wireRecurringCard(el, d) {
  const box = $('#recList', el); if (!box) return;
  let filter = 'all', expanded = false;
  const draw = () => {
    const rows = (d.recurring || []).filter(r => filter === 'all' || r.kind === filter);
    const shown = expanded ? rows : rows.slice(0, 8);
    box.innerHTML = shown.map(recItem).join('') || '<div class="empty small">None in this group.</div>';
    $('#recMore', el).innerHTML = rows.length > 8 ? `<button class="btn sm" id="recToggle">${expanded ? 'Show less' : `Show all ${rows.length}`}</button>` : '';
    if ($('#recToggle', el)) $('#recToggle', el).onclick = () => { expanded = !expanded; draw(); };
  };
  $$('#recF button', el).forEach(b => b.onclick = () => { filter = b.dataset.k; expanded = false; $$('#recF button', el).forEach(x => x.classList.toggle('on', x === b)); draw(); });
  draw();
}

function budgetBar(b) {
  const cls = b.pct >= 1 ? 'over' : b.pct >= .85 ? 'near' : '';
  return `<div class="budget-row" data-cat="${esc(b.category)}"><div class="row between small"><span><strong>${b.icon || ''} ${esc(b.category)}</strong></span>
    <span class="num ${b.remaining < 0 ? 'neg' : 'muted'}">${b.remaining < 0 ? money(-b.remaining, { cents: false }) + ' over' : money(b.remaining, { cents: false }) + ' left'}</span></div>
    <div class="bar ${cls}" style="margin-top:6px"><span style="width:${Math.min(100, b.pct * 100)}%"></span><i class="pace" style="left:${b.pace * 100}%"></i></div>
    <div class="small muted" style="margin-top:3px">${money(b.spent, { cents: false })} of ${money(b.limit, { cents: false })}${b.carry ? ` · ${b.carry > 0 ? '+' : ''}${money(b.carry, { cents: false })} rollover` : ''}</div></div>`;
}
const scoreBand = s => s >= 800 ? 'Excellent' : s >= 740 ? 'Very good' : s >= 670 ? 'Good' : s >= 580 ? 'Fair' : 'Poor';

function txRow(t) {
  const logo = t.logo ? `<img src="${esc(t.logo)}" alt="" referrerpolicy="no-referrer">` : (t.icon || catIcon(t.category));
  return `<div class="item" data-tx="${t.id}"><div class="ico">${logo}</div><div class="main"><div class="t">${esc(t.merchant)}${t.pending ? ' <span class="pill amber">Pending</span>' : ''}${t.excluded ? ' <span class="pill">Excluded</span>' : ''}${t.reviewed === 0 ? ' <span class="dot-new" title="Needs review"></span>' : ''} ${tagPills(t.tags)}</div>
    <div class="s">${esc(t.category)} · ${esc(t.account_name || '')}${t.att ? ' · 📎' + t.att : ''}${t.notes ? ' · 📝 ' + esc(t.notes) : ''}</div></div><div class="amt">${txAmt(t.amount)}<div class="s small muted">${fdate(t.date)}</div></div></div>`;
}

// ======================= ACCOUNTS =======================
VIEWS.accounts = async (el, q) => {
  const data = await api('/accounts'); STATE.accounts = data.accounts;
  const S = data.summary;
  const groups = {};
  data.accounts.forEach(a => (groups[a.type] ||= []).push(a));
  const order = ['depository', 'credit', 'investment', 'crypto', 'loan', 'property', 'vehicle', 'other'];
  const connBad = data.connections.filter(c => c.status === 'error');
  el.innerHTML = `
  <div class="toolbar"><button class="btn primary" id="addAcct">+ Add account</button><button class="btn" id="syncAll">Sync all</button><span class="grow"></span></div>
  ${connBad.map(c => `<div class="banner" style="background:color-mix(in srgb,var(--neg) 10%,transparent)"><div>🔌</div><div class="grow"><strong>${esc(c.name)}</strong><div class="small">${esc(c.error || 'Needs attention')}</div></div>
    ${['plaid', 'teller'].includes(c.provider) ? `<button class="btn sm" data-reconnect="${c.id}" data-prov="${c.provider}">Reconnect</button>` : ''}<button class="btn sm" data-sync="${c.id}">Retry</button></div>`).join('')}
  <div class="grid g4">
    <div class="card stat"><div class="label">Net worth</div><div class="value num">${money(S.netWorth, { cents: false })}</div></div>
    <div class="card stat"><div class="label">Assets</div><div class="value num pos">${money(S.assets, { cents: false })}</div></div>
    <div class="card stat"><div class="label">Liabilities</div><div class="value num neg">${money(S.liabilities, { cents: false })}</div></div>
    <div class="card stat"><div class="label">Investments + crypto</div><div class="value num">${money(S.investments + S.crypto, { cents: false })}</div></div>
  </div>
  ${data.accounts.length ? order.filter(t => groups[t]).map(t => {
    const total = groups[t].filter(a => !a.hidden).reduce((s, a) => s + a.balance, 0);
    return `<div class="card" style="margin-top:16px"><div class="card-h"><h2>${TYPE_LABEL[t]}</h2><strong class="num">${money(total)}</strong></div><div class="list">${groups[t].map(a => {
      const liab = a.meta && a.meta.liability;
      return `<div class="item" data-acct="${a.id}" style="${a.hidden ? 'opacity:.5' : ''}"><div class="ico">${{ depository: '🏦', credit: '💳', investment: '📈', crypto: '🪙', loan: '🏛️', property: '🏠', vehicle: '🚗' }[a.type] || '💼'}</div>
      <div class="main"><div class="t">${esc(a.name)}${a.mask ? ` <span class="muted">••${esc(a.mask)}</span>` : ''}${a.conn_status === 'error' ? ' <span class="pill red">Needs attention</span>' : ''}</div>
      <div class="s">${esc(a.institution || '')}${liab && liab.due_date ? ` · Payment due ${fdate(liab.due_date)}` : ''}${a.credit_limit && a.type === 'credit' ? ` · ${Math.round(a.balance / a.credit_limit * 100)}% of ${money(a.credit_limit, { cents: false })}` : ''}${a.last_sync ? ` · synced ${new Date(a.last_sync).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : a.manual ? ' · manual' : ''}</div></div>
      <div class="amt num">${money(a.balance)}</div></div>`; }).join('')}</div></div>`; }).join('')
  : `<div class="card empty" style="margin-top:16px"><div class="big">🏦</div><p>No accounts yet.</p><button class="btn primary" id="addAcct2">Add your first account</button></div>`}
  ${data.connections.length ? `<div class="card" style="margin-top:16px"><div class="card-h"><h2>Connections</h2></div><table class="t"><thead><tr><th>Source</th><th>Status</th><th>Last sync</th><th></th></tr></thead><tbody>
    ${data.connections.map(c => `<tr><td><strong>${esc(c.name)}</strong><div class="small muted">${esc({ plaid: 'Plaid', teller: 'Teller', simplefin: 'SimpleFIN', crypto: 'Crypto', file: 'File imports', demo: 'Demo data' }[c.provider] || c.provider)}</div></td>
    <td>${c.status === 'error' ? `<span class="pill red">Error</span>` : '<span class="pill green">OK</span>'}${c.error && c.status !== 'error' ? `<div class="small warn">${esc(c.error)}</div>` : ''}</td>
    <td class="small muted">${c.last_sync ? new Date(c.last_sync).toLocaleString() : '—'}</td>
    <td style="text-align:right;white-space:nowrap">${['plaid', 'teller', 'simplefin', 'crypto'].includes(c.provider) ? `<button class="btn sm" data-sync="${c.id}">Sync</button>` : ''}
      ${['plaid', 'teller'].includes(c.provider) ? `<button class="btn sm" data-reconnect="${c.id}" data-prov="${c.provider}">Reconnect</button>` : ''}<button class="btn sm danger" data-remove="${c.id}">Remove</button></td></tr>`).join('')}</tbody></table></div>` : ''}`;
  $('#addAcct', el).onclick = addAccountDrawer;
  if ($('#addAcct2', el)) $('#addAcct2', el).onclick = addAccountDrawer;
  $('#syncAll', el).onclick = () => $('#syncBtn').click();
  $$('[data-acct]', el).forEach(i => i.onclick = () => accountDrawer(data.accounts.find(a => a.id === Number(i.dataset.acct))));
  $$('[data-sync]', el).forEach(b => b.onclick = () => run(b, () => api(`/connections/${b.dataset.sync}/sync`, { method: 'POST' }), r => r.error ? r.error : `Synced · ${r.added || 0} new`).then(route));
  $$('[data-reconnect]', el).forEach(b => b.onclick = () => (b.dataset.prov === 'teller' ? tellerLink : plaidLink)(Number(b.dataset.reconnect)));
  $$('[data-remove]', el).forEach(b => b.onclick = async () => {
    if (!confirm('Remove this connection and all of its accounts and transactions from PocketFinance?')) return;
    await run(b, () => api(`/connections/${b.dataset.remove}`, { method: 'DELETE' }), 'Removed'); STATE.accounts = (await api('/accounts')).accounts; route();
  });
  if (q.get('add')) addAccountDrawer();
};

// addAccountDrawer (popular-bank picker) lives in views-c.js

let plaidScript;
async function plaidLink(connectionId) {
  const st = await api('/plaid/status');
  if (!st.configured) {
    return openDrawer(`<h2>Set up Plaid</h2><p>Plaid securely links PocketFinance to your bank. It needs free API keys:</p>
      <ol class="small"><li>Create an account at <a href="https://dashboard.plaid.com/signup" target="_blank" rel="noopener">dashboard.plaid.com</a>.</li>
      <li>Open <strong>Developers → Keys</strong> and copy your <em>client_id</em> and <em>Sandbox</em> secret (for testing) or <em>Production</em> secret (for real banks — request Production access in the dashboard; personal use is free for a limited number of connections).</li>
      <li>Paste them in <a href="#/settings">Settings → Integrations</a>.</li></ol>
      <p class="small muted">Until then you can use SimpleFIN, file import, or demo data.</p><a class="btn primary" href="#/settings">Open Settings</a>`);
  }
  toast('Opening secure bank login…');
  if (!plaidScript) plaidScript = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'; s.onload = res; s.onerror = () => rej(new Error('Could not load Plaid Link (offline?)')); document.head.appendChild(s); });
  try {
    await plaidScript;
    const { link_token } = await api('/plaid/link-token', { method: 'POST', body: { connectionId } });
    const handler = Plaid.create({
      token: link_token,
      onSuccess: async (public_token, meta) => {
        closeDrawer(); toast('Importing transactions… this can take a minute', 8000);
        try {
          if (connectionId) await api('/plaid/reconnected', { method: 'POST', body: { connectionId } });
          else await api('/plaid/exchange', { method: 'POST', body: { public_token, institution: meta.institution } });
          STATE.accounts = (await api('/accounts')).accounts; toast(`${meta.institution ? meta.institution.name : 'Bank'} connected`); location.hash = '#/accounts'; route(); refreshBell();
        } catch (e) { toast(e.message, 6000); }
      },
      onExit: err => { if (err) toast(err.display_message || err.error_message || 'Bank login closed', 5000); },
    });
    handler.open();
  } catch (e) { toast(e.message, 6000); }
}

function simplefinDrawer() {
  openDrawer(`<h2>Connect with SimpleFIN</h2><ol class="small"><li>Go to <a href="https://beta-bridge.simplefin.org" target="_blank" rel="noopener">beta-bridge.simplefin.org</a>, sign up and link your banks there.</li>
    <li>Click <strong>New connection → Create setup token</strong> and copy it.</li><li>Paste it below. Tokens work once; PocketFinance stores the resulting access encrypted.</li></ol>
    <form class="form" id="sf"><label class="f"><span>Setup token</span><textarea name="token" rows="4" required placeholder="aHR0cHM6Ly9..."></textarea></label><button class="btn primary">Connect</button></form>`, el => {
    $('#sf', el).onsubmit = async e => { e.preventDefault(); await run(e.submitter, () => api('/simplefin/connect', { method: 'POST', body: formData(e.target) }), 'SimpleFIN connected'); STATE.accounts = (await api('/accounts')).accounts; closeDrawer(); location.hash = '#/accounts'; route(); };
  });
}

async function cryptoDrawer() {
  const coins = await api('/crypto/coins');
  openDrawer(`<h2>Add crypto</h2><div class="seg" id="cm"><button class="on" data-m="wallet">Wallet address</button><button data-m="manual">Manual amount</button></div>
    <form class="form" id="cf" style="margin-top:14px"><label class="f"><span>Coin</span><select name="symbol">${coins.map(c => `<option>${c}</option>`).join('')}</select></label>
    <label class="f" id="addrF"><span>Public address (watch-only — never a private key or seed phrase)</span><input name="address" placeholder="bc1q… / 0x…"></label>
    <label class="f hidden" id="qtyF"><span>Quantity</span><input name="quantity" type="number" step="any" min="0"></label>
    <label class="f"><span>Name (optional)</span><input name="name" placeholder="Cold wallet"></label>
    <p class="small muted">Wallet balances: BTC, ETH, SOL, LTC, DOGE. Other coins: use a manual amount. Prices from CoinGecko.</p><button class="btn primary">Add</button></form>`, el => {
    $$('#cm button', el).forEach(b => b.onclick = () => { $$('#cm button', el).forEach(x => x.classList.toggle('on', x === b)); const w = b.dataset.m === 'wallet'; $('#addrF', el).classList.toggle('hidden', !w); $('#qtyF', el).classList.toggle('hidden', w); });
    $('#cf', el).onsubmit = async e => {
      e.preventDefault(); const f = formData(e.target); const wallet = !$('#addrF', el).classList.contains('hidden');
      await run(e.submitter, () => api('/crypto', { method: 'POST', body: { symbol: f.symbol, name: f.name || undefined, ...(wallet ? { address: f.address.trim() } : { quantity: f.quantity }) } }), 'Crypto added');
      STATE.accounts = (await api('/accounts')).accounts; closeDrawer(); location.hash = '#/accounts'; route();
    };
  });
}

function manualDrawer() {
  openDrawer(`<h2>Manual account</h2><form class="form" id="mf"><label class="f"><span>Name</span><input name="name" required placeholder="Home, 2021 Jeep, Cash jar…"></label>
    <label class="f"><span>Type</span><select name="type"><option value="property">Real estate</option><option value="vehicle">Vehicle</option><option value="depository">Cash / bank</option><option value="investment">Investment</option><option value="other">Other asset</option><option value="loan">Loan / debt</option><option value="credit">Credit card</option></select></label>
    <label class="f"><span>Current value or balance owed</span><input name="balance" type="number" step="0.01" required></label>
    <p class="small muted">Tip: check Zillow/Redfin for home value and KBB/Edmunds for vehicles; update any time.</p><button class="btn primary">Add</button></form>`, el => {
    $('#mf', el).onsubmit = async e => { e.preventDefault(); await run(e.submitter, () => api('/accounts', { method: 'POST', body: formData(e.target) }), 'Added'); STATE.accounts = (await api('/accounts')).accounts; closeDrawer(); location.hash = '#/accounts'; route(); };
  });
}

function importDrawer(opts = {}) {
  const bank = opts.bank || null, hint = bank ? bank.hint || bank.id : null;
  const defName = bank ? `${bank.name} ${bank.card ? 'Card' : 'Checking'}` : 'Checking';
  openDrawer(`<h2>${bank ? `Import from ${esc(bank.name)}` : 'Import transactions'}</h2>${bank ? `<div class="small">${bankStepsHTML(bank)}</div>` : ''}<p class="small muted">Supported: any bank CSV (auto-detects columns — Chase, Bank of America, Wells Fargo, Capital One, Citi, Amex, Discover, US Bank, BMO, RBC, TD, CIBC, Scotiabank and more), OFX/QFX/QBO, and exports from Mint, Monarch, YNAB, Copilot, Rocket Money and Empower. Re-importing the same file won't create duplicates.</p>
    <input type="file" id="impFile" accept=".csv,.txt,.ofx,.qfx,.qbo,.tsv"><div id="impPrev" style="margin-top:14px"></div>`, el => {
    let file = null;
    const preview = async () => {
      const flip = $('#flip', el) ? $('#flip', el).checked : false;
      const p = await api('/import/preview', { method: 'POST', body: { filename: file.name, content: file.text, flip, bank: hint } });
      $('#impPrev', el).innerHTML = `<div class="banner"><div>✅</div><div class="grow"><strong>${esc(p.format)}</strong><div class="small">${p.count} transactions · ${fdate(p.from, { month: 'short', day: 'numeric', year: 'numeric' })} – ${fdate(p.to, { month: 'short', day: 'numeric', year: 'numeric' })}${p.accounts.length ? ' · ' + p.accounts.length + ' account(s) in file' : ''}</div></div></div>
        <form class="form" id="impForm"><label class="f"><span>Put transactions in</span><select name="accountId"><option value="">${p.accounts.length ? 'Accounts named in the file (create if new)' : 'A new account'}</option>${acctOptions('', STATE.accounts.filter(a => a.provider !== 'crypto'))}</select></label>
        <div class="two"><label class="f" id="newName"><span>New account name</span><input name="newAccountName" placeholder="${esc(p.accounts[0] || defName)}"></label>
        <label class="f"><span>Account type</span><select name="accountType"><option value="depository" ${p.accountType !== 'credit' ? 'selected' : ''}>Checking / savings</option><option value="credit" ${p.accountType === 'credit' ? 'selected' : ''}>Credit card</option><option value="loan">Loan</option><option value="investment">Investment</option></select></label></div>
        <label class="chk"><input type="checkbox" id="flip" ${flip ? 'checked' : ''}> Flip signs (use if spending shows as income below)</label>
        <label class="chk"><input type="checkbox" name="keepCategories" checked> Keep categories from the file when they match mine</label>
        <div class="list">${p.sample.map(r => `<div class="item"><div class="main"><div class="t">${esc(r.merchant || r.description)}</div><div class="s">${fdate(r.date)} · ${esc(r.category || '')} ${esc(r.account || '')}</div></div><div class="amt">${txAmt(r.amount)}</div></div>`).join('')}</div>
        <button class="btn primary">Import ${p.count} transactions</button></form>`;
      $('#flip', el).onchange = preview;
      $('#impForm', el).onsubmit = async e => {
        e.preventDefault(); const f = formData(e.target);
        const r = await run(e.submitter, () => api('/import/commit', { method: 'POST', body: { filename: file.name, content: file.text, bank: hint, flip: $('#flip', el).checked, accountId: f.accountId || null, newAccountName: f.newAccountName || p.accounts[0] || (bank ? defName : file.name.replace(/\.\w+$/, '')), accountType: f.accountType, keepCategories: !!f.keepCategories } }), r => `Imported ${r.added} new (${r.updated} already there)`);
        STATE.accounts = (await api('/accounts')).accounts; closeDrawer(); location.hash = '#/transactions'; route(); refreshBell();
      };
    };
    $('#impFile', el).onchange = async e => { const f = e.target.files[0]; if (!f) return; file = { name: f.name, text: await f.text() }; preview().catch(err => { $('#impPrev', el).innerHTML = `<p class="err">${esc(err.message)}</p>`; }); };
  });
}

async function accountDrawer(a) {
  const hist = await api(`/accounts/${a.id}/history?days=365`);
  const liab = a.meta && a.meta.liability, holdings = a.meta && a.meta.holdings, cm = a.meta && a.meta.symbol ? a.meta : null;
  openDrawer(`<h2>${esc(a.name)}</h2><div class="muted small">${esc(a.institution || '')}${a.mask ? ' ••' + esc(a.mask) : ''} · ${TYPE_LABEL[a.type] || a.type}</div>
    <div class="row" style="margin:12px 0"><div style="font-size:30px;font-weight:800" class="num">${money(a.balance)}</div>${a.available != null && a.type === 'depository' ? `<span class="muted small">${money(a.available)} available</span>` : ''}</div>
    <div class="chart-box sm"><canvas id="ah"></canvas></div>
    ${liab ? `<div class="card" style="margin-top:12px"><h3>Payment</h3><div class="grid g2 small">
      <div>Due date<br><strong>${liab.due_date ? fdate(liab.due_date, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</strong></div><div>Minimum<br><strong>${liab.minimum != null ? money(liab.minimum) : '—'}</strong></div>
      <div>Statement balance<br><strong>${liab.statement_balance != null ? money(liab.statement_balance) : '—'}</strong></div><div>APR<br><strong>${liab.apr != null ? liab.apr + '%' : '—'}</strong></div></div>
      ${liab.apr && a.balance > 0 ? `<p class="small muted">Carrying this balance costs about <strong>${money(a.balance * liab.apr / 100 / 12)}</strong> a month in interest.</p>` : ''}</div>` : ''}
    ${cm ? `<p class="small muted">${cm.quantity} ${esc(cm.symbol)} × ${money(cm.price)}${cm.address ? `<br><span class="kbd">${esc(cm.address)}</span>` : ''}</p>` : ''}
    ${holdings ? `<div class="card" style="margin-top:12px"><h3>Holdings</h3><table class="t"><thead><tr><th>Security</th><th>Qty</th><th>Value</th></tr></thead><tbody>${holdings.sort((x, y) => (y.value || 0) - (x.value || 0)).map(h => `<tr><td>${esc(h.ticker || '')} <span class="small muted">${esc(h.name || '')}</span></td><td class="num">${(+h.quantity || 0).toLocaleString()}</td><td class="num">${money(h.value)}${h.cost ? `<div class="small ${h.value >= h.cost ? 'pos' : 'neg'}">${money(h.value - h.cost, { sign: true })}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <form class="form" id="af" style="margin-top:16px"><label class="f"><span>Name</span><input name="name" value="${esc(a.name)}"></label>
      <div class="two"><label class="f"><span>Type</span><select name="type">${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${k === a.type ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      ${a.type === 'credit' ? `<label class="f"><span>Credit limit</span><input name="credit_limit" type="number" step="1" value="${a.credit_limit ?? ''}"></label>` : ''}
      ${a.manual || !a.connection_id || a.provider === 'file' ? `<label class="f"><span>Balance</span><input name="balance" type="number" step="0.01" value="${a.balance}"></label>` : ''}</div>
      <label class="chk"><input type="checkbox" name="include_net_worth" ${a.include_net_worth ? 'checked' : ''}> Include in net worth</label>
      <label class="chk"><input type="checkbox" name="hidden" ${a.hidden ? 'checked' : ''}> Hide this account</label>
      <div class="row"><button class="btn primary">Save</button><a class="btn" href="#/transactions?account=${a.id}">Transactions</a><span style="flex:1"></span>${!a.connection_id || a.provider === 'file' ? '<button type="button" class="btn danger" id="delA">Delete</button>' : ''}</div></form>`, el => {
    chart($('#ah', el), { type: 'line', data: { labels: hist.map(h => fdate(h.date)), datasets: [{ data: hist.map(h => h.balance), borderColor: cssVar('--accent'), pointRadius: 0, tension: .2, borderWidth: 2, fill: true, backgroundColor: cssVar('--accent') + '1f' }] },
      options: { scales: { y: { ticks: moneyTick }, x: { ticks: { maxTicksLimit: 6 } } }, plugins: { tooltip: { callbacks: { label: c => money(c.raw) } } } } });
    $('#af', el).onsubmit = async e => {
      e.preventDefault(); const f = formData(e.target);
      await run(e.submitter, () => api(`/accounts/${a.id}`, { method: 'PATCH', body: { name: f.name, type: f.type, credit_limit: f.credit_limit ? Number(f.credit_limit) : undefined, balance: f.balance != null && f.balance !== '' ? Number(f.balance) : undefined, force: a.provider === 'file', include_net_worth: !!f.include_net_worth, hidden: !!f.hidden } }), 'Saved');
      closeDrawer(); route();
    };
    if ($('#delA', el)) $('#delA', el).onclick = async () => { if (!confirm(`Delete ${a.name} and its transactions?`)) return; await api(`/accounts/${a.id}`, { method: 'DELETE' }); STATE.accounts = (await api('/accounts')).accounts; closeDrawer(); route(); };
  });
}

// ======================= TRANSACTIONS =======================
VIEWS.transactions = async (el, q) => {
  const f = { q: q.get('q') || '', category: q.get('category') || '', account: q.get('account') || '', type: q.get('type') || '', from: q.get('from') || '', to: q.get('to') || '', uncategorized: q.get('uncategorized') || '', tax: q.get('tax') || '', merchant_key: q.get('merchant_key') || '', tag: q.get('tag') || '', review: q.get('review') || '' };
  const tags = await loadTags(true);
  el.innerHTML = `<div class="toolbar">
    <input class="grow" id="fq" type="search" placeholder="Search merchant, note or amount" value="${esc(f.q)}">
    <select id="fc">${catOptions(f.category, { any: true })}</select>
    <select id="fa">${acctOptions(f.account, STATE.accounts, { any: true })}</select>
    <select id="ft"><option value="">All types</option><option value="expense" ${f.type === 'expense' ? 'selected' : ''}>Money out</option><option value="income" ${f.type === 'income' ? 'selected' : ''}>Money in</option></select>
    <input type="date" id="ff" value="${esc(f.from)}" title="From"><input type="date" id="fto" value="${esc(f.to)}" title="To">
  </div>
  <div class="toolbar"><label class="chk"><input type="checkbox" id="fu" ${f.uncategorized ? 'checked' : ''}> Uncategorized only</label><label class="chk"><input type="checkbox" id="ftax" ${f.tax ? 'checked' : ''}> Tax deductible</label><label class="chk"><input type="checkbox" id="frv" ${f.review ? 'checked' : ''}> Needs review</label>
    <select id="ftag"><option value="">All tags</option>${tags.map(t => `<option value="${esc(t.name)}" ${t.name === f.tag ? 'selected' : ''}>#${esc(t.name)} (${t.count})</option>`).join('')}</select>
    <span class="grow"></span><button class="btn" id="addTx">+ Add</button><button class="btn" id="impTx">Import</button><a class="btn" href="/api/export/transactions.csv">Export CSV</a></div>
  <div class="card"><div id="txSum" class="small muted" style="margin-bottom:6px"></div><div id="txList" class="list"></div><div id="more" style="text-align:center;margin-top:10px"></div></div>`;
  let offset = 0; const PAGE = 100; let lastDay = '';
  const params = () => { const p = new URLSearchParams(); Object.entries(f).forEach(([k, v]) => v && p.set(k, v)); return p; };
  const load = async (reset) => {
    if (reset) { offset = 0; lastDay = ''; $('#txList', el).innerHTML = ''; }
    const p = params(); p.set('limit', PAGE); p.set('offset', offset);
    const r = await api('/transactions?' + p);
    $('#txSum', el).innerHTML = `${r.total.n.toLocaleString()} transactions · <span>${money(r.total.out || 0)} out</span> · <span class="pos">${money(r.total.inc || 0)} in</span>`;
    let html = '';
    for (const t of r.rows) { if (t.date !== lastDay) { lastDay = t.date; html += `<div class="day-h">${pd(t.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>`; } html += txRow(t); }
    $('#txList', el).insertAdjacentHTML('beforeend', html || (reset ? '<div class="empty"><div class="big">🔍</div>No transactions match.</div>' : ''));
    offset += r.rows.length;
    $('#more', el).innerHTML = offset < r.total.n ? '<button class="btn" id="moreBtn">Load more</button>' : '';
    if ($('#moreBtn', el)) $('#moreBtn', el).onclick = () => load(false);
  };
  const apply = () => { history.replaceState(null, '', '#/transactions?' + params()); load(true); };
  let deb; $('#fq', el).oninput = e => { clearTimeout(deb); deb = setTimeout(() => { f.q = e.target.value; apply(); }, 250); };
  $('#fc', el).onchange = e => { f.category = e.target.value; apply(); };
  $('#fa', el).onchange = e => { f.account = e.target.value; apply(); };
  $('#ft', el).onchange = e => { f.type = e.target.value; apply(); };
  $('#ff', el).onchange = e => { f.from = e.target.value; apply(); };
  $('#fto', el).onchange = e => { f.to = e.target.value; apply(); };
  $('#fu', el).onchange = e => { f.uncategorized = e.target.checked ? '1' : ''; apply(); };
  $('#ftax', el).onchange = e => { f.tax = e.target.checked ? '1' : ''; apply(); };
  $('#frv', el).onchange = e => { f.review = e.target.checked ? '1' : ''; apply(); };
  $('#ftag', el).onchange = e => { f.tag = e.target.value; apply(); };
  $('#txList', el).onclick = e => { const i = e.target.closest('[data-tx]'); if (i) editTx(Number(i.dataset.tx), () => load(true)); };
  $('#impTx', el).onclick = importDrawer;
  $('#addTx', el).onclick = () => openDrawer(`<h2>Add transaction</h2><form class="form" id="nt"><label class="f"><span>Account</span><select name="account_id" required>${acctOptions('')}</select></label>
    <div class="two"><label class="f"><span>Date</span><input type="date" name="date" value="${todayISO()}" required></label><label class="f"><span>Amount (negative = spent)</span><input name="amount" type="number" step="0.01" required placeholder="-25.00"></label></div>
    <label class="f"><span>Description</span><input name="description" required></label><label class="f"><span>Category</span><select name="category">${catOptions('Uncategorized')}</select></label>
    <label class="f"><span>Notes</span><input name="notes"></label><button class="btn primary">Add</button></form>`, d => {
    $('#nt', d).onsubmit = async e => { e.preventDefault(); await run(e.submitter, () => api('/transactions', { method: 'POST', body: formData(e.target) }), 'Added'); closeDrawer(); load(true); };
  });
  await load(true);
};

async function editTx(id, after) {
  const t = await api(`/transactions/${id}`);
  openDrawer(`<div class="row" style="gap:14px"><div class="ico" style="width:48px;height:48px;font-size:22px">${t.logo ? `<img src="${esc(t.logo)}" alt="" referrerpolicy="no-referrer">` : catIcon(t.category)}</div>
    <div><h2 style="margin:0">${esc(t.merchant)}</h2><div class="muted small">${fdate(t.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · ${esc(t.account_name)}</div></div></div>
    <div style="font-size:32px;font-weight:800;margin:14px 0">${txAmt(t.amount)}</div>
    <div class="small muted" style="margin-bottom:12px">Bank description: <span class="kbd">${esc(t.description)}</span></div>
    <form class="form" id="tf"><label class="f"><span>Merchant name</span><input name="merchant" value="${esc(t.merchant)}"></label>
      <label class="f"><span>Category</span><select name="category">${catOptions(t.category)}</select></label>
      <label class="f"><span>Tags <small class="muted">comma separated — e.g. vacation, work trip</small></span><input name="tags" list="tagList" value="${esc(tagArr(t.tags).join(', '))}" autocomplete="off"><datalist id="tagList">${(TAGS_CACHE || []).map(x => `<option value="${esc(x.name)}">`).join('')}</datalist></label>
      <label class="f"><span>Notes</span><textarea name="notes" rows="2">${esc(t.notes || '')}</textarea></label>
      <label class="chk"><input type="checkbox" name="excluded" ${t.excluded ? 'checked' : ''}> Exclude from spending &amp; budgets (transfers, reimbursements)</label>
      <label class="chk"><input type="checkbox" name="tax_deductible" ${t.tax_deductible ? 'checked' : ''}> Tax deductible</label>
      <label class="chk"><input type="checkbox" name="applyToAll"> Apply to all <strong>${esc(t.merchant)}</strong> transactions (past &amp; future)</label>
      <div class="row wrap"><button class="btn primary">Save</button><button type="button" class="btn" id="splitBtn">Split</button><button type="button" class="btn" id="shareCost">👥 Share cost</button><a class="btn" href="#/transactions?merchant_key=${encodeURIComponent(t.merchant_key)}">All from merchant</a>
      <span style="flex:1"></span><button type="button" class="btn danger" id="delTx">Delete</button></div></form><div id="splitBox"></div>${(t.ious || []).length ? `<div class="card" style="margin-top:14px"><h3>👥 Shared</h3><div class="list">${t.ious.map(i => `<a class="item" href="#/owed"><div class="main"><div class="t">${i.direction === 'owed_me' ? `${esc(i.person)} owes you` : `You owe ${esc(i.person)}`}</div><div class="s">${i.settled_at ? 'Settled ' + fdate(i.settled_at) : 'Open'}</div></div><div class="amt num">${money(i.amount)}</div></a>`).join('')}</div></div>` : ''}<div class="card" id="attBox" style="margin-top:14px"></div>`, el => {
    wireReceipts($('#attBox', el), t.id).catch(() => {});
    if (!TAGS_CACHE) loadTags().then(list => { const d = $('#tagList', el); if (d) d.innerHTML = list.map(x => `<option value="${esc(x.name)}">`).join(''); });
    $('#tf', el).onsubmit = async e => {
      e.preventDefault(); const f = formData(e.target);
      const r = await run(e.submitter, () => api(`/transactions/${t.id}`, { method: 'PATCH', body: { merchant: f.merchant, category: f.category, notes: f.notes, tags: f.tags, reviewed: true, excluded: !!f.excluded, tax_deductible: !!f.tax_deductible, applyToAll: !!f.applyToAll } }),
        r => r.applied ? `Saved · updated ${r.applied} more and created a rule` : 'Saved');
      TAGS_CACHE = null; closeDrawer(); after && after(r);
    };
    $('#delTx', el).onclick = async () => { if (!confirm('Delete this transaction? (Synced ones may come back on the next sync.)')) return; await api(`/transactions/${t.id}`, { method: 'DELETE' }); closeDrawer(); after && after(); };
    $('#shareCost', el).onclick = () => iouDrawer({ tx: t }, after);
    $('#splitBtn', el).onclick = () => {
      const total = Math.abs(t.amount);
      const rowH = (amt, cat) => `<div class="two" style="display:grid;grid-template-columns:1fr 1.4fr;gap:8px"><input type="number" step="0.01" class="sa" value="${amt}"><select class="sc">${catOptions(cat)}</select></div>`;
      $('#splitBox', el).innerHTML = `<div class="card" style="margin-top:14px"><h3>Split ${money(total)}</h3><div id="parts" class="stack">${rowH((total / 2).toFixed(2), t.category)}${rowH((total - (total / 2).toFixed(2)).toFixed(2), 'Uncategorized')}</div>
        <div class="row" style="margin-top:10px"><button class="btn sm" id="addPart">+ Part</button><span class="small muted" id="remain"></span><span style="flex:1"></span><button class="btn primary sm" id="doSplit">Split</button></div></div>`;
      const upd = () => { const s = $$('.sa', el).reduce((a, i) => a + (+i.value || 0), 0); $('#remain', el).textContent = `Remaining: ${money(total - s)}`; };
      el.addEventListener('input', upd); upd();
      $('#addPart', el).onclick = () => { $('#parts', el).insertAdjacentHTML('beforeend', rowH('0.00', 'Uncategorized')); upd(); };
      $('#doSplit', el).onclick = async e => { const parts = $$('.sa', el).map((i, k) => ({ amount: i.value, category: $$('.sc', el)[k].value })); await run(e.target, () => api(`/transactions/${t.id}/split`, { method: 'POST', body: { parts } }), 'Split saved'); closeDrawer(); after && after(); };
    };
  });
}
