/* Review inbox, Reports (cash-flow diagram, breakdowns, year in review), Debt payoff and Retirement planners,
   plus tags and receipts used by the transaction drawer. */
'use strict';

// ---------- shared bits ----------
const tagArr = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
const tagPills = s => tagArr(s).map(t => `<span class="tagpill">#${esc(t)}</span>`).join('');
let TAGS_CACHE = null;
async function loadTags(force) { if (!TAGS_CACHE || force) TAGS_CACHE = await api('/tags').catch(() => []); return TAGS_CACHE; }

async function refreshReview() {
  try {
    const n = (await api('/transactions?review=1&limit=1')).total.n;
    $$('[data-r="review"]').forEach(a => { let b = a.querySelector('b.cnt'); if (!b) { b = document.createElement('b'); b.className = 'cnt'; a.appendChild(b); } b.textContent = n > 99 ? '99+' : n; b.classList.toggle('hidden', !n); });
    return n;
  } catch { return 0; }
}

function download(name, text, type = 'text/csv') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const csvCell = v => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const pctChange = (a, b, invert) => { if (!b) return ''; const p = (a - b) / Math.abs(b) * 100; const good = invert ? p < 0 : p > 0; return `<span class="small ${good ? 'pos' : 'neg'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p).toFixed(0)}%</span>`; };

// ---------- receipts (mounted inside the transaction drawer) ----------
async function wireReceipts(box, txId) {
  const draw = async () => {
    const list = await api(`/transactions/${txId}/attachments`);
    box.innerHTML = `<div class="row between"><h3 style="margin:0">Receipts &amp; files</h3><label class="btn sm">📎 Attach<input type="file" accept="image/*,application/pdf" multiple hidden id="attIn"></label></div>
      <div class="att-grid">${list.map(a => `<div class="att" data-id="${a.id}">
        <a href="/api/attachments/${a.id}" target="_blank" rel="noopener">${a.mime.startsWith('image/') && a.mime !== 'image/heic' ? `<img src="/api/attachments/${a.id}" alt="${esc(a.filename)}">` : `<span class="att-doc">${a.mime === 'application/pdf' ? 'PDF' : 'FILE'}</span>`}</a>
        <div class="att-n" title="${esc(a.filename)}">${esc(a.filename)}</div><button type="button" class="icon-btn att-x" title="Remove" data-del="${a.id}">✕</button></div>`).join('')
        || '<div class="small muted">Snap a photo of the receipt or attach a PDF invoice — handy for returns, warranties and taxes.</div>'}</div>`;
    $('#attIn', box).onchange = async e => {
      for (const f of e.target.files) {
        if (f.size > 10 * 1024 * 1024) { toast(`${f.name} is over 10 MB`); continue; }
        const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
        try { await api(`/transactions/${txId}/attachments`, { method: 'POST', body: { filename: f.name, data } }); } catch (err) { toast(err.message, 4500); }
      }
      draw();
    };
    $$('[data-del]', box).forEach(b => b.onclick = async () => { if (!confirm('Remove this file?')) return; await api(`/attachments/${b.dataset.del}`, { method: 'DELETE' }); draw(); });
  };
  await draw();
}

// ======================= REVIEW INBOX =======================
VIEWS.review = async el => {
  const r = await api('/transactions?review=1&limit=500');
  el.innerHTML = `<div class="card review-head"><div class="row between wrap"><div><h2 style="margin:0">${r.total.n ? `${r.total.n} new transaction${r.total.n > 1 ? 's' : ''} to review` : 'All caught up'}</h2>
      <div class="small muted">Check the category, add tags or a receipt, then tick it off. New transactions from the last 30 days land here.</div></div>
      ${r.total.n ? '<button class="btn primary" id="allOk">✓ Mark all reviewed</button>' : ''}</div></div>
    <div class="card" style="margin-top:16px"><div class="list" id="rvList">${r.rows.length ? r.rows.map(t => `<div class="item rv" data-id="${t.id}">
      <div class="ico">${t.logo ? `<img src="${esc(t.logo)}" alt="" referrerpolicy="no-referrer">` : (t.icon || catIcon(t.category))}</div>
      <div class="main"><div class="t"><a href="#" data-open="${t.id}">${esc(t.merchant)}</a>${t.pending ? ' <span class="pill amber">Pending</span>' : ''} ${tagPills(t.tags)}</div>
        <div class="s">${fdate(t.date, { weekday: 'short', month: 'short', day: 'numeric' })} · ${esc(t.account_name)}${t.att ? ' · 📎' + t.att : ''}</div></div>
      <select class="rv-cat" aria-label="Category">${catOptions(t.category)}</select>
      <div class="amt">${txAmt(t.amount)}</div>
      <button class="btn sm rv-ok" title="Mark reviewed">✓</button></div>`).join('')
      : '<div class="empty"><div class="big">🎉</div>Nothing to review. New transactions will show up here after each sync.</div>'}</div></div>`;
  const done = row => { row.classList.add('gone'); setTimeout(() => { row.remove(); if (!$('.rv', el)) route(); }, 250); refreshReview(); };
  $$('.rv', el).forEach(row => {
    const id = Number(row.dataset.id);
    $('.rv-ok', row).onclick = async () => { await api('/transactions/review', { method: 'POST', body: { ids: [id] } }); done(row); };
    $('.rv-cat', row).onchange = async e => { await api(`/transactions/${id}`, { method: 'PATCH', body: { category: e.target.value, reviewed: true } }); toast('Category saved'); done(row); };
    $('[data-open]', row).onclick = e => { e.preventDefault(); editTx(id, () => { route(); }); };
  });
  if ($('#allOk', el)) $('#allOk', el).onclick = e => run(e.target, async () => { await api('/transactions/review', { method: 'POST', body: { all: true } }); refreshReview(); route(); }, 'All reviewed');
};

// ======================= REPORTS =======================
function rangeFor(preset) {
  const t = pd(todayISO()), y = t.getFullYear(), m = t.getMonth();
  const d = (yy, mm, dd) => iso(new Date(yy, mm, dd));
  switch (preset) {
    case 'last-month': return [d(y, m - 1, 1), d(y, m, 0)];
    case '3m': return [d(y, m - 2, 1), todayISO()];
    case '6m': return [d(y, m - 5, 1), todayISO()];
    case 'ytd': return [d(y, 0, 1), todayISO()];
    case 'last-year': return [d(y - 1, 0, 1), d(y - 1, 11, 31)];
    case '12m': return [d(y, m - 11, 1), todayISO()];
    default: return [d(y, m, 1), todayISO()];
  }
}
const PRESETS = [['month', 'This month'], ['last-month', 'Last month'], ['3m', 'Last 3 months'], ['6m', 'Last 6 months'], ['ytd', 'Year to date'], ['12m', 'Last 12 months'], ['last-year', 'Last year'], ['custom', 'Custom']];

// Three-column cash-flow diagram: income sources -> money in -> where it went (+ saved)
function sankeySVG(sk, detail) {
  const left = sk.income.map(i => ({ name: i.name, v: i.total, color: i.color || cssVar('--pos') }));
  if (sk.fromSavings > 0.5) left.push({ name: 'From savings', v: sk.fromSavings, color: cssVar('--warn') });
  let right;
  if (detail === 'category') {
    const cats = sk.groups.flatMap(g => g.children).sort((a, b) => b.total - a.total);
    right = cats.slice(0, 14).map(c => ({ name: c.name, v: c.total, color: c.color || '#94a3b8' }));
    const rest = cats.slice(14).reduce((s, c) => s + c.total, 0); if (rest > 0) right.push({ name: `${cats.length - 14} more`, v: rest, color: '#94a3b8' });
  } else right = sk.groups.map(g => ({ name: g.name, v: g.total, color: g.color || '#94a3b8' }));
  if (sk.saved > 0.5) right.push({ name: 'Saved', v: sk.saved, color: cssVar('--pos') });
  const total = left.reduce((s, x) => s + x.v, 0);
  if (!total || !right.length) return '<div class="empty small">Not enough income and spending in this range to draw the flow.</div>';
  // fixed pixel scale for the flows; every node gets a slot tall enough for its two-line label
  const W = 720, GAP = 8, SLOT = 34, top = 26, FLOW = Math.max(220, Math.min(420, Math.max(left.length, right.length) * 30));
  const scale = FLOW / total, NW = 12, xL = 150, xM = 354, xR = 558;
  const colH = arr => arr.reduce((s, n) => s + Math.max(SLOT, n.v * scale), 0) + GAP * (arr.length - 1);
  const H = Math.max(colH(left), colH(right), FLOW) + top * 2;
  const place = arr => { let y = top + (H - top * 2 - colH(arr)) / 2; return arr.map(n => { const h = Math.max(2, n.v * scale), slot = Math.max(SLOT, h); const o = { ...n, y: y + (slot - h) / 2, h, mid: y + slot / 2 }; y += slot + GAP; return o; }); };
  const L = place(left), R = place(right);
  const mH = FLOW, mY = top + (H - top * 2 - mH) / 2;
  const band = (x1, y1, h1, x2, y2, h2, color) => { const c = (x1 + x2) / 2;
    return `<path d="M${x1},${y1} C${c},${y1} ${c},${y2} ${x2},${y2} L${x2},${y2 + h2} C${c},${y2 + h2} ${c},${y1 + h1} ${x1},${y1 + h1} Z" fill="${color}" fill-opacity=".28"></path>`; };
  let out = '', ym = mY;
  for (const n of L) { const h = n.v * scale; out += band(xL + NW, n.y, n.h, xM, ym, h, n.color); ym += h; }
  ym = mY;
  for (const n of R) { const h = n.v * scale; out += band(xM + NW, ym, h, xR, n.y, n.h, n.color); ym += h; }
  const pct = v => (v / total * 100).toFixed(v / total < 0.1 ? 1 : 0) + '%';
  const node = (n, x, anchor, tx) => `<rect x="${x}" y="${n.y}" width="${NW}" height="${n.h}" rx="3" fill="${n.color}"><title>${esc(n.name)}: ${money(n.v)}</title></rect>
    <text x="${tx}" y="${n.mid - 2}" text-anchor="${anchor}" class="sk-n">${esc(n.name)}</text><text x="${tx}" y="${n.mid + 13}" text-anchor="${anchor}" class="sk-v">${money(n.v, { cents: false })} · ${pct(n.v)}</text>`;
  out += L.map(n => node(n, xL, 'end', xL - 10)).join('') + R.map(n => node(n, xR, 'start', xR + NW + 10)).join('');
  out += `<rect x="${xM}" y="${mY}" width="${NW}" height="${mH}" rx="3" fill="${cssVar('--accent')}"></rect>
    <text x="${xM + NW / 2}" y="${Math.max(14, mY - 8)}" text-anchor="middle" class="sk-n">Money in ${money(total, { cents: false })}</text>`;
  return `<div class="sk-wrap"><svg class="sk" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cash flow diagram">${out}</svg></div>`;
}

VIEWS.reports = async (el, q) => {
  const st = { tab: q.get('tab') || 'flow', preset: q.get('preset') || 'month', from: q.get('from') || '', to: q.get('to') || '', groupBy: q.get('by') || 'category',
    account: q.get('account') || '', tag: q.get('tag') || '', detail: 'group', year: Number(q.get('year')) || pd(todayISO()).getFullYear() };
  if (st.preset !== 'custom' || !st.from) [st.from, st.to] = rangeFor(st.preset === 'custom' ? 'month' : st.preset);
  const tags = await loadTags(true);
  const save = () => { const p = new URLSearchParams({ tab: st.tab, preset: st.preset, by: st.groupBy }); if (st.preset === 'custom') { p.set('from', st.from); p.set('to', st.to); }
    if (st.account) p.set('account', st.account); if (st.tag) p.set('tag', st.tag); if (st.tab === 'year' || st.tab === 'tax') p.set('year', st.year); history.replaceState(null, '', '#/reports?' + p); };
  const shell = () => {
    el.innerHTML = `<div class="toolbar wrap"><div class="seg" id="tabs">${[['flow', 'Cash flow'], ['breakdown', 'Breakdown'], ['year', 'Year in review'], ['tax', 'Taxes']].map(([k, l]) => `<button data-k="${k}" class="${st.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><span class="grow"></span>
      <span id="rangeCtl" class="row wrap ${st.tab === 'year' || st.tab === 'tax' ? 'hidden' : ''}"><select id="preset">${PRESETS.map(([k, l]) => `<option value="${k}" ${k === st.preset ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <input type="date" id="rf" value="${st.from}" title="From"><input type="date" id="rt" value="${st.to}" title="To">
      <select id="racc">${acctOptions(st.account, STATE.accounts, { any: true })}</select>
      <select id="rtag"><option value="">All tags</option>${tags.map(t => `<option value="${esc(t.name)}" ${t.name === st.tag ? 'selected' : ''}>#${esc(t.name)}</option>`).join('')}</select></span></div>
      <div id="rBody"><div class="empty muted">Loading…</div></div>`;
    $$('#tabs button', el).forEach(b => b.onclick = () => { st.tab = b.dataset.k; save(); shell(); });
    $('#preset', el).onchange = e => { st.preset = e.target.value; if (st.preset !== 'custom') [st.from, st.to] = rangeFor(st.preset); save(); shell(); };
    const custom = () => { st.preset = 'custom'; st.from = $('#rf', el).value; st.to = $('#rt', el).value; if (st.from && st.to) { save(); shell(); } };
    $('#rf', el).onchange = custom; $('#rt', el).onchange = custom;
    $('#racc', el).onchange = e => { st.account = e.target.value; save(); shell(); };
    $('#rtag', el).onchange = e => { st.tag = e.target.value; save(); shell(); };
    body($('#rBody', el)).catch(e => { $('#rBody', el).innerHTML = `<div class="card empty">⚠️ ${esc(e.message)}</div>`; });
  };
  const body = async box => {
    clearCharts();
    if (st.tab === 'year') return yearView(box);
    if (st.tab === 'tax') return taxView(box, st.year, y => { st.year = y; save(); body(box); });
    const p = new URLSearchParams({ from: st.from, to: st.to, groupBy: st.groupBy }); if (st.account) p.set('account', st.account); if (st.tag) p.set('tag', st.tag);
    const r = await api('/reports/range?' + p);
    const T = r.totals;
    const rangeLbl = `${fdate(r.from, { month: 'short', day: 'numeric', year: 'numeric' })} – ${fdate(r.to, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    const stats = `<div class="grid g4"><div class="card stat"><div class="label">Income</div><div class="value num pos">${money(T.income, { cents: false })}</div><div class="sub">${pctChange(T.income, r.prev.income)} vs previous ${r.days} days</div></div>
      <div class="card stat"><div class="label">Spending</div><div class="value num">${money(T.spending, { cents: false })}</div><div class="sub">${pctChange(T.spending, r.prev.spending, true)} · ${money(T.perDay)}/day</div></div>
      <div class="card stat"><div class="label">${T.net >= 0 ? 'Saved' : 'Overspent'}</div><div class="value num ${T.net >= 0 ? 'pos' : 'neg'}">${money(Math.abs(T.net), { cents: false })}</div><div class="sub">${T.count} purchases</div></div>
      <div class="card stat"><div class="label">Savings rate</div><div class="value num">${T.savingsRate == null ? '—' : T.savingsRate.toFixed(0) + '%'}</div><div class="sub">${rangeLbl}</div></div></div>`;
    if (st.tab === 'flow') {
      box.innerHTML = `${stats}<div class="card" style="margin-top:16px"><div class="card-h wrap"><div><h2>Where your money went</h2><div class="small muted">${rangeLbl}${st.tag ? ' · #' + esc(st.tag) : ''}</div></div>
        <div class="seg" id="det"><button data-k="group" class="${st.detail === 'group' ? 'on' : ''}">Groups</button><button data-k="category" class="${st.detail === 'category' ? 'on' : ''}">Categories</button></div></div>
        <div id="sk">${sankeySVG(r.sankey, st.detail)}</div></div>
        ${r.monthly.length > 1 ? `<div class="card" style="margin-top:16px"><h2>Month by month</h2><div class="chart-box lg"><canvas id="mm"></canvas></div></div>` : ''}`;
      $$('#det button', box).forEach(b => b.onclick = () => { st.detail = b.dataset.k; $$('#det button', box).forEach(x => x.classList.toggle('on', x === b)); $('#sk', box).innerHTML = sankeySVG(r.sankey, st.detail); });
      if (r.monthly.length > 1) chart($('#mm', box), { type: 'bar', data: { labels: r.monthly.map(m => fdate(m.month + '-01', { month: 'short', year: '2-digit' })), datasets: [
        { type: 'line', data: r.monthly.map(m => m.net), borderColor: cssVar('--accent'), pointRadius: 3, tension: .25, label: 'Net', order: 0 },
        { data: r.monthly.map(m => m.income), backgroundColor: cssVar('--pos'), borderRadius: 5, label: 'Income', order: 1 },
        { data: r.monthly.map(m => m.spending), backgroundColor: cssVar('--neg'), borderRadius: 5, label: 'Spending', order: 1 }] },
        options: { scales: { y: { ticks: moneyTick } }, plugins: { legend: { display: true, position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${money(c.raw)}` } } } } });
      return;
    }
    // breakdown
    const G = r.groups, tot = G.reduce((s, g) => s + g.total, 0) || 1;
    const link = g => { const base = `from=${r.from}&to=${r.to}`;
      if (st.groupBy === 'category') return `#/transactions?category=${encodeURIComponent(g.name)}&${base}`;
      if (st.groupBy === 'merchant') return `#/transactions?merchant_key=${encodeURIComponent(g.key)}&${base}`;
      if (st.groupBy === 'account') return `#/transactions?account=${g.key}&${base}`;
      if (st.groupBy === 'tag' && g.name !== '(no tag)') return `#/transactions?tag=${encodeURIComponent(g.name)}&${base}`;
      return null; };
    const palette = ['#6d4aff', '#0ea5a4', '#e0418f', '#e08a00', '#2f80ed', '#0f9f6e', '#e5484d', '#8b5cf6', '#06b6d4', '#a16207', '#64748b', '#f97316'];
    const col = (g, i) => g.color || palette[i % palette.length];
    box.innerHTML = `${stats}<div class="card" style="margin-top:16px"><div class="card-h wrap"><h2>Spending by</h2>
      <div class="seg" id="gb">${[['category', 'Category'], ['group', 'Group'], ['merchant', 'Merchant'], ['account', 'Account'], ['tag', 'Tag']].map(([k, l]) => `<button data-k="${k}" class="${st.groupBy === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <button class="btn sm" id="csv">⬇ CSV</button></div>
      ${G.length ? `<div class="chart-box" style="height:${Math.min(12, G.length) * 30 + 30}px"><canvas id="gbar"></canvas></div>
      <table class="t rep-t"><thead><tr><th>${{ category: 'Category', group: 'Group', merchant: 'Merchant', account: 'Account', tag: 'Tag' }[st.groupBy]}</th><th class="num">Amount</th><th class="num">Share</th><th class="num hide-sm">Count</th>${G[0].prev != null ? '<th class="num hide-sm">vs before</th>' : ''}</tr></thead>
      <tbody>${G.map((g, i) => { const l = link(g); return `<tr><td><span class="legend-dot" style="background:${col(g, i)}"></span> ${g.icon ? g.icon + ' ' : ''}${l ? `<a href="${l}">${esc(g.name)}</a>` : esc(g.name)}</td><td class="num">${money(g.total)}</td><td class="num">${(g.total / tot * 100).toFixed(1)}%</td><td class="num hide-sm">${g.n}</td>${g.prev != null ? `<td class="num hide-sm">${pctChange(g.total, g.prev, true) || '<span class="small muted">new</span>'}</td>` : ''}</tr>`; }).join('')}</tbody></table>
      ${st.groupBy === 'tag' ? '<p class="small muted">A transaction with several tags counts toward each of them.</p>' : ''}`
      : '<div class="empty">No spending in this range.</div>'}</div>`;
    $$('#gb button', box).forEach(b => b.onclick = () => { st.groupBy = b.dataset.k; save(); body(box); });
    $('#csv', box).onclick = () => download(`pocketpilot-${st.groupBy}-${r.from}-to-${r.to}.csv`, [`${st.groupBy},amount,share,count`, ...G.map(g => [g.name, g.total.toFixed(2), (g.total / tot * 100).toFixed(1) + '%', g.n].map(csvCell).join(','))].join('\n'));
    if (G.length) { const top = G.slice(0, 12); chart($('#gbar', box), { type: 'bar', data: { labels: top.map(g => g.name), datasets: [{ data: top.map(g => g.total), backgroundColor: top.map(col), borderRadius: 6 }] },
      options: { indexAxis: 'y', scales: { x: { ticks: moneyTick }, y: { grid: { display: false } } }, plugins: { tooltip: { callbacks: { label: c => money(c.raw) } } } } }); }
  };
  const yearView = async box => {
    const y = await api('/reports/year?year=' + st.year);
    const T = y.totals;
    const years = [...new Set([...(y.years || []), y.year])].sort((a, b) => b - a);
    const fact = (ico, label, value, sub = '') => `<div class="card wr-fact"><div class="wr-ico">${ico}</div><div><div class="label">${label}</div><div class="wr-v">${value}</div>${sub ? `<div class="small muted">${sub}</div>` : ''}</div></div>`;
    box.innerHTML = `<div class="wrapped"><div class="row between wrap"><div><div class="lbl">YOUR ${y.year}${y.partial ? ' SO FAR' : ''} IN MONEY</div><div class="wr-big num">${money(T.spending, { cents: false })} spent</div>
        <div>${money(T.income, { cents: false })} earned · <strong>${T.net >= 0 ? money(T.net, { cents: false }) + ' saved' : money(-T.net, { cents: false }) + ' more out than in'}</strong>${T.savingsRate != null ? ` · ${T.savingsRate.toFixed(0)}% savings rate` : ''}</div></div>
        <select id="yr">${years.map(v => `<option ${v === y.year ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        ${y.prev.spending ? `<div class="small" style="margin-top:8px;opacity:.9">vs ${y.year - 1}: spending ${pctChange(T.spending, y.prev.spending, true).replace(/class="small (pos|neg)"/, 'class="small"')} · income ${pctChange(T.income, y.prev.income).replace(/class="small (pos|neg)"/, 'class="small"')}</div>` : ''}</div>
      <div class="grid g3" style="margin-top:16px">
        ${y.topCategories[0] ? fact(y.topCategories[0].icon || '🏷️', 'Top category', esc(y.topCategories[0].name), money(y.topCategories[0].total, { cents: false }) + ` · ${(y.topCategories[0].total / T.spending * 100).toFixed(0)}% of spending`) : ''}
        ${y.regular ? fact('📍', 'Your regular spot', esc(y.regular.name), `${y.regular.n} visits · ${money(y.regular.total, { cents: false })}`) : ''}
        ${y.biggest ? fact('💸', 'Biggest purchase', money(y.biggest.total, { cents: false }), `${esc(y.biggest.name)} · ${fdate(y.biggest.date)}`) : ''}
        ${fact('🔄', 'Subscriptions', money(y.subscriptions, { cents: false }), 'paid to subscription services')}
        ${fact('🧘', 'No-spend days', y.noSpendDays, `out of ${y.days} days`)}
        ${y.netWorth ? fact('📈', 'Net worth change', `<span class="${y.netWorth.change >= 0 ? 'pos' : 'neg'}">${money(y.netWorth.change, { sign: true, cents: false })}</span>`, `since ${fdate(y.netWorth.since)}`) : fact('📅', 'Average day', money(T.perDay), 'spent per day')}
        ${y.priciestMonth ? fact('🔥', 'Priciest month', fmonth(y.priciestMonth.month).split(' ')[0], money(y.priciestMonth.spending, { cents: false })) : ''}
        ${y.thriftiestMonth ? fact('🌱', 'Thriftiest month', fmonth(y.thriftiestMonth.month).split(' ')[0], money(y.thriftiestMonth.spending, { cents: false })) : ''}
        ${fact('🧾', 'Average day', money(T.perDay), `${T.count.toLocaleString()} purchases in total`)}
      </div>
      <div class="grid g2" style="margin-top:16px"><div class="card"><h2>Top categories</h2>${y.topCategories.map(c => `<div style="margin:10px 0"><div class="row between small"><span>${c.icon || ''} ${esc(c.name)}</span><strong class="num">${money(c.total, { cents: false })}</strong></div>
          <div class="bar" style="margin-top:5px"><span style="width:${c.total / y.topCategories[0].total * 100}%;background:${c.color || 'var(--accent)'}"></span></div></div>`).join('') || '<div class="empty small">—</div>'}</div>
        <div class="card"><h2>Top merchants</h2><div class="list">${y.topMerchants.map((m, i) => `<div class="item" style="cursor:default"><div class="ico">${m.logo ? `<img src="${esc(m.logo)}" alt="" referrerpolicy="no-referrer">` : i + 1}</div><div class="main"><div class="t">${esc(m.name)}</div><div class="s">${m.n} purchases</div></div><div class="amt num">${money(m.total, { cents: false })}</div></div>`).join('') || '<div class="empty small">—</div>'}</div></div></div>
      <div class="card" style="margin-top:16px"><h2>Month by month</h2><div class="chart-box lg"><canvas id="ym"></canvas></div></div>`;
    $('#yr', box).onchange = e => { st.year = Number(e.target.value); save(); body(box); };
    chart($('#ym', box), { type: 'bar', data: { labels: y.months.map(m => fdate(m.month + '-01', { month: 'short' })), datasets: [
      { data: y.months.map(m => m.income), backgroundColor: cssVar('--pos'), borderRadius: 5, label: 'Income' },
      { data: y.months.map(m => m.spending), backgroundColor: cssVar('--accent'), borderRadius: 5, label: 'Spending' }] },
      options: { scales: { y: { ticks: moneyTick } }, plugins: { legend: { display: true, position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${money(c.raw)}` } } } } });
  };
  shell();
};

// ======================= DEBT PAYOFF =======================
VIEWS.debt = async el => {
  let p = await api('/plans/debt');
  if (p.empty) { el.innerHTML = `<div class="card empty"><div class="big">🎉</div><strong>No debts to pay off.</strong><div class="small muted" style="margin:6px 0 12px">Credit cards and loans you connect or add show up here with a payoff plan.</div><a class="btn" href="#/accounts?add=1">+ Add a card or loan</a></div>`; return; }
  const draw = () => {
    clearCharts();
    const C = p.chosen, M = p.minimum;
    const saved = M.neverPaysOff ? null : M.totalInterest - C.totalInterest;
    const monthsSaved = M.neverPaysOff ? null : M.months - C.months;
    const order = C.order.map(id => p.debts.find(d => d.id === id));
    const yrs = n => n == null ? 'never' : n < 12 ? `${n} mo` : `${Math.floor(n / 12)} yr${n >= 24 ? 's' : ''}${n % 12 ? ` ${n % 12} mo` : ''}`;
    const est = '<span class="pill amber" title="Not reported by your bank — edit it to match your statement">estimate</span>';
    el.innerHTML = `<div class="card"><div class="row between wrap" style="gap:16px">
        <div><div class="label muted small">DEBT-FREE BY</div><div style="font-size:34px;font-weight:800">${C.payoffDate ? fdate(C.payoffDate, { month: 'long', year: 'numeric' }) : 'Not with these payments'}</div>
          <div class="small muted">${money(p.totalDebt, { cents: false })} across ${p.debts.length} debt${p.debts.length > 1 ? 's' : ''} · ${yrs(C.months)} · paying ${money(C.monthlyBudget, { cents: false })}/mo</div></div>
        <div class="stack" style="min-width:260px"><div class="seg" id="strat"><button data-k="avalanche" class="${p.strategy === 'avalanche' ? 'on' : ''}">⛰️ Avalanche</button><button data-k="snowball" class="${p.strategy === 'snowball' ? 'on' : ''}">⛄ Snowball</button></div>
          <div class="small muted">${p.strategy === 'avalanche' ? 'Highest interest rate first — the cheapest way out.' : 'Smallest balance first — quick wins that keep you going.'}</div>
          <label class="f"><span>Extra each month on top of minimums: <strong id="exV">${money(p.extra, { cents: false })}</strong></span><input type="range" id="ex" min="0" max="3000" step="25" value="${p.extra}"></label></div></div></div>
      <div class="grid g4" style="margin-top:16px">
        <div class="card stat"><div class="label">Interest you'll pay</div><div class="value num">${money(C.totalInterest, { cents: false })}</div></div>
        <div class="card stat"><div class="label">Interest saved</div><div class="value num pos">${saved == null ? '—' : money(saved, { cents: false })}</div><div class="sub">vs minimum payments only</div></div>
        <div class="card stat"><div class="label">Time saved</div><div class="value num">${monthsSaved == null ? '—' : yrs(monthsSaved)}</div><div class="sub">${M.neverPaysOff ? 'Minimums alone never pay it off' : 'Minimums only: ' + yrs(M.months)}</div></div>
        <div class="card stat"><div class="label">Monthly payment</div><div class="value num">${money(C.monthlyBudget, { cents: false })}</div><div class="sub">${money(p.totalMin, { cents: false })} minimums + ${money(p.extra, { cents: false })} extra</div></div></div>
      <div class="grid g3" style="margin-top:16px"><div class="card span2"><h2>Balance over time</h2><div class="chart-box lg"><canvas id="dbt"></canvas></div></div>
        <div class="card"><h2>Compare</h2><table class="t"><thead><tr><th></th><th class="num">Debt-free</th><th class="num">Interest</th></tr></thead><tbody>
          ${[['⛰️ Avalanche', p.avalanche], ['⛄ Snowball', p.snowball], ['Minimums only', p.minimum]].map(([n, s]) => `<tr><td>${n}</td><td class="num">${s.payoffDate ? fdate(s.payoffDate, { month: 'short', year: 'numeric' }) : 'never'}</td><td class="num">${s.neverPaysOff ? '—' : money(s.totalInterest, { cents: false })}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="card" style="margin-top:16px"><div class="card-h"><h2>Payoff order</h2><span class="small muted">Edit the rate or minimum to match your statement</span></div>
        <div class="list">${order.map((d, i) => { const r = C.debts.find(x => x.id === d.id); return `<div class="item debt-row" data-id="${d.id}" style="cursor:default"><div class="ico">${i + 1}</div>
          <div class="main"><div class="t">${esc(d.name)}</div><div class="s">${money(d.balance)} · paid off ${r.payoffDate ? fdate(r.payoffDate, { month: 'short', year: 'numeric' }) : 'never'} · ${money(r.interest, { cents: false })} interest</div></div>
          <label class="mini">APR % ${d.aprEstimated ? est : ''}<input type="number" step="0.01" min="0" max="99" class="d-apr" value="${d.apr}"></label>
          <label class="mini">Min / mo ${d.minEstimated ? est : ''}<input type="number" step="1" min="1" class="d-min" value="${d.min}"></label></div>`; }).join('')}</div>
        <div class="row" style="margin-top:10px"><button class="btn primary" id="saveD">Save rates &amp; minimums</button><span class="small muted">Plan updates instantly when you move the slider or switch strategy.</span></div></div>
      <p class="small muted" style="margin-top:12px">Assumes no new charges and fixed rates. Interest is compounded monthly.</p>`;
    const t = C.timeline, m = M.timeline;
    const n = Math.max(t[t.length - 1].m, M.neverPaysOff ? t[t.length - 1].m : m[m.length - 1].m);
    const lab = []; for (let i = 0; i <= n; i += Math.max(1, Math.ceil(n / 60))) lab.push(i);
    const at = (tl, i) => { let v = 0; for (const x of tl) { if (x.m <= i) v = x.balance; else break; } return i > tl[tl.length - 1].m ? 0 : v; };
    chart($('#dbt', el), { type: 'line', data: { labels: lab.map(i => fdate(iso(new Date(pd(todayISO()).getFullYear(), pd(todayISO()).getMonth() + i, 1)), { month: 'short', year: '2-digit' })), datasets: [
      { data: lab.map(i => at(t, i)), borderColor: cssVar('--accent'), backgroundColor: gradFill(cssVar('--accent'), '44'), fill: true, pointRadius: 0, tension: .2, borderWidth: 2.5, label: p.strategy === 'snowball' ? 'Snowball' : 'Avalanche' },
      { data: lab.map(i => at(m, i)), borderColor: cssVar('--muted'), borderDash: [5, 4], pointRadius: 0, borderWidth: 1.5, label: 'Minimums only' }] },
      options: { scales: { y: { ticks: moneyTick, beginAtZero: true }, x: { ticks: { maxTicksLimit: 8 } } }, plugins: { legend: { display: true, position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${money(c.raw)}` } } } } });
    let deb;
    $('#ex', el).oninput = e => { $('#exV', el).textContent = money(Number(e.target.value), { cents: false }); clearTimeout(deb); deb = setTimeout(async () => { p = await api('/plans/debt', { method: 'PUT', body: { extra: Number(e.target.value) } }); draw(); }, 250); };
    $$('#strat button', el).forEach(b => b.onclick = async () => { p = await api('/plans/debt', { method: 'PUT', body: { strategy: b.dataset.k } }); draw(); });
    $('#saveD', el).onclick = e => run(e.target, async () => {
      const overrides = {}; $$('.debt-row', el).forEach(r => { overrides[r.dataset.id] = { apr: $('.d-apr', r).value, min: $('.d-min', r).value }; });
      p = await api('/plans/debt', { method: 'PUT', body: { overrides } }); draw();
    }, 'Plan updated');
  };
  draw();
};

// ======================= RETIREMENT / FI =======================
VIEWS.retire = async el => {
  let r = await api('/plans/retire');
  const F = [['age', 'Your age', 1], ['retireAge', 'Retire at age', 1], ['lifeAge', 'Plan until age', 1], ['current', 'Invested now ($)', 100], ['monthly', 'Saving each month ($)', 25],
    ['spendYear', 'Yearly spending in retirement ($)', 500], ['other', 'Other yearly income in retirement ($)', 500], ['returnPct', 'Expected return (%/yr)', 0.1], ['inflation', 'Inflation (%/yr)', 0.1], ['swr', 'Safe withdrawal rate (%)', 0.1]];
  const hints = { current: () => `Your investment + crypto accounts: ${money(r.defaults.current, { cents: false })}`, monthly: () => `Your average over the last 6 months: ${money(r.defaults.monthly, { cents: false })}`,
    spendYear: () => `Your last 12 months: ${money(r.defaults.spendYear, { cents: false })}`, other: () => 'Pension, Social Security / CPP, rental income…', swr: () => '4% is the classic "4% rule"' };
  el.innerHTML = `<div class="grid g3 retire"><div class="card"><h2>Your plan</h2><form class="form" id="rf">${F.map(([k, l, s]) => `<label class="f"><span>${l}</span><input type="number" name="${k}" step="${s}" value="${r.inputs[k]}">${hints[k] ? `<small class="muted" data-h="${k}">${hints[k]()}</small>` : ''}</label>`).join('')}
      <div class="row"><button class="btn primary">Save plan</button><button type="button" class="btn" id="reset">Use my data</button></div></form></div>
    <div class="span2 stack" id="rOut"></div></div>`;
  const out = () => {
    clearCharts();
    const sr = r.successRate, srCls = sr >= 85 ? 'pos' : sr >= 65 ? '' : 'neg';
    const I = r.inputs;
    $('#rOut', el).innerHTML = `<div class="grid g2"><div class="card stat"><div class="label">Your FI number</div><div class="value num">${money(r.fiNumber, { cents: false })}</div><div class="sub">${money(Math.max(0, I.spendYear - I.other), { cents: false })}/yr ÷ ${I.swr}% — enough to live off your investments</div></div>
      <div class="card stat"><div class="label">Financially independent at</div><div class="value">${r.fiAge != null ? `age ${r.fiAge}` : 'not before ' + I.retireAge}</div><div class="sub">${r.fiAge != null ? (r.yearsToFi ? `${r.yearsToFi} years from now` : "You're already there 🎉") : `On track for ${money(r.atRetire, { cents: false })} at ${I.retireAge}`}</div></div>
      <div class="card stat"><div class="label">Chance your money lasts to ${I.lifeAge}</div><div class="value num ${srCls}">${sr.toFixed(0)}%</div><div class="sub">1,000 simulated markets with ups and downs</div><div class="bar" style="margin-top:8px"><span style="width:${sr}%;background:${sr >= 85 ? 'var(--pos)' : sr >= 65 ? 'var(--warn)' : 'var(--neg)'}"></span></div></div>
      <div class="card stat"><div class="label">To retire at ${I.retireAge}, save</div><div class="value num">${money(r.neededMonthly, { cents: false })}<span class="small muted" style="font-weight:500">/mo</span></div>
        <div class="sub">${r.neededMonthly <= I.monthly ? `<span class="pos">You're saving enough ✓</span>` : `${money(r.neededMonthly - I.monthly, { cents: false })}/mo more than now`} · Coast FI ${money(r.coastFi, { cents: false })} ${r.coastReached ? '<span class="pill green">reached</span>' : ''}</div></div></div>
      <div class="card"><div class="card-h"><h2>Projected investments</h2><div class="seg-legend"><span><i style="background:var(--accent)"></i>Typical</span><span><i style="background:var(--accent);opacity:.25"></i>Bad–good markets</span><span><i style="background:var(--warn)"></i>FI number</span></div></div>
        <div class="chart-box lg"><canvas id="rc"></canvas></div>
        <p class="small muted" style="margin:8px 0 0">In today's dollars, using a ${r.realReturn}% return after inflation. ${r.runsOutAge ? `<span class="neg">In a steady market this plan runs out at ${r.runsOutAge}.</span>` : ''} An estimate for planning, not financial advice.</p></div>`;
    const B = r.bands;
    chart($('#rc', el), { type: 'line', data: { labels: B.map(b => b.age), datasets: [
      { data: B.map(b => b.p90), borderColor: 'transparent', backgroundColor: cssVar('--accent') + '26', fill: '+1', pointRadius: 0, label: 'Good markets (90th)' },
      { data: B.map(b => b.p10), borderColor: 'transparent', pointRadius: 0, label: 'Bad markets (10th)' },
      { data: B.map(b => b.p50), borderColor: cssVar('--accent'), pointRadius: 0, borderWidth: 2.5, tension: .2, label: 'Typical' },
      { data: B.map(() => r.fiNumber), borderColor: cssVar('--warn'), borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5, label: 'FI number' }] },
      options: { scales: { y: { ticks: moneyTick, beginAtZero: true }, x: { ticks: { maxTicksLimit: 12 } } }, plugins: { tooltip: { callbacks: { title: i => 'Age ' + i[0].label, label: c => `${c.dataset.label}: ${money(c.raw, { cents: false })}` } } } } });
  };
  const vals = () => Object.fromEntries(F.map(([k]) => [k, $(`[name="${k}"]`, el).value]));
  let deb;
  $('#rf', el).oninput = () => { clearTimeout(deb); deb = setTimeout(async () => { r = await api('/plans/retire/preview', { method: 'POST', body: vals() }); out(); }, 300); };
  $('#rf', el).onsubmit = e => { e.preventDefault(); run(e.submitter, async () => { r = await api('/plans/retire', { method: 'PUT', body: vals() }); out(); }, 'Plan saved'); };
  $('#reset', el).onclick = e => run(e.target, async () => {
    r = await api('/plans/retire', { method: 'PUT', body: { current: '', monthly: '', spendYear: '' } });
    for (const k of ['current', 'monthly', 'spendYear']) $(`[name="${k}"]`, el).value = r.inputs[k];
    out();
  }, 'Using your latest numbers');
  out();
};
