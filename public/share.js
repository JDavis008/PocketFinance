/* Share: a summary + chart image of the current page through the phone's share sheet (Android app bridge,
   or the Web Share API in browsers), and "Share PocketFinance" (a download link for the Android app). */
'use strict';

const fmtM = n => money(n, { cents: false });
const pct0 = n => (n == null ? '—' : Math.round(n) + '%');
const today_ = () => pd(todayISO()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

// what to say for each page (amounts come straight from the API, so they match what's on screen)
const SHARE = {
  async dashboard() {
    const d = await api('/dashboard'); const A = d.accounts;
    return { title: 'My money snapshot', canvas: '#cumChart', text: [`Net worth: ${fmtM(A.netWorth)}`, `Cash: ${fmtM(A.cash)}`, `Spent this month: ${fmtM(d.thisMonth.spending)}`, `Income this month: ${fmtM(d.thisMonth.income)}`,
      `Subscriptions: ${money(d.subs.subscriptionsMonthly)}/mo`].join('\n') };
  },
  async spending(q) {
    const m = q.get('month') || todayISO().slice(0, 7); const r = await api('/report?month=' + m);
    const rate = r.totals.income > 0 ? r.totals.net / r.totals.income * 100 : null;
    return { title: `${fmonth(m)} spending`, canvas: '#donut', text: [`Spent ${fmtM(r.totals.spending)} · earned ${fmtM(r.totals.income)} · savings rate ${pct0(rate)}`, '', 'Top categories:',
      ...r.categories.slice(0, 5).map(c => `• ${c.name}: ${fmtM(c.total)}`)].join('\n') };
  },
  async reports(q) {
    if ((q.get('tab') || 'flow') === 'year') {
      const y = await api('/reports/year?year=' + (q.get('year') || '')); const T = y.totals;
      return { title: `My ${y.year} in money`, canvas: '#ym', text: [`Spent ${fmtM(T.spending)}, earned ${fmtM(T.income)}, ${T.net >= 0 ? 'saved ' + fmtM(T.net) : 'overspent ' + fmtM(-T.net)}${T.savingsRate != null ? ` (${pct0(T.savingsRate)} savings rate)` : ''}.`,
        y.topCategories[0] ? `Top category: ${y.topCategories[0].name} (${fmtM(y.topCategories[0].total)})` : '', y.regular ? `Most visited: ${y.regular.name} (${y.regular.n} times)` : '', `No-spend days: ${y.noSpendDays}`].filter(Boolean).join('\n') };
    }
    const r = await api('/reports/range?' + new URLSearchParams({ from: $('#rf') ? $('#rf').value : '', to: $('#rt') ? $('#rt').value : '', groupBy: 'group' }));
    return { title: 'Where my money went', svg: '.sk', canvas: '#mm', text: [`${fdate(r.from, { month: 'short', day: 'numeric' })} – ${fdate(r.to, { month: 'short', day: 'numeric', year: 'numeric' })}`,
      `Income ${fmtM(r.totals.income)} · spending ${fmtM(r.totals.spending)} · ${r.totals.net >= 0 ? 'saved ' + fmtM(r.totals.net) : 'overspent ' + fmtM(-r.totals.net)}`, '', ...r.groups.slice(0, 6).map(g => `• ${g.name}: ${fmtM(g.total)}`)].join('\n') };
  },
  async budgets() {
    const b = await api('/budgets');
    return { title: `${fmonth(b.month)} budgets`, text: [`${fmtM(b.spent)} of ${fmtM(b.total)} budgeted so far`, '', ...b.list.map(x => `• ${x.category}: ${fmtM(x.spent)} of ${fmtM(x.limit)}${x.remaining < 0 ? ' (over)' : ''}`)].join('\n') };
  },
  async networth() {
    const n = await api('/networth?days=365'); const h = n.history; const ch = h.length > 1 ? h[h.length - 1].net - h[0].net : 0;
    return { title: 'My net worth', canvas: '#nw', text: [`Net worth: ${fmtM(n.summary.netWorth)} (${money(ch, { sign: true, cents: false })} over the past year)`, `Assets ${fmtM(n.summary.assets)} · debts ${fmtM(n.summary.liabilities)}`].join('\n') };
  },
  async goals() {
    const g = await api('/goals');
    return { title: 'My savings goals', text: g.map(x => `• ${x.name}: ${fmtM(x.saved)} of ${fmtM(x.target)} (${pct0(x.target ? x.saved / x.target * 100 : 0)})`).join('\n') || 'No goals yet.' };
  },
  async debt() {
    const p = await api('/plans/debt'); if (p.empty) return { title: 'Debt free!', text: 'No debts to pay off 🎉' };
    const C = p.chosen;
    return { title: 'My debt payoff plan', canvas: '#dbt', text: [`${fmtM(p.totalDebt)} across ${p.debts.length} debts`, `Debt-free by ${C.payoffDate ? fdate(C.payoffDate, { month: 'long', year: 'numeric' }) : '—'} paying ${fmtM(C.monthlyBudget)}/mo (${p.strategy})`,
      p.minimum.neverPaysOff ? '' : `Saves ${fmtM(p.minimum.totalInterest - C.totalInterest)} in interest vs minimum payments`].filter(Boolean).join('\n') };
  },
  async retire() {
    const r = await api('/plans/retire');
    return { title: 'My retirement plan', canvas: '#rc', text: [`FI number: ${fmtM(r.fiNumber)}`, r.fiAge != null ? `Financially independent at ${r.fiAge}` : `On track for ${fmtM(r.atRetire)} at ${r.inputs.retireAge}`, `Chance the money lasts to ${r.inputs.lifeAge}: ${pct0(r.successRate)}`].join('\n') };
  },
  async invest() {
    const p = await api('/invest');
    return { title: 'My investments', canvas: '#mix', text: [`Invested: ${fmtM(p.total)}`, ...p.allocation.map(a => `• ${a.label}: ${a.pct}%`), p.fees.avgPct != null ? `Average fund fee: ${(+p.fees.avgPct).toFixed(2)}%` : ''].filter(Boolean).join('\n') };
  },
  async recurring() {
    const r = await api('/recurring'); const subs = r.rows.filter(x => x.status === 'active' && x.kind === 'subscription');
    const total = subs.reduce((s, x) => s + x.monthly, 0);
    return { title: 'My subscriptions', text: [`${subs.length} subscriptions · ${money(total)}/mo · ${fmtM(total * 12)}/yr`, '', ...subs.sort((a, b) => b.monthly - a.monthly).slice(0, 12).map(x => `• ${x.custom_name || x.name}: ${money(x.amount)} ${(CAD_LABEL[x.cadence] || '').toLowerCase()}`)].join('\n') };
  },
  async leaks() {
    const r = await api('/leaks');
    return { title: 'Money leaks I found', text: [r.yearlyTotal ? `Fees & interest: about ${fmtM(r.yearlyTotal)} a year` : '', ...r.items.slice(0, 8).map(x => `• ${x.title}: ${money(x.amount)}`)].filter(Boolean).join('\n') || 'No leaks found 🎉' };
  },
  async watch() {
    const w = await api('/watchlists');
    return { title: 'My spending watchlists', text: w.map(x => `• ${x.name}: ${fmtM(x.spent)} this month${x.monthly_limit ? ` of ${fmtM(x.monthly_limit)}` : ''}`).join('\n') || 'Nothing watched yet.' };
  },
};

// draw the page's chart (canvas or the cash-flow SVG) onto a branded card image
async function shareImage(spec, title) {
  let src = null;
  if (spec.svg && $(spec.svg)) src = await svgToImage($(spec.svg));
  if (!src && spec.canvas && $(spec.canvas) && $(spec.canvas).width > 0) src = $(spec.canvas);
  if (!src) return null;
  const W = 1080, pad = 56, sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
  const iw = W - pad * 2, ih = Math.min(1100, Math.round(iw * sh / sw));
  const c = document.createElement('canvas'); c.width = W; c.height = ih + 260;
  const g = c.getContext('2d'), dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light' || document.documentElement.dataset.theme === 'dark';
  g.fillStyle = cssVar('--surface') || (dark ? '#12141f' : '#fff'); g.fillRect(0, 0, c.width, c.height);
  const grad = g.createLinearGradient(0, 0, W, 0); grad.addColorStop(0, '#6d4aff'); grad.addColorStop(1, '#0ea5a4'); g.fillStyle = grad; g.fillRect(0, 0, W, 10);
  g.fillStyle = cssVar('--text') || '#111'; g.font = `800 48px ${cssVar('--font') || 'sans-serif'}`; g.fillText(title, pad, 96);
  g.fillStyle = cssVar('--muted') || '#666'; g.font = `500 28px ${cssVar('--font') || 'sans-serif'}`; g.fillText(today_(), pad, 140);
  g.drawImage(src, pad, 180, iw, ih);
  g.font = `700 26px ${cssVar('--font') || 'sans-serif'}`; g.fillStyle = cssVar('--muted') || '#666'; g.fillText('PocketFinance', pad, c.height - 36);
  return c;
}
function svgToImage(svg) {
  // inline the CSS-driven text colours so the SVG renders the same outside the page
  const clone = svg.cloneNode(true);
  const vb = svg.viewBox.baseVal;
  clone.setAttribute('width', vb.width * 2); clone.setAttribute('height', vb.height * 2);
  clone.querySelectorAll('.sk-n').forEach(t => { t.setAttribute('fill', cssVar('--text')); t.setAttribute('font-weight', '600'); t.setAttribute('font-size', '13'); });
  clone.querySelectorAll('.sk-v').forEach(t => { t.setAttribute('fill', cssVar('--muted')); t.setAttribute('font-size', '12'); });
  clone.querySelectorAll('text').forEach(t => t.setAttribute('font-family', 'Inter, Segoe UI, Arial, sans-serif'));
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
  return new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
}

// hand off to the phone's share sheet, the browser's, or fall back to copy / download
async function sendShare({ title, text, canvas }) {
  const png = canvas ? canvas.toDataURL('image/png') : null;
  if (window.PocketFinanceApp && window.PocketFinanceApp.share) { window.PocketFinanceApp.share(title, text, png ? png.split(',')[1] : ''); return 'shared'; }
  if (navigator.share) {
    try {
      const files = png ? [new File([await (await fetch(png)).blob()], 'PocketFinance.png', { type: 'image/png' })] : [];
      const data = { title, text }; if (files.length && navigator.canShare && navigator.canShare({ files })) data.files = files;
      await navigator.share(data); return 'shared';
    } catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  return 'fallback';
}

async function sharePage() {
  const [name, query] = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?');
  const fn = SHARE[name];
  let spec;
  try { spec = fn ? await fn(new URLSearchParams(query || '')) : { title: TITLES[name] || 'PocketFinance', text: '' }; }
  catch (e) { return toast(e.message); }
  const canvas = await shareImage(spec, spec.title).catch(() => null);
  openDrawer(`<h2>Share</h2><p class="small muted" style="margin-top:0">Check what you're sending — it includes real amounts. Edit the text if you like.</p>
    <form class="form" id="shF"><label class="f"><span>Title</span><input name="title" value="${esc(spec.title)}"></label>
      <label class="f"><span>Message</span><textarea name="text" rows="8">${esc((spec.text ? spec.text + '\n\n' : '') + '— shared from PocketFinance')}</textarea></label>
      ${canvas ? `<label class="chk"><input type="checkbox" name="img" checked> Include the chart picture</label><img class="share-prev" alt="Chart preview" src="${canvas.toDataURL('image/png')}">` : ''}
      <div class="row wrap"><button class="btn primary">📤 Share</button><button type="button" class="btn" id="shCopy">Copy text</button>${canvas ? '<button type="button" class="btn" id="shSave">Save picture</button>' : ''}</div></form>`, d => {
    const val = () => { const f = formData($('#shF', d)); return { title: f.title, text: f.text, canvas: f.img ? canvas : null }; };
    $('#shF', d).onsubmit = async e => {
      e.preventDefault(); const r = await sendShare(val());
      if (r === 'shared') closeDrawer(); else if (r === 'fallback') toast('This browser can\'t share directly — use Copy text or Save picture.', 5000);
    };
    $('#shCopy', d).onclick = () => navigator.clipboard.writeText(val().text).then(() => toast('Copied'), () => toast('Copy failed'));
    if ($('#shSave', d)) $('#shSave', d).onclick = () => { const a = document.createElement('a'); a.href = canvas.toDataURL('image/png'); a.download = `PocketFinance-${name}-${todayISO()}.png`; document.body.appendChild(a); a.click(); a.remove(); };
  });
}

// "Share PocketFinance": a download link for the Android app
async function shareApp() {
  const s = await api('/settings');
  const url = s.app_share_url;
  if (!url) {
    return openDrawer(`<h2>Share PocketFinance</h2><p class="small">Paste a download link for the Android app (for example the Google Drive link to <span class="kbd">PocketFinance.apk</span>, set to "Anyone with the link").</p>
      <form class="form" id="appF"><label class="f"><span>Download link</span><input name="url" type="url" required placeholder="https://drive.google.com/file/d/…"></label><button class="btn primary">Save &amp; share</button></form>`, d => {
      $('#appF', d).onsubmit = async e => { e.preventDefault(); await run(e.submitter, () => api('/settings', { method: 'PUT', body: { app_share_url: formData(e.target).url } })); closeDrawer(); shareApp(); };
    });
  }
  const srv = s.server_share_url;
  const text = `Check out PocketFinance — a free, private money app (budgets, subscriptions, net worth, AI advice). Your data stays on your own PC.\n\n1. On your Windows PC, get the free server${srv ? `: ${srv}` : ' (PocketFinance-Server.exe)'} and double-click it. If Windows says "protected your PC", click More info → Run anyway.\n2. On your Android phone, install the app: ${url}\n   (open the link, download PocketFinance.apk, allow installing from your browser)\n3. In PocketFinance on the PC: Settings → Connect your phone, and type the address it shows into the app.`;
  const r = await sendShare({ title: 'PocketFinance', text, canvas: null });
  if (r === 'fallback') openDrawer(`<h2>Share PocketFinance</h2><pre class="letter">${esc(text)}</pre><div class="row"><button class="btn primary" id="cpA">Copy</button></div>`, d => { $('#cpA', d).onclick = () => navigator.clipboard.writeText(text).then(() => toast('Copied')); });
}

document.addEventListener('DOMContentLoaded', () => {});
(() => {
  const btn = document.getElementById('shareBtn');
  if (btn) btn.addEventListener('click', () => sharePage());
})();
