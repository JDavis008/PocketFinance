/* Recurring, Budgets, Spending, Net worth, Goals, Lower my bills, Credit, Settings */
'use strict';

// ======================= RECURRING =======================
VIEWS.recurring = async (el, q) => {
  const d = await api('/recurring');
  let tab = q.get('tab') || 'upcoming';
  const T = d.totals;
  const draw = () => {
    const rows = d.rows.filter(r => tab === 'inactive' ? ['cancelled', 'inactive', 'ignored'].includes(r.status) : r.status === 'active' && r.kind === tab);
    el.innerHTML = `
    <div class="grid g4">
      <div class="card stat"><div class="label">Subscriptions</div><div class="value num">${money(T.subscriptionsMonthly)}<span class="small muted">/mo</span></div><div class="sub">${money(T.subscriptionsMonthly * 12, { cents: false })} per year</div></div>
      <div class="card stat"><div class="label">Bills</div><div class="value num">${money(T.billsMonthly, { cents: false })}<span class="small muted">/mo</span></div><div class="sub">${T.count} recurring charges</div></div>
      <div class="card stat"><div class="label">Recurring income</div><div class="value num pos">${money(T.incomeMonthly, { cents: false })}<span class="small muted">/mo</span></div></div>
      <div class="card stat"><div class="label">Left after bills</div><div class="value num">${money(T.incomeMonthly - T.billsMonthly - T.subscriptionsMonthly, { cents: false })}<span class="small muted">/mo</span></div></div>
    </div>
    ${savingsBanner(d)}
    <div class="toolbar" style="margin-top:16px"><div class="seg" id="tabs">${[['upcoming', 'Calendar'], ['subscription', 'Subscriptions'], ['bill', 'Bills'], ['income', 'Income'], ['inactive', 'Cancelled & inactive']].map(([k, v]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${v}</button>`).join('')}</div>
      <span class="grow"></span><button class="btn" id="addBill">+ Add manually</button><button class="btn" id="calBtn">📅 Add to calendar</button></div>
    ${tab === 'upcoming' ? calendarView(d.upcoming, d.paid) : `<div class="card"><div class="list">${rows.length ? rows.map(recRow).join('') : `<div class="empty"><div class="big">🔎</div>Nothing here yet. Recurring charges appear automatically after a couple of months of transactions.</div>`}</div></div>`}`;
    $$('#tabs button', el).forEach(b => b.onclick = () => { tab = b.dataset.t; history.replaceState(null, '', '#/recurring?tab=' + tab); draw(); });
    $$('[data-rec]', el).forEach(i => i.onclick = () => recDrawer(d.rows.find(r => r.id === Number(i.dataset.rec))));
    $('#addBill', el).onclick = addBillDrawer;
    $('#calBtn', el).onclick = calendarDrawer;
    if ($('#rvStart', el)) $('#rvStart', el).onclick = reviewSubs;
  };
  draw();
};

function recRow(r) {
  const name = r.custom_name || r.name;
  const up = r.prev_amount && r.amount > r.prev_amount;
  return `<div class="item" data-rec="${r.id}"><div class="ico">${r.kind === 'income' ? '💵' : catIcon(r.category)}</div>
    <div class="main"><div class="t">${esc(name)} ${up ? `<span class="pill red">↑ from ${money(r.prev_amount)}</span>` : ''}${r.status === 'cancelled' ? ' ' + (r.cancel_state === 'failed' ? '<span class="pill red">Charged after cancel</span>' : r.cancel_state === 'pending' ? '<span class="pill amber">Cancel pending</span>' : '<span class="pill green">Cancelled</span>') : r.status !== 'active' ? ` <span class="pill">${r.status}</span>` : ''}</div>
    <div class="s">${CAD_LABEL[r.cadence] || r.cadence}${r.status === 'active' && r.next_date ? ' · next ' + relDay(r.next_date) : r.last_date ? ' · last ' + fdate(r.last_date) : ''}${r.account_name ? ' · ' + esc(r.account_name) : ''}</div></div>
    <div class="amt"><div class="num ${r.kind === 'income' ? 'pos' : ''}">${money(r.amount)}</div>${r.cadence !== 'monthly' ? `<div class="small muted">${money(r.monthly)}/mo</div>` : ''}</div></div>`;
}

function calendarView(up, paid = []) {
  const t = pd(todayISO()); const first = new Date(t.getFullYear(), t.getMonth(), 1); const last = new Date(t.getFullYear(), t.getMonth() + 1, 0);
  const by = {}; paid.forEach(u => (by[u.date] ||= []).push({ ...u, paid: true })); up.forEach(u => (by[u.date] ||= []).push(u));
  let cells = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(x => `<div class="h">${x}</div>`).join('');
  for (let i = 0; i < first.getDay(); i++) cells += '<div></div>';
  for (let d = 1; d <= last.getDate(); d++) {
    const ds = iso(new Date(t.getFullYear(), t.getMonth(), d)); const evs = by[ds] || [];
    cells += `<div class="d ${ds === todayISO() ? 'today' : ''}"><div class="n">${d}</div>${evs.slice(0, 3).map(e => `<div class="e ${e.kind === 'income' ? 'pos' : ''}" style="${e.paid ? 'opacity:.5' : ''}" title="${esc(e.name)} ${money(e.amount)}${e.paid ? ' (paid)' : ''}">${e.paid ? '✓ ' : ''}${esc(e.name)}</div>`).join('')}${evs.length > 3 ? `<div class="small muted">+${evs.length - 3}</div>` : ''}</div>`;
  }
  const out = up.filter(u => u.kind !== 'income');
  return `<div class="grid g3"><div class="card span2"><div class="card-h"><h2>${fmonth(todayISO().slice(0, 7))}</h2></div><div class="cal">${cells}</div></div>
    <div class="card"><div class="card-h"><h2>Next 45 days</h2><span class="small muted">${money(out.reduce((s, u) => s + u.amount, 0), { cents: false })} due</span></div>
    <div class="list">${up.length ? up.map(u => `<div class="item" ${u.id ? `data-rec="${u.id}"` : ''}><div class="ico">${u.kind === 'income' ? '💵' : catIcon(u.category)}</div><div class="main"><div class="t">${esc(u.name)}</div><div class="s">${relDay(u.date)}${u.overdue ? ' · <span class="neg">not seen yet</span>' : ''}</div></div><div class="amt ${u.kind === 'income' ? 'pos' : ''}">${money(u.amount)}</div></div>`).join('') : '<div class="empty small">Nothing scheduled.</div>'}</div></div></div>`;
}

function cancelLetter(r) {
  const name = r.custom_name || r.name;
  return `Subject: Cancel my ${name} subscription\n\nHello ${name} support,\n\nPlease cancel my ${name} subscription/membership effective immediately and stop all future charges.\nThe most recent charge was ${money(r.amount)} on ${fdate(r.last_date, { month: 'long', day: 'numeric', year: 'numeric' })}.\n\nAccount name: [your name]\nAccount email / number: [your email or account #]\nPayment card: ending in [last 4 digits]\n\nPlease confirm the cancellation in writing and let me know the date the final charge will occur. If any charge posts after today's date, I request a full refund.\n\nThank you,\n[your name]\n${pd(todayISO()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
}

async function recDrawer(r) {
  if (!r) return;
  const name = r.custom_name || r.name;
  openDrawer(`<div class="row" style="gap:14px"><div class="ico" style="width:48px;height:48px;font-size:22px">${r.kind === 'income' ? '💵' : catIcon(r.category)}</div><div><h2 style="margin:0">${esc(name)}</h2>
    <div class="muted small">${CAD_LABEL[r.cadence]} · ${esc(r.category)} ${r.status !== 'active' ? '· ' + r.status : ''}</div></div></div>
    <div class="grid g3" style="margin:16px 0"><div><div class="small muted">Amount</div><strong class="num">${money(r.amount)}</strong></div><div><div class="small muted">Per year</div><strong class="num">${money(r.monthly * 12, { cents: false })}</strong></div><div><div class="small muted">${r.status === 'active' ? 'Next' : 'Last'}</div><strong>${fdate(r.status === 'active' ? r.next_date : r.last_date) || '—'}</strong></div></div>
    ${r.prev_amount && r.amount > r.prev_amount ? `<div class="banner" style="background:color-mix(in srgb,var(--neg) 10%,transparent)">📈 <div class="grow">Price went up from <strong>${money(r.prev_amount)}</strong> to <strong>${money(r.amount)}</strong> (+${money((r.amount - r.prev_amount) * (r.monthly / r.amount) * 12, { cents: false })}/yr).</div></div>` : ''}
    <div id="cancelSlot"></div>
    ${r.negotiable && r.status === 'active' ? `<div class="card" style="margin-top:12px"><h3>Pay less</h3><ul class="small">${r.negotiable.map(t => `<li>${esc(t)}</li>`).join('')}</ul><a class="btn sm" href="#/negotiate">Open negotiation helper</a></div>` : ''}
    <form class="form card" id="rf" style="margin-top:12px"><h3>Edit</h3><label class="f"><span>Name</span><input name="custom_name" value="${esc(name)}"></label>
      <div class="two"><label class="f"><span>Amount</span><input name="amount" type="number" step="0.01" value="${r.amount}"></label><label class="f"><span>Frequency</span><select name="cadence">${Object.entries(CAD_LABEL).map(([k, v]) => `<option value="${k}" ${k === r.cadence ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
      <div class="two"><label class="f"><span>Next date</span><input type="date" name="next_date" value="${r.next_date || ''}"></label><label class="f"><span>Type</span><select name="kind">${['subscription', 'bill', 'income'].map(k => `<option ${k === r.kind ? 'selected' : ''}>${k}</option>`).join('')}</select></label></div>
      <label class="f"><span>Category</span><select name="category">${catOptions(r.category)}</select></label>
      <label class="f"><span>Notes</span><input name="notes" value="${esc(r.notes || '')}"></label>
      <div class="row wrap"><button class="btn primary">Save</button>${r.status !== 'active' ? '<button type="button" class="btn" id="reactivate">Mark active</button>' : ''}<span style="flex:1"></span><button type="button" class="btn danger" id="notRec">Not recurring</button></div></form>
    ${r.history.length ? `<div class="card" style="margin-top:12px"><h3>Charge history</h3><div class="chart-box sm"><canvas id="rh"></canvas></div><div class="list">${r.history.map(h => `<div class="item" style="cursor:default"><div class="main">${fdate(h.date, { month: 'short', day: 'numeric', year: 'numeric' })}</div><div class="amt">${txAmt(h.amount)}</div></div>`).join('')}</div></div>` : ''}`, el => {
    const save = async (body, msg) => { await api(`/recurring/${r.id}`, { method: 'PATCH', body }); toast(msg); closeDrawer(); route(); };
    cancelCard($('#cancelSlot', el), r).catch(() => {});
    if ($('#cancelled', el)) $('#cancelled', el).onclick = () => save({ status: 'cancelled' }, `${name} marked cancelled`);
    if ($('#reactivate', el)) $('#reactivate', el).onclick = async () => { await api(`/recurring/${r.id}/cancel/undo`, { method: 'POST' }); toast('Marked active'); closeDrawer(); route(); };
    $('#notRec', el).onclick = async () => { await api(`/recurring/${r.id}`, { method: 'DELETE' }); toast('Removed from recurring'); closeDrawer(); route(); };
    if ($('#letterBtn', el)) $('#letterBtn', el).onclick = () => {
      const L = cancelLetter(r); const [subj, ...body] = L.split('\n');
      $('#letterBox', el).innerHTML = `<pre class="letter">${esc(L)}</pre><div class="row"><button class="btn sm" id="copyL">Copy</button><a class="btn sm" href="mailto:?subject=${encodeURIComponent(subj.replace('Subject: ', ''))}&body=${encodeURIComponent(body.join('\n').trim())}">Open in email</a></div>`;
      $('#copyL', el).onclick = () => navigator.clipboard.writeText(L).then(() => toast('Copied'));
    };
    $('#rf', el).onsubmit = e => { e.preventDefault(); const f = formData(e.target); save({ ...f, amount: Number(f.amount) }, 'Saved'); };
    if ($('#rh', el)) { const h = [...r.history].reverse(); chart($('#rh', el), { type: 'bar', data: { labels: h.map(x => fdate(x.date, { month: 'short', year: '2-digit' })), datasets: [{ data: h.map(x => Math.abs(x.amount)), backgroundColor: cssVar('--accent'), borderRadius: 5 }] }, options: { scales: { y: { ticks: moneyTick } } } }); }
  });
}

function addBillDrawer() {
  openDrawer(`<h2>Add a recurring bill</h2><p class="small muted">For things paid by check, cash or from an account you haven't connected.</p><form class="form" id="bf">
    <label class="f"><span>Name</span><input name="name" required placeholder="Rent, daycare, lawn service…"></label>
    <div class="two"><label class="f"><span>Amount</span><input name="amount" type="number" step="0.01" required></label><label class="f"><span>Frequency</span><select name="cadence">${Object.entries(CAD_LABEL).map(([k, v]) => `<option value="${k}" ${k === 'monthly' ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
    <div class="two"><label class="f"><span>Next due</span><input type="date" name="next_date" value="${todayISO()}" required></label><label class="f"><span>Type</span><select name="kind"><option>bill</option><option>subscription</option><option>income</option></select></label></div>
    <label class="f"><span>Category</span><select name="category">${catOptions('Bills & Utilities')}</select></label><button class="btn primary">Add</button></form>`, el => {
    $('#bf', el).onsubmit = async e => { e.preventDefault(); await run(e.submitter, () => api('/recurring', { method: 'POST', body: formData(e.target) }), 'Added'); closeDrawer(); route(); };
  });
}

async function calendarDrawer() {
  const { url } = await api('/calendar');
  const full = location.origin + url;
  openDrawer(`<h2>Bills in your calendar</h2><p class="small">Download a one-time file, or subscribe so your calendar stays in sync (needs your calendar app to reach this computer — e.g. Outlook on this PC, or any device on your Tailscale network).</p>
    <a class="btn primary" href="/api/calendar.ics">Download bills.ics</a><h3 style="margin-top:18px">Subscription URL</h3><p class="kbd">${esc(full)}</p><button class="btn sm" id="cpy">Copy URL</button>
    <p class="small muted">Outlook: Add calendar → Subscribe from web. Apple Calendar: File → New Calendar Subscription. Google Calendar needs a public URL, so use the download instead.</p>`, el => {
    $('#cpy', el).onclick = () => navigator.clipboard.writeText(full).then(() => toast('Copied'));
  });
}

// ======================= BUDGETS =======================
VIEWS.budgets = async (el, q) => {
  let month = q.get('month') || todayISO().slice(0, 7);
  const draw = async () => {
    const b = await api('/budgets?month=' + month);
    const pct = b.total ? b.spent / b.total : 0;
    const used = new Set(b.list.map(x => x.category));
    el.innerHTML = `<div class="toolbar"><div class="month-nav"><button class="btn sm" id="pm">‹</button><strong>${fmonth(month)}</strong><button class="btn sm" id="nm">›</button></div><span class="grow"></span>
      <button class="btn" id="sug">✨ Suggest budgets</button><button class="btn primary" id="addB">+ Add budget</button></div>
    <div class="grid g4">${(() => { const inc = Math.max(b.income, b.plannedIncome), left = inc - b.total; return `<div class="card stat"><div class="label">Left to assign</div><div class="value num ${left < 0 ? 'neg' : 'pos'}">${money(left, { cents: false })}</div><div class="sub">${money(inc, { cents: false })} ${b.income >= b.plannedIncome ? 'income this month' : 'expected income'} − budgets${left < 0 ? ' · budgets exceed income' : left > 0 ? ' · give every dollar a job' : ' · every dollar has a job ✓'}</div></div>`; })()}<div class="card stat"><div class="label">Budgeted</div><div class="value num">${money(b.total, { cents: false })}</div></div>
      <div class="card stat"><div class="label">Spent in budgets</div><div class="value num">${money(b.spent, { cents: false })}</div><div class="bar ${pct >= 1 ? 'over' : pct > .85 ? 'near' : ''}" style="margin-top:8px"><span style="width:${Math.min(100, pct * 100)}%"></span><i class="pace" style="left:${b.dayNow / b.daysIn * 100}%"></i></div></div>
      <div class="card stat"><div class="label">Spending outside budgets</div><div class="value num">${money(b.unbudgeted, { cents: false })}</div><div class="sub">Add budgets to cover more of it</div></div></div>
    <div class="card" style="margin-top:16px">${b.list.length ? b.list.map(budgetBar).join('') : '<div class="empty"><div class="big">🎯</div>No budgets yet. Try <strong>Suggest budgets</strong> — it uses your last 3 months.</div>'}
      <p class="small muted" style="margin:10px 0 0">The thin line marks how far through the month you are — bars past it are spending ahead of pace.</p></div>`;
    $('#pm', el).onclick = () => { month = shiftMonth(month, -1); draw(); };
    $('#nm', el).onclick = () => { month = shiftMonth(month, 1); draw(); };
    $$('.budget-row', el).forEach(r => r.onclick = () => budgetDrawer(b.list.find(x => x.category === r.dataset.cat), draw));
    $('#addB', el).onclick = () => budgetDrawer(null, draw, used);
    $('#sug', el).onclick = async () => {
      const s = (await api('/budgets/suggest', { method: 'POST' })).filter(x => !used.has(x.category));
      if (!s.length) return toast('No new suggestions — every regular category already has a budget.');
      openDrawer(`<h2>Suggested budgets</h2><p class="small muted">Based on your average spending over the last 3 full months.</p><form id="sf" class="form">${s.map(x => `<label class="chk" style="justify-content:space-between"><span><input type="checkbox" name="${esc(x.category)}" checked> ${catIcon(x.category)} ${esc(x.category)}</span><input type="number" style="width:120px" data-c="${esc(x.category)}" value="${x.amount}"></label>`).join('')}<button class="btn primary">Create budgets</button></form>`, d => {
        $('#sf', d).onsubmit = async e => { e.preventDefault(); for (const i of $$('[data-c]', d)) if ($(`input[name="${CSS.escape(i.dataset.c)}"]`, d).checked) await api('/budgets/' + encodeURIComponent(i.dataset.c), { method: 'PUT', body: { amount: Number(i.value) } }); closeDrawer(); toast('Budgets created'); draw(); };
      });
    };
  };
  await draw();
};

function budgetDrawer(b, after, used = new Set()) {
  openDrawer(`<h2>${b ? esc(b.category) + ' budget' : 'New budget'}</h2><form class="form" id="bf">
    ${b ? '' : `<label class="f"><span>Category</span><select name="category">${catOptions('', {}).replace(/<option value="([^"]+)"/g, (m, c) => used.has(c.replace(/&amp;/g, '&')) ? `<option disabled value="${c}"` : m)}</select></label>`}
    <label class="f"><span>Monthly amount</span><input name="amount" type="number" step="1" min="0" value="${b ? b.amount : ''}" required></label>
    <label class="chk"><input type="checkbox" name="rollover" ${b && b.rollover ? 'checked' : ''}> Roll over unspent (or overspent) money to next month</label>
    <div class="row"><button class="btn primary">Save</button>${b ? `<a class="btn" href="#/transactions?category=${encodeURIComponent(b.category)}&from=${todayISO().slice(0, 8)}01">Transactions</a><span style="flex:1"></span><button type="button" class="btn danger" id="delB">Delete</button>` : ''}</div></form>`, el => {
    $('#bf', el).onsubmit = async e => { e.preventDefault(); const f = formData(e.target); const cat = b ? b.category : f.category; await run(e.submitter, () => api('/budgets/' + encodeURIComponent(cat), { method: 'PUT', body: { amount: Number(f.amount), rollover: !!f.rollover } }), 'Saved'); closeDrawer(); after(); };
    if ($('#delB', el)) $('#delB', el).onclick = async () => { await api('/budgets/' + encodeURIComponent(b.category), { method: 'DELETE' }); closeDrawer(); after(); };
  });
}

// ======================= SPENDING =======================
VIEWS.spending = async (el, q) => {
  let month = q.get('month') || todayISO().slice(0, 7);
  const draw = async () => {
    clearCharts();
    const r = await api('/report?month=' + month);
    const prevMap = Object.fromEntries(r.prevCategories.map(c => [c.name, c.total]));
    const ch = (a, b) => { if (!b) return ''; const p = (a - b) / b * 100; return `<span class="small ${p > 0 ? 'neg' : 'pos'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p).toFixed(0)}%</span>`; };
    const savingsRate = r.totals.income > 0 ? (r.totals.net / r.totals.income * 100) : null;
    el.innerHTML = `<div class="toolbar"><div class="month-nav"><button class="btn sm" id="pm">‹</button><strong>${fmonth(month)}</strong><button class="btn sm" id="nm">›</button></div></div>
    <div class="grid g4"><div class="card stat"><div class="label">Spent</div><div class="value num">${money(r.totals.spending, { cents: false })}</div><div class="sub">${ch(r.totals.spending, r.prev.spending)} vs ${money(r.prev.spending, { cents: false })} last month</div></div>
      <div class="card stat"><div class="label">Income</div><div class="value num pos">${money(r.totals.income, { cents: false })}</div><div class="sub">last month ${money(r.prev.income, { cents: false })}</div></div>
      <div class="card stat"><div class="label">Net cash flow</div><div class="value num ${r.totals.net >= 0 ? 'pos' : 'neg'}">${money(r.totals.net, { sign: true, cents: false })}</div></div>
      <div class="card stat"><div class="label">Savings rate</div><div class="value num">${savingsRate == null ? '—' : savingsRate.toFixed(0) + '%'}</div><div class="sub">of income kept</div></div></div>
    <div class="grid g3" style="margin-top:16px"><div class="card"><h2>By category</h2><div class="chart-box"><canvas id="donut"></canvas></div></div>
      <div class="card span2"><h2>Categories</h2><div class="list">${r.categories.length ? r.categories.map(c => `<a class="item" href="#/transactions?category=${encodeURIComponent(c.name)}&from=${month}-01&to=${month}-31"><div class="ico">${c.icon || '🏷️'}</div>
        <div class="main"><div class="t">${esc(c.name)} <span class="small muted">${(c.total / r.totals.spending * 100).toFixed(0)}%</span></div><div class="bar" style="margin-top:4px"><span style="width:${c.total / r.categories[0].total * 100}%;background:${c.color}"></span></div></div>
        <div class="amt num">${money(c.total, { cents: false })}<div>${ch(c.total, prevMap[c.name])}</div></div></a>`).join('') : '<div class="empty">No spending this month.</div>'}</div></div></div>
    <div class="grid g2" style="margin-top:16px"><div class="card"><h2>Pace vs last month</h2><div class="chart-box"><canvas id="cum"></canvas></div></div>
      <div class="card"><h2>Top merchants</h2><div class="list">${r.merchants.map((m, i) => `<div class="item" style="cursor:default"><div class="ico">${m.logo ? `<img src="${esc(m.logo)}" alt="" referrerpolicy="no-referrer">` : i + 1}</div><div class="main"><div class="t">${esc(m.name)}</div><div class="s">${m.n} transaction${m.n > 1 ? 's' : ''}</div></div><div class="amt num">${money(m.total)}</div></div>`).join('') || '<div class="empty small">—</div>'}</div></div></div>
    <div class="card" style="margin-top:16px"><div class="card-h"><h2>Cash flow · last 12 months</h2></div><div class="chart-box lg"><canvas id="cf"></canvas></div></div>
    ${r.income.length ? `<div class="card" style="margin-top:16px"><h2>Income sources</h2><div class="list">${r.income.map(i => `<div class="item" style="cursor:default"><div class="ico">💵</div><div class="main"><div class="t">${esc(i.name)}</div></div><div class="amt pos num">${money(i.total)}</div></div>`).join('')}</div></div>` : ''}`;
    $('#pm', el).onclick = () => { month = shiftMonth(month, -1); draw(); };
    $('#nm', el).onclick = () => { month = shiftMonth(month, 1); draw(); };
    chart($('#donut'), { type: 'doughnut', data: { labels: r.categories.map(c => c.name), datasets: [{ data: r.categories.map(c => c.total), backgroundColor: r.categories.map(c => c.color), borderWidth: 2, borderColor: cssVar('--surface') }] },
      options: { cutout: '68%', plugins: { tooltip: { callbacks: { label: c => `${c.label}: ${money(c.raw)}` } } } } });
    chart($('#cum'), { type: 'line', data: { labels: r.daily.previous.map((_, i) => i + 1), datasets: [
      { data: r.daily.current, borderColor: cssVar('--accent'), pointRadius: 0, tension: .25, borderWidth: 2.5, label: fmonth(month) },
      { data: r.daily.previous, borderColor: cssVar('--muted'), borderDash: [5, 4], pointRadius: 0, tension: .25, borderWidth: 1.5, label: 'Previous month' }] },
      options: { scales: { y: { ticks: moneyTick } }, plugins: { tooltip: { callbacks: { title: i => 'Day ' + i[0].label, label: c => `${c.dataset.label}: ${money(c.raw)}` } } } } });
    chart($('#cf'), { type: 'bar', data: { labels: r.cashflow.map(c => fdate(c.month + '-01', { month: 'short' })), datasets: [
      { type: 'line', data: r.cashflow.map(c => c.net), borderColor: cssVar('--accent'), pointRadius: 3, tension: .25, label: 'Net', order: 0 },
      { data: r.cashflow.map(c => c.income), backgroundColor: cssVar('--pos'), borderRadius: 5, label: 'Income', order: 1 },
      { data: r.cashflow.map(c => -c.spending), backgroundColor: cssVar('--neg'), borderRadius: 5, label: 'Spending', order: 1 }] },
      options: { scales: { x: { stacked: true }, y: { ticks: moneyTick } }, plugins: { legend: { display: true, position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${money(c.raw)}` } } } } });
  };
  await draw();
};

// ======================= NET WORTH =======================
VIEWS.networth = async el => {
  let days = 365;
  const draw = async () => {
    clearCharts();
    const [n, a] = await Promise.all([api('/networth?days=' + days), api('/accounts')]);
    const h = n.history, S = n.summary;
    const change = h.length > 1 ? h[h.length - 1].net - h[0].net : 0;
    const assets = a.accounts.filter(x => !x.hidden && x.include_net_worth && !['credit', 'loan'].includes(x.type)).sort((x, y) => y.balance - x.balance);
    const liab = a.accounts.filter(x => !x.hidden && x.include_net_worth && ['credit', 'loan'].includes(x.type)).sort((x, y) => y.balance - x.balance);
    el.innerHTML = `<div class="card"><div class="row between wrap"><div><div class="muted small">Net worth</div><div style="font-size:36px;font-weight:800" class="num">${money(S.netWorth)}</div>
      <div class="small"><span class="${change >= 0 ? 'pos' : 'neg'}">${money(change, { sign: true, cents: false })}</span> <span class="muted">over this period</span></div></div>
      <div class="seg" id="rng">${[[30, '1M'], [90, '3M'], [180, '6M'], [365, '1Y'], [1825, 'All']].map(([d, l]) => `<button data-d="${d}" class="${d === days ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="chart-box lg" style="margin-top:12px"><canvas id="nw"></canvas></div></div>
    <div class="grid g2" style="margin-top:16px"><div class="card"><div class="card-h"><h2>Assets</h2><strong class="pos num">${money(S.assets, { cents: false })}</strong></div><div class="list">${assets.map(x => `<a class="item" href="#/accounts"><div class="main"><div class="t">${esc(x.name)}</div><div class="s">${TYPE_LABEL[x.type]}</div></div><div class="amt num">${money(x.balance, { cents: false })}<div class="small muted">${S.assets ? (x.balance / S.assets * 100).toFixed(0) : 0}%</div></div></a>`).join('') || '<div class="empty small">—</div>'}</div></div>
      <div class="card"><div class="card-h"><h2>Liabilities</h2><strong class="neg num">${money(S.liabilities, { cents: false })}</strong></div><div class="list">${liab.map(x => `<a class="item" href="#/accounts"><div class="main"><div class="t">${esc(x.name)}</div><div class="s">${TYPE_LABEL[x.type]}${x.meta && x.meta.liability && x.meta.liability.apr ? ' · ' + x.meta.liability.apr + '% APR' : ''}</div></div><div class="amt num">${money(x.balance, { cents: false })}</div></a>`).join('') || '<div class="empty small">Debt free 🎉</div>'}</div>
      <a class="btn sm" href="#/accounts?add=1" style="margin-top:10px">+ Add asset or debt</a></div></div>
    <div id="homesSlot" style="margin-top:16px"></div>`;
    homesCard($('#homesSlot', el)).catch(e => { $('#homesSlot', el).innerHTML = `<div class="card small muted">${esc(e.message)}</div>`; });
    $$('#rng button', el).forEach(b => b.onclick = () => { days = Number(b.dataset.d); draw(); });
    chart($('#nw'), { type: 'line', data: { labels: h.map(p => fdate(p.date, { month: 'short', day: 'numeric', year: '2-digit' })), datasets: [
      { data: h.map(p => p.net), borderColor: cssVar('--accent'), backgroundColor: cssVar('--accent') + '22', fill: true, pointRadius: 0, tension: .2, borderWidth: 2.5, label: 'Net worth' },
      { data: h.map(p => p.assets), borderColor: cssVar('--pos'), pointRadius: 0, borderWidth: 1.2, borderDash: [4, 4], label: 'Assets' },
      { data: h.map(p => -p.liabilities), borderColor: cssVar('--neg'), pointRadius: 0, borderWidth: 1.2, borderDash: [4, 4], label: 'Debts' }] },
      options: { scales: { y: { ticks: moneyTick }, x: { ticks: { maxTicksLimit: 8 } } }, plugins: { legend: { display: true, position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${money(Math.abs(c.raw))}` } } } } });
  };
  await draw();
};

// ======================= GOALS =======================
VIEWS.goals = async el => {
  const goals = await api('/goals');
  el.innerHTML = `<div class="toolbar"><span class="grow muted small">Set aside money for what matters. Link a savings account to track it automatically.</span><button class="btn primary" id="addG">+ New goal</button></div>
  <div class="grid g3">${goals.map(g => {
    const pct = Math.min(1, (g.saved || 0) / g.target);
    const months = g.target_date ? Math.max(1, Math.round((pd(g.target_date) - pd(todayISO())) / (864e5 * 30.4))) : null;
    const need = months ? Math.max(0, (g.target - g.saved) / months) : null;
    return `<div class="card" data-g="${g.id}" style="cursor:pointer"><div class="row between"><div style="font-size:28px">${esc(g.icon || '🎯')}</div>${pct >= 1 ? '<span class="pill green">Reached!</span>' : ''}</div>
      <h2 style="margin:8px 0 2px">${esc(g.name)}</h2><div class="small muted">${g.account_name ? 'Tracking ' + esc(g.account_name) : 'Manual contributions'}</div>
      <div class="row between" style="margin-top:12px"><strong class="num">${money(g.saved, { cents: false })}</strong><span class="muted small">of ${money(g.target, { cents: false })}</span></div>
      <div class="bar" style="margin-top:6px;height:10px"><span style="width:${pct * 100}%;background:${esc(g.color || cssVar('--accent'))}"></span></div>
      <div class="small muted" style="margin-top:8px">${need != null && pct < 1 ? `Save <strong>${money(need, { cents: false })}/mo</strong> to reach it by ${fdate(g.target_date, { month: 'short', year: 'numeric' })}` : g.target_date ? 'Target ' + fdate(g.target_date, { month: 'short', year: 'numeric' }) : ''}</div></div>`;
  }).join('') || '<div class="card empty span2"><div class="big">🏁</div>No goals yet.</div>'}</div>`;
  $('#addG', el).onclick = () => goalDrawer();
  $$('[data-g]', el).forEach(c => c.onclick = () => goalDrawer(goals.find(g => g.id === Number(c.dataset.g))));
};
function goalDrawer(g) {
  const savingsAccts = STATE.accounts.filter(a => ['depository', 'investment', 'crypto'].includes(a.type));
  openDrawer(`<h2>${g ? esc(g.name) : 'New goal'}</h2>
    ${g && !g.account_id ? `<form class="form card" id="cf"><h3>Add money</h3><div class="row"><input name="amount" type="number" step="0.01" placeholder="Amount (negative to withdraw)" required><button class="btn primary">Add</button></div></form>` : ''}
    <form class="form" id="gf" style="margin-top:12px"><div class="two"><label class="f"><span>Icon</span><input name="icon" value="${esc(g ? g.icon : '🎯')}" maxlength="4"></label><label class="f"><span>Color</span><input name="color" type="color" value="${esc(g ? g.color : '#6366f1')}"></label></div>
      <label class="f"><span>Name</span><input name="name" required value="${esc(g ? g.name : '')}" placeholder="Emergency fund, new car, vacation…"></label>
      <div class="two"><label class="f"><span>Target amount</span><input name="target" type="number" step="1" required value="${g ? g.target : ''}"></label><label class="f"><span>Target date</span><input name="target_date" type="date" value="${g ? g.target_date || '' : ''}"></label></div>
      ${!g ? '<label class="f"><span>Already saved</span><input name="saved" type="number" step="0.01" value="0"></label>' : ''}
      <label class="f"><span>Track an account's balance (optional)</span><select name="account_id"><option value="">No — I'll add contributions</option>${acctOptions(g && g.account_id, savingsAccts)}</select></label>
      <div class="row"><button class="btn primary">Save</button><span style="flex:1"></span>${g ? '<button type="button" class="btn danger" id="delG">Delete</button>' : ''}</div></form>
    ${g && g.events.length ? `<div class="card" style="margin-top:12px"><h3>History</h3><div class="list">${g.events.map(e => `<div class="item" style="cursor:default"><div class="main">${fdate(e.date, { month: 'short', day: 'numeric', year: 'numeric' })}</div><div class="amt">${txAmt(e.amount)}</div></div>`).join('')}</div></div>` : ''}`, el => {
    $('#gf', el).onsubmit = async e => { e.preventDefault(); const f = formData(e.target); f.account_id = f.account_id ? Number(f.account_id) : null; await run(e.submitter, () => g ? api('/goals/' + g.id, { method: 'PATCH', body: f }) : api('/goals', { method: 'POST', body: f }), 'Saved'); closeDrawer(); route(); };
    if ($('#cf', el)) $('#cf', el).onsubmit = async e => { e.preventDefault(); await run(e.submitter, () => api(`/goals/${g.id}/contribute`, { method: 'POST', body: formData(e.target) }), 'Added'); closeDrawer(); route(); };
    if ($('#delG', el)) $('#delG', el).onclick = async () => { if (!confirm('Delete this goal?')) return; await api('/goals/' + g.id, { method: 'DELETE' }); closeDrawer(); route(); };
  });
}

// ======================= LOWER MY BILLS =======================
VIEWS.negotiate = async el => {
  const n = await api('/negotiations');
  el.innerHTML = `<div class="grid g3"><div class="card stat"><div class="label">Saved by negotiating</div><div class="value num pos">${money(n.savedYear, { cents: false })}</div><div class="sub">over the terms you logged</div></div>
    <div class="card span2"><h2>How it works</h2><p class="small" style="margin:0">Bill-negotiation services typically keep 30–60% of the first year of savings. Doing it yourself takes ~15 minutes per bill: pick a bill below, fill in a competitor's price, and PocketFinance writes your call script. Log the result to track savings.</p></div></div>
  <div class="card" style="margin-top:16px"><h2>Bills you can negotiate</h2><div class="list">${n.candidates.map(c => `<div class="item" data-c="${c.id}"><div class="ico">${catIcon(c.category)}</div><div class="main"><div class="t">${esc(c.custom_name || c.name)}</div><div class="s">${esc(c.category)} · ${CAD_LABEL[c.cadence]}</div></div><div class="amt num">${money(c.amount)}</div></div>`).join('') || '<div class="empty small">No phone, internet, TV, insurance or subscription bills detected yet.</div>'}</div></div>
  <div class="card" style="margin-top:16px"><div class="card-h"><h2>Negotiation log</h2><button class="btn sm" id="logBtn">+ Log result</button></div>
    ${n.rows.length ? `<table class="t"><thead><tr><th>Provider</th><th>Before</th><th>After</th><th>Saved</th><th></th></tr></thead><tbody>${n.rows.map(r => `<tr><td><strong>${esc(r.provider)}</strong><div class="small muted">${fdate(r.date, { month: 'short', day: 'numeric', year: 'numeric' })} · ${esc(r.status)}</div></td><td class="num">${money(r.before_amount)}</td><td class="num">${money(r.after_amount)}</td><td class="num pos">${r.status === 'won' ? money((r.before_amount - r.after_amount) * r.months, { cents: false }) : '—'}</td><td><button class="btn sm danger" data-del="${r.id}">✕</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty small">Nothing logged yet.</div>'}</div>`;
  $$('[data-c]', el).forEach(i => i.onclick = () => negotiateDrawer(n.candidates.find(c => c.id === Number(i.dataset.c))));
  $('#logBtn', el).onclick = () => negotiateDrawer(null);
  $$('[data-del]', el).forEach(b => b.onclick = async () => { await api('/negotiations/' + b.dataset.del, { method: 'DELETE' }); route(); });
};
function negotiateDrawer(c) {
  const name = c ? c.custom_name || c.name : '';
  openDrawer(`<h2>${c ? 'Lower ' + esc(name) : 'Log a negotiation'}</h2>
    ${c ? `<form class="form" id="sc"><div class="two"><label class="f"><span>Competitor / offer</span><input name="comp" placeholder="e.g. T-Mobile Home Internet"></label><label class="f"><span>Their price</span><input name="price" type="number" step="0.01" placeholder="50"></label></div>
      <label class="f"><span>Years as a customer</span><input name="years" type="number" value="3"></label><button class="btn">Write my script</button></form><div id="script"></div>
      <div class="card" style="margin-top:12px"><h3>Tips</h3><ul class="small">${(c.tips || []).map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    <form class="form card" id="lf" style="margin-top:12px"><h3>Log the result</h3><label class="f"><span>Provider</span><input name="provider" value="${esc(name)}" required></label>
      <div class="two"><label class="f"><span>Price before</span><input name="before_amount" type="number" step="0.01" value="${c ? c.amount : ''}" required></label><label class="f"><span>Price after</span><input name="after_amount" type="number" step="0.01" required></label></div>
      <div class="two"><label class="f"><span>For how many months</span><input name="months" type="number" value="12"></label><label class="f"><span>Outcome</span><select name="status"><option value="won">Lowered</option><option value="lost">No luck</option><option value="planned">Will call</option></select></label></div>
      <label class="f"><span>Notes</span><input name="notes" placeholder="Rep name, promo end date…"></label><button class="btn primary">Save</button></form>`, el => {
    if ($('#sc', el)) $('#sc', el).onsubmit = e => {
      e.preventDefault(); const f = formData(e.target);
      const s = `"Hi, I've been a ${name} customer for ${f.years || 'several'} years and I'm reviewing my monthly bills. I'm currently paying ${money(c.amount)}${c.cadence !== 'monthly' ? ' ' + CAD_LABEL[c.cadence].toLowerCase() : ' a month'}.${f.comp ? ` ${f.comp} is offering me comparable service for ${f.price ? money(+f.price) : 'less'}.` : ''} I'd prefer to stay, but I need my bill to come down. What can you do to lower my rate?"

If they offer nothing: "Can you transfer me to the retention / loyalty department? I'm ready to cancel today if we can't find something."

If they offer a discount: "Thanks — how long does that price last, and are there any new fees or contract terms? Can you send that in writing?"

Before hanging up: confirm the new monthly total, the start date, and write down the rep's name and a reference number.`;
      $('#script', el).innerHTML = `<pre class="letter" style="margin-top:12px">${esc(s)}</pre><button class="btn sm" id="cp">Copy script</button>`;
      $('#cp', el).onclick = () => navigator.clipboard.writeText(s).then(() => toast('Copied'));
    };
    $('#lf', el).onsubmit = async e => { e.preventDefault(); await run(e.submitter, () => api('/negotiations', { method: 'POST', body: { ...formData(e.target), recurring_id: c ? c.id : null } }), 'Logged'); closeDrawer(); route(); };
  });
}

// ======================= CREDIT =======================
VIEWS.credit = async el => {
  const c = await api('/credit');
  const last = c.scores[c.scores.length - 1], prev = c.scores[c.scores.length - 2];
  el.innerHTML = `<div class="grid g3"><div class="card"><div class="muted small">Latest score</div>${last ? `<div class="score">${last.score}</div><span class="pill acc">${scoreBand(last.score)}</span>
      ${prev ? ` <span class="small ${last.score >= prev.score ? 'pos' : 'neg'}">${last.score >= prev.score ? '▲' : '▼'} ${Math.abs(last.score - prev.score)} since ${fdate(prev.date)}</span>` : ''}<div class="small muted" style="margin-top:6px">${esc(last.bureau || '')} · ${fdate(last.date, { month: 'short', day: 'numeric', year: 'numeric' })}</div>` : '<div class="empty small">Log your first score →</div>'}</div>
    <div class="card"><div class="muted small">Credit card utilization</div><div class="score" style="font-size:44px">${c.utilization != null ? c.utilization + '%' : '—'}</div><div class="small muted">${c.utilization == null ? 'Add credit limits to your cards to see this.' : c.utilization <= 10 ? 'Excellent — under 10%.' : c.utilization <= 30 ? 'Good — keep it under 30%.' : 'High — paying cards down before the statement date can lift your score.'}</div></div>
    <form class="card form" id="sf"><h2>Log a score</h2><div class="two"><input name="score" type="number" min="300" max="900" placeholder="Score" required><input name="date" type="date" value="${todayISO()}"></div>
      <select name="bureau"><option>VantageScore 3.0 (TransUnion)</option><option>VantageScore 3.0 (Equifax)</option><option>FICO 8 (Experian)</option><option>FICO 8 (TransUnion)</option><option>FICO 8 (Equifax)</option><option>Other</option></select><button class="btn primary">Save</button></form></div>
  <div class="card" style="margin-top:16px"><h2>History</h2><div class="chart-box"><canvas id="cs"></canvas></div></div>
  <div class="grid g2" style="margin-top:16px"><div class="card"><h2>Check your score for free</h2><ul class="small"><li>Most credit cards show a free FICO or VantageScore in their app (Discover, Capital One, Chase, Amex, Citi).</li>
    <li><a href="https://www.annualcreditreport.com" target="_blank" rel="noopener">AnnualCreditReport.com</a> — free weekly reports from all three bureaus (the only official site).</li>
    <li><a href="https://www.experian.com/consumer-products/free-credit-report.html" target="_blank" rel="noopener">Experian</a> — free FICO 8 score monthly.</li><li>Credit Karma — free TransUnion &amp; Equifax VantageScores.</li></ul>
    <p class="small muted">PocketFinance can't pull bureau data itself (that needs a licensed credit-bureau contract), so log scores here to track the trend.</p></div>
    <div class="card"><h2>What moves your score</h2><ul class="small"><li><strong>Payment history (35%)</strong> — never miss a due date; turn on autopay for the minimum.</li><li><strong>Utilization (30%)</strong> — keep balances under 30%, ideally under 10%.</li>
    <li><strong>Credit age (15%)</strong> — keep old no-fee cards open.</li><li><strong>Credit mix (10%)</strong> and <strong>new credit (10%)</strong> — avoid many applications at once.</li><li>Freeze your credit at all three bureaus when you're not applying — it's free.</li></ul></div></div>
  ${c.scores.length ? `<div class="card" style="margin-top:16px"><table class="t"><thead><tr><th>Date</th><th>Score</th><th>Model</th><th></th></tr></thead><tbody>${[...c.scores].reverse().map(s => `<tr><td>${fdate(s.date, { month: 'short', day: 'numeric', year: 'numeric' })}</td><td><strong>${s.score}</strong></td><td class="small muted">${esc(s.bureau)}</td><td><button class="btn sm danger" data-del="${s.id}">✕</button></td></tr>`).join('')}</tbody></table></div>` : ''}`;
  $('#sf', el).onsubmit = async e => { e.preventDefault(); await run(e.submitter, () => api('/credit', { method: 'POST', body: formData(e.target) }), 'Saved'); route(); };
  $$('[data-del]', el).forEach(b => b.onclick = async () => { await api('/credit/' + b.dataset.del, { method: 'DELETE' }); route(); });
  chart($('#cs'), { type: 'line', data: { labels: c.scores.map(s => fdate(s.date, { month: 'short', year: '2-digit' })), datasets: [{ data: c.scores.map(s => s.score), borderColor: cssVar('--accent'), pointRadius: 4, tension: .25, borderWidth: 2.5 }] }, options: { scales: { y: { suggestedMin: 550, suggestedMax: 850 } } } });
};

// ======================= SETTINGS =======================
VIEWS.settings = async el => {
  if (STATE.user && STATE.user.role !== 'owner') return memberSettings(el);
  const [s, rules, cal, tst] = await Promise.all([api('/settings'), api('/rules'), api('/calendar'), api('/teller/status')]);
  await loadCats(true);
  const N = s.notify || {};
  el.innerHTML = `<div id="connSlot" style="margin-bottom:16px"></div><div class="grid g2">
  <form class="card form" id="plaidF"><h2>🏦 Plaid (banks, cards, loans, investments)</h2>
    <p class="small muted" style="margin:0">Get keys at <a href="https://dashboard.plaid.com/developers/keys" target="_blank" rel="noopener">dashboard.plaid.com → Developers → Keys</a>. Sandbox is free for testing (user <span class="kbd">user_good</span> / <span class="kbd">pass_good</span>). Production connects real banks.</p>
    <label class="f"><span>client_id</span><input name="client_id" value="${esc(s.plaid.client_id)}" autocomplete="off"></label>
    <label class="f"><span>Secret ${s.plaid.has_secret ? '(saved — leave blank to keep)' : ''}</span><input name="secret" type="password" autocomplete="off" placeholder="${s.plaid.has_secret ? '••••••••' : ''}"></label>
    <div class="two"><label class="f"><span>Environment</span><select name="env"><option value="sandbox" ${s.plaid.env === 'sandbox' ? 'selected' : ''}>Sandbox (test data)</option><option value="production" ${s.plaid.env === 'production' ? 'selected' : ''}>Production (real banks)</option></select></label>
    <label class="f"><span>OAuth redirect URI (optional)</span><input name="redirect_uri" value="${esc(s.plaid.redirect_uri)}" placeholder="https://…/oauth"></label></div>
    <div class="row"><button class="btn primary">Save Plaid keys</button>${s.plaid.has_secret && s.plaid.env === 'sandbox' ? '<button type="button" class="btn" id="sbx">Add a sandbox test bank</button>' : ''}</div></form>
  <div class="card"><h2>⚡ Teller (Chase, BofA, Wells Fargo, Citi, Amex…)</h2>
    <p class="small muted" style="margin:0 0 8px">Direct US bank connections, free for personal use. ${tst.configured ? `<span class="pill green">${tst.env}${tst.has_cert ? ' · certificate saved' : ''}</span>` : ''}</p>${tellerSetupHTML(tst)}</div>
  <div class="card"><h2>🔌 Other integrations</h2><div class="list">
    <div class="item" style="cursor:default"><div class="ico">🔗</div><div class="main"><div class="t">SimpleFIN Bridge</div><div class="s">Paste a setup token from Accounts → Add account.</div></div></div>
    <div class="item" style="cursor:default"><div class="ico">🪙</div><div class="main"><div class="t">Crypto wallets &amp; prices</div><div class="s">mempool.space, publicnode RPC, CoinGecko — no keys needed.</div></div></div>
    <div class="item" style="cursor:default"><div class="ico">📄</div><div class="main"><div class="t">Imports</div><div class="s">CSV, OFX/QFX/QBO · Chase · BofA · Wells Fargo · Citi · Capital One · Amex · Discover · US Bank · BMO · RBC · TD · CIBC · Scotiabank · Mint · Monarch · YNAB · Copilot · Rocket Money · Empower</div></div></div>
    <div class="item" style="cursor:default"><div class="ico">📅</div><div class="main"><div class="t">Calendar feed (.ics)</div><div class="s kbd">${esc(location.origin + cal.url)}</div></div></div>
    <div class="item" style="cursor:default"><div class="ico">📲</div><div class="main"><div class="t">Phone push alerts (ntfy)</div><div class="s">Set up below.</div></div></div>
  </div><label class="f" style="margin-top:10px"><span>Auto-sync every</span><select id="syncH">${[1, 3, 6, 12, 24].map(h => `<option value="${h}" ${Number(s.sync_hours) === h ? 'selected' : ''}>${h} hour${h > 1 ? 's' : ''}</option>`).join('')}</select></label></div>

  <form class="card form" id="notifF"><h2>🔔 Alerts &amp; phone notifications</h2>
    <p class="small muted" style="margin:0">Install the free <strong>ntfy</strong> app (Android/iOS), subscribe to a hard-to-guess topic name, and enter the same topic here. Anyone who knows the topic can read the alerts, so make it random — or use your own ntfy server with a token.</p>
    <div class="two"><label class="f"><span>ntfy topic</span><input name="ntfy_topic" value="${esc(N.ntfy_topic || '')}" placeholder="pocketpilot-${Math.random().toString(36).slice(2, 10)}"></label><label class="f"><span>ntfy server</span><input name="ntfy_server" value="${esc(N.ntfy_server || 'https://ntfy.sh')}"></label></div>
    <label class="f"><span>Access token (self-hosted, optional)</span><input name="ntfy_token" type="password" value="${esc(N.ntfy_token || '')}"></label>
    <div class="two"><label class="f"><span>Low balance below</span><input name="low_balance" type="number" value="${s.thresholds.low_balance}"></label><label class="f"><span>Large charge over</span><input name="large_tx" type="number" value="${s.thresholds.large_tx}"></label></div>
    <label class="f"><span>Remind me about bills this many days ahead</span><input name="bill_days" type="number" min="0" max="14" value="${s.thresholds.bill_days}"></label>
    <div class="row"><button class="btn primary">Save</button><button type="button" class="btn" id="testN">Send test</button></div></form>

  <div class="card"><h2>🏷️ Categories</h2><div style="max-height:260px;overflow:auto" class="list">${STATE.cats.map(c => `<div class="item" style="cursor:default"><div class="ico">${c.icon}</div><div class="main"><div class="t">${esc(c.name)}</div><div class="s">${esc(c.grp)} · ${c.kind}</div></div>${c.name !== 'Uncategorized' ? `<button class="btn sm danger" data-delcat="${esc(c.name)}">✕</button>` : ''}</div>`).join('')}</div>
    <form class="form" id="catF" style="margin-top:10px"><div class="two"><input name="name" placeholder="New category" required><input name="icon" placeholder="Emoji" maxlength="4"></div><div class="two"><input name="grp" placeholder="Group (e.g. Home)"><select name="kind"><option value="expense">Expense</option><option value="income">Income</option><option value="transfer">Transfer (excluded)</option></select></div><button class="btn">Add category</button></form></div>

  <div class="card span2"><h2>⚡ Rules</h2><p class="small muted">Rules run on every new transaction. Editing a transaction with “Apply to all” creates one automatically.</p>
    <form class="form" id="ruleF"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">
      <select name="match_field"><option value="merchant">Merchant</option><option value="description">Bank description</option></select>
      <select name="match_type"><option value="contains">contains</option><option value="equals">equals</option><option value="regex">matches regex</option></select>
      <input name="pattern" placeholder="Text" required><select name="set_category"><option value="">— keep category —</option>${catOptions('')}</select>
      <input name="set_merchant" placeholder="Rename merchant to (optional)"><input name="set_tags" placeholder="Add tags, e.g. work, travel (optional)"><select name="set_excluded"><option value="">— keep —</option><option value="1">Exclude</option><option value="0">Include</option></select></div>
      <div class="row"><button class="btn primary">Add rule</button><button type="button" class="btn" id="testRule">Preview matches</button><span class="small muted" id="ruleTest"></span></div></form>
    <table class="t" style="margin-top:10px"><tbody>${rules.map(r => `<tr><td>If <strong>${r.match_field}</strong> ${r.match_type} “${esc(r.pattern)}”</td><td>${r.set_category ? '→ ' + esc(r.set_category) : ''} ${r.set_merchant ? '· rename “' + esc(r.set_merchant) + '”' : ''} ${r.set_excluded != null ? (r.set_excluded ? '· exclude' : '· include') : ''} ${r.set_tags ? '· ' + tagPills(r.set_tags) : ''}</td><td style="text-align:right"><button class="btn sm danger" data-delrule="${r.id}">✕</button></td></tr>`).join('') || '<tr><td class="muted small">No rules yet.</td></tr>'}</tbody></table></div>

  <a class="card ai-card" href="#/advisor"><div class="ai-orb">✨</div><div style="flex:1;min-width:0"><h2 style="margin:0">AI Advisor (Gemini)</h2><div class="small muted">API key, model and "about me" for personalized advice.</div></div><span class="btn sm">Open</span></a>
  <div id="phoneSlot"></div>
  <div class="card"><h2>📱 Android app</h2><p class="small muted" style="margin-top:0">Install PocketFinance on your phone. It opens this server over Tailscale (turn on the Tailscale app on your phone). Open this page on the phone, tap download, then allow installing from your browser when Android asks.</p>
    <div class="row wrap"><a class="btn primary" href="/api/app.apk" download>Download PocketFinance.apk</a><button class="btn" id="shareApp">📤 Share PocketFinance</button></div>
    <label class="f" style="margin-top:10px"><span>Download link others can use (e.g. Google Drive)</span><input id="appUrl" type="url" value="${esc(s.app_share_url || '')}" placeholder="https://drive.google.com/file/d/…"></label>
    <label class="f"><span>Link to the free Windows server (PocketFinance-Server.exe)</span><input id="srvUrl" type="url" value="${esc(s.server_share_url || '')}" placeholder="https://drive.google.com/file/d/…"></label></div>
  <div class="card"><h2>💾 Your data</h2><div class="row wrap"><a class="btn" href="/api/export/transactions.csv">Export transactions (CSV)</a><a class="btn" href="/api/export/backup.json">Full backup (JSON)</a><button class="btn" id="restoreBtn">Restore from backup…</button><input type="file" id="restoreFile" accept=".json,application/json" class="hidden"></div>
    <p class="small muted">Everything is stored on this computer in <span class="kbd">${esc(s.data_dir || 'the data folder')}</span>. Bank tokens are encrypted (AES-256-GCM).</p>
    <div id="autoBk"></div>
    <div class="row wrap">${s.demo ? '<button class="btn danger" id="demoClear">Remove demo data</button>' : '<button class="btn" id="demoLoad">Load demo data</button>'}</div></div>

  <div id="hcSlot"></div>
  <div id="hhSlot"></div>
  <div id="emailSlot"></div>
  <div class="card"><h2>🔒 Security &amp; access</h2>
    <form class="form" id="pwF"><div class="two"><input name="current" type="password" placeholder="Current password" required autocomplete="current-password"><input name="password" type="password" placeholder="New password (8+)" required minlength="8" autocomplete="new-password"></div><button class="btn">Change password</button></form>
    <label class="f" style="margin-top:12px"><span>Who can open PocketFinance</span><select id="bind"><option value="127.0.0.1" ${s.bind_host !== '0.0.0.0' ? 'selected' : ''}>Only this computer (and Tailscale serve)</option><option value="0.0.0.0" ${s.bind_host === '0.0.0.0' ? 'selected' : ''}>Devices on my home network too</option></select></label>
    <p class="small muted">Changing this restarts the server (takes a few seconds). For your phone away from home, use Tailscale.</p>
    <div class="row wrap"><label class="f"><span>Theme</span><select id="theme"><option value="">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label></div>
    <div id="devSlot"></div>
    <button class="btn" id="logout" style="margin-top:10px">Sign out</button></div>
  </div>`;
  const reload = () => route();
  $('#plaidF', el).onsubmit = async e => { e.preventDefault(); await run(e.submitter, () => api('/settings', { method: 'PUT', body: { plaid: formData(e.target) } }), 'Plaid keys saved'); reload(); };
  wireTellerSetup(el, reload);
  homeSettingsCard($('#hcSlot', el)).catch(() => {});
  connectCard($('#connSlot', el)).then(() => { if (new URLSearchParams(location.hash.split('?')[1] || '').get('connect')) $('#connSlot', el).scrollIntoView(); }).catch(() => {});
  wireRestore(el);
  autoBackupCard($('#autoBk', el)).catch(() => {});
  devicesCard($('#devSlot', el)).catch(() => {});
  emailCard($('#emailSlot', el)).catch(() => {});
  phoneCard($('#phoneSlot', el));
  householdCard($('#hhSlot', el)).catch(e => { $('#hhSlot', el).innerHTML = `<div class="card small muted">${esc(e.message)}</div>`; });
  if ($('#sbx', el)) $('#sbx', el).onclick = async e => { await run(e.target, () => api('/plaid/sandbox', { method: 'POST' }), 'Sandbox bank connected'); STATE.accounts = (await api('/accounts')).accounts; location.hash = '#/accounts'; };
  $('#syncH', el).onchange = e => api('/settings', { method: 'PUT', body: { sync_hours: Number(e.target.value) } }).then(() => toast('Saved'));
  $('#notifF', el).onsubmit = async e => { e.preventDefault(); const f = formData(e.target); await run(e.submitter, () => api('/settings', { method: 'PUT', body: { notify: { ...N, ntfy_topic: f.ntfy_topic.trim(), ntfy_server: f.ntfy_server.trim(), ntfy_token: f.ntfy_token }, thresholds: { low_balance: Number(f.low_balance), large_tx: Number(f.large_tx), bill_days: Number(f.bill_days) } } }), 'Saved'); };
  $('#testN', el).onclick = e => run(e.target, () => api('/alerts/test', { method: 'POST' }), 'Test sent — check the ntfy app');
  $$('[data-delcat]', el).forEach(b => b.onclick = async () => { if (!confirm(`Delete ${b.dataset.delcat}? Its transactions become Uncategorized.`)) return; await api('/categories/' + encodeURIComponent(b.dataset.delcat), { method: 'DELETE' }); reload(); });
  $('#catF', el).onsubmit = async e => { e.preventDefault(); await run(e.submitter, () => api('/categories', { method: 'POST', body: formData(e.target) }), 'Category added'); reload(); };
  $('#ruleF', el).onsubmit = async e => { e.preventDefault(); await run(e.submitter, () => api('/rules', { method: 'POST', body: formData(e.target) }), r => `Rule added · re-checked ${r.recategorized} transactions${r.tagged ? ` · tagged ${r.tagged}` : ''}`); reload(); };
  $('#testRule', el).onclick = async () => { const m = await api('/rules/test', { method: 'POST', body: formData($('#ruleF', el)) }); $('#ruleTest', el).textContent = m.length ? `${m.length}${m.length === 50 ? '+' : ''} matches, e.g. ${m.slice(0, 3).map(x => x.merchant).join(', ')}` : 'No matches'; };
  $$('[data-delrule]', el).forEach(b => b.onclick = async () => { await api('/rules/' + b.dataset.delrule, { method: 'DELETE' }); reload(); });
  if ($('#demoLoad', el)) $('#demoLoad', el).onclick = async e => { await run(e.target, () => api('/demo/load', { method: 'POST' }), 'Demo data loaded'); STATE.accounts = (await api('/accounts')).accounts; location.hash = '#/dashboard'; refreshBell(); };
  if ($('#demoClear', el)) $('#demoClear', el).onclick = async e => { await run(e.target, () => api('/demo/clear', { method: 'POST' }), 'Demo data removed'); STATE.accounts = (await api('/accounts')).accounts; reload(); refreshBell(); };
  $('#pwF', el).onsubmit = async e => { e.preventDefault(); await run(e.submitter, () => api('/auth/password', { method: 'POST', body: formData(e.target) }), 'Password changed'); e.target.reset(); };
  $('#bind', el).onchange = async e => { await api('/settings', { method: 'PUT', body: { bind_host: e.target.value } }); toast('Saved — PocketFinance is restarting on the new address'); };
  try { $('#theme', el).value = localStorage.getItem('pp-theme') || ''; } catch {}
  $('#theme', el).onchange = e => { const v = e.target.value; if (v) document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme; try { v ? localStorage.setItem('pp-theme', v) : localStorage.removeItem('pp-theme'); } catch {} };
  $('#logout', el).onclick = () => signOut();
  $('#shareApp', el).onclick = () => shareApp();
  $('#srvUrl', el).onchange = e => api('/settings', { method: 'PUT', body: { server_share_url: e.target.value } }).then(() => toast('Link saved'), err => toast(err.message));
  $('#appUrl', el).onchange = e => api('/settings', { method: 'PUT', body: { app_share_url: e.target.value } }).then(() => toast('Link saved'), err => toast(err.message));
};

VIEWS.more = async el => {
  el.innerHTML = `<div class="card" style="margin-bottom:12px"><div class="list"><a class="item" href="#" id="mShare"><div class="ico">📤</div><div class="main"><div class="t">Share PocketFinance</div><div class="s">Send someone the Android app</div></div><span class="muted">›</span></a><a class="item" href="#/settings?connect=1"><div class="ico">📱</div><div class="main"><div class="t">Connect your phone</div><div class="s">Address and QR code for the app</div></div><span class="muted">›</span></a></div></div><div class="card"><div class="list">${$$('#nav a').map(a => `<a class="item" href="${a.getAttribute('href')}"><div class="ico">${a.querySelector('i').textContent}</div><div class="main"><div class="t">${esc(a.querySelector('span').textContent.trim())}</div></div><span class="muted">›</span></a>`).join('')}</div></div>`;
  $('#mShare', el).onclick = e => { e.preventDefault(); shareApp(); };
};

start();
