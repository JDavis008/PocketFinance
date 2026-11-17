// Watchlists (spending on a merchant / category / tag), money-leak finder, monthly recap.
const { db, getSetting, setSetting } = require('../db');
const { today, addDays, monthOf, monthStart, monthEnd, prevMonth, round2, daysBetween } = require('../util');
const { tagList } = require('./reports');

const JOIN = 'FROM transactions t LEFT JOIN categories c ON c.name=t.category';
const SPEND = "t.excluded=0 AND COALESCE(c.kind,'expense')='expense'";
const bad = msg => Object.assign(new Error(msg), { status: 400 });

// ---------------------------------------------------------------- watchlists
function whereFor(w) {
  if (w.kind === 'merchant') return ['t.merchant_key=?', [w.value]];
  if (w.kind === 'category') return ['t.category=?', [w.value]];
  if (w.kind === 'tag') return ['t.tags LIKE ?', [`%,${w.value},%`]];
  return ['0', []];
}
function watchlists() {
  const m = monthOf(today());
  const months = []; for (let i = 5, x = m; i >= 0; i--) { months.unshift(x); x = prevMonth(x); }
  const dayFrac = Number(today().slice(8)) / Number(monthEnd(m).slice(8));
  return db.prepare('SELECT * FROM watchlists ORDER BY created').all().map(w => {
    const [sql, args] = whereFor(w);
    const q = db.prepare(`SELECT COALESCE(SUM(-t.amount),0) v, COUNT(*) n ${JOIN} WHERE ${SPEND} AND ${sql} AND t.date BETWEEN ? AND ?`);
    const series = months.map(mm => { const r = q.get(...args, monthStart(mm), monthEnd(mm)); return { month: mm, spent: round2(r.v), n: r.n }; });
    const cur = series[series.length - 1], past = series.slice(0, -1).filter(s => s.n > 0);
    const avg = past.length ? round2(past.reduce((s, x) => s + x.spent, 0) / past.length) : null;
    const recent = db.prepare(`SELECT t.id, t.date, t.merchant, t.amount ${JOIN} WHERE ${SPEND} AND ${sql} ORDER BY t.date DESC LIMIT 5`).all(...args);
    return { ...w, spent: cur.spent, count: cur.n, avg, series, recent,
      pct: w.monthly_limit ? round2(cur.spent / w.monthly_limit * 100) : null,
      projected: dayFrac > 0 ? round2(cur.spent / dayFrac) : cur.spent };
  });
}
function addWatch(b) {
  const kind = ['merchant', 'category', 'tag'].includes(b.kind) ? b.kind : null;
  const value = String(b.value || '').trim().slice(0, 80);
  if (!kind || !value) throw bad('Pick what to watch.');
  if (db.prepare('SELECT COUNT(*) n FROM watchlists').get().n >= 30) throw bad('Up to 30 watchlists.');
  const limit = b.monthly_limit === '' || b.monthly_limit == null ? null : Math.abs(Number(b.monthly_limit)) || null;
  const name = String(b.name || '').trim().slice(0, 60) || (kind === 'merchant' ? (db.prepare('SELECT merchant FROM transactions WHERE merchant_key=? LIMIT 1').get(value) || {}).merchant || value : kind === 'tag' ? '#' + value : value);
  return { id: Number(db.prepare('INSERT INTO watchlists(name,kind,value,monthly_limit,created) VALUES(?,?,?,?,?)').run(name, kind, value, limit, Date.now()).lastInsertRowid) };
}
function updateWatch(id, b) {
  const w = db.prepare('SELECT * FROM watchlists WHERE id=?').get(id); if (!w) throw bad('Not found');
  const limit = b.monthly_limit === undefined ? w.monthly_limit : b.monthly_limit === '' || b.monthly_limit === null ? null : Math.abs(Number(b.monthly_limit)) || null;
  db.prepare('UPDATE watchlists SET name=?, monthly_limit=? WHERE id=?').run(String(b.name ?? w.name).slice(0, 60), limit, id);
}

// ---------------------------------------------------------------- money leaks
const FEE_RE = /\b(overdraft|nsf|non-?sufficient|insufficient funds|returned item|monthly (service|maintenance)|maintenance fee|service (charge|fee)|account fee|paper statement|atm (fee|surcharge|withdrawal fee)|non-?network atm|wire (transfer )?fee|late (payment )?fee|annual (membership )?fee|returned payment|stop payment|cash advance fee|balance transfer fee|minimum balance)\b/i;
const INTEREST_RE = /\b(interest charge|finance charge|purchase interest|interest charged|cash advance interest)\b/i;
const FX_RE = /\b(foreign (transaction|exchange|currency)( fee)?|international (transaction|service)( fee)?|fx fee|currency conversion fee|non-?ref?\w* foreign)\b/i;

function leaks() {
  const t = today(), from = addDays(t, -90);
  const dismissed = new Set(getSetting('leaks_dismissed', []) || []);
  const out = [];
  const rows = db.prepare(`SELECT t.id, t.date, t.amount, t.merchant, t.merchant_key, t.description, t.category, t.account_id, t.recurring_id, a.name account ${JOIN} JOIN accounts a ON a.id=t.account_id
    WHERE t.date>=? AND t.amount<0 AND t.excluded=0 ORDER BY t.date DESC`).all(from);
  const push = (type, key, item) => { if (!dismissed.has(key)) out.push({ type, key, ...item }); };
  const fees = [], interest = [], fx = [];
  for (const r of rows) {
    const text = `${r.description} ${r.merchant}`;
    if (FX_RE.test(text)) fx.push(r);
    else if (INTEREST_RE.test(text)) interest.push(r);
    else if (FEE_RE.test(text) || (r.category === 'Fees & Charges' && Math.abs(r.amount) < 100)) fees.push(r);
  }
  const yearly = list => round2(list.reduce((s, r) => s - r.amount, 0) * 365 / 90);
  if (fees.length) push('fees', `fees:${fees[0].id}`, { title: `${fees.length} bank fee${fees.length > 1 ? 's' : ''}`, amount: round2(fees.reduce((s, r) => s - r.amount, 0)), yearly: yearly(fees), items: fees.slice(0, 8),
    tip: 'Call and ask for a courtesy refund — banks waive first or occasional fees most of the time. A no-fee checking account or a low-balance alert stops them coming back.' });
  if (interest.length) push('interest', `interest:${interest[0].id}`, { title: 'Credit card interest', amount: round2(interest.reduce((s, r) => s - r.amount, 0)), yearly: yearly(interest), items: interest.slice(0, 8),
    tip: 'Pay the statement balance in full to stop interest, or move the balance to a 0% transfer card. The Debt payoff planner shows the cheapest order.', link: '#/debt' });
  if (fx.length) push('fx', `fx:${fx[0].id}`, { title: 'Foreign transaction fees', amount: round2(fx.reduce((s, r) => s - r.amount, 0)), yearly: yearly(fx), items: fx.slice(0, 8),
    tip: 'Use a card with no foreign transaction fee when you travel or shop on non-US sites.' });
  // possible duplicate charges: same merchant, same amount, same account, within 2 days (not recurring)
  const seen = {};
  for (const r of [...rows].reverse()) {
    if (r.recurring_id || Math.abs(r.amount) < 5) continue;
    const k = `${r.account_id}|${r.merchant_key}|${r.amount.toFixed(2)}`;
    const prev = seen[k];
    if (prev && daysBetween(prev.date, r.date) <= 2) push('duplicate', `dup:${prev.id}:${r.id}`, { title: `Possible double charge at ${r.merchant}`, amount: round2(-r.amount), items: [prev, r],
      tip: 'Two identical charges close together. If you only bought once, dispute the second one with your bank — pending duplicates often fall off by themselves within a few days.' });
    seen[k] = r;
  }
  // new subscriptions in the last 60 days (often converted free trials)
  // judged by the first charge, not when it was detected (a first sync detects everything at once)
  for (const s of db.prepare(`SELECT r.id, COALESCE(r.custom_name,r.name) name, r.amount, r.cadence, MIN(t.date) first FROM recurring r JOIN transactions t ON t.recurring_id=r.id
    WHERE r.status='active' AND r.kind='subscription' GROUP BY r.id HAVING first>=?`).all(addDays(t, -60)))
    push('newsub', `newsub:${s.id}`, { title: `New subscription: ${s.name}`, amount: s.amount, cadence: s.cadence, yearly: round2(s.amount * ({ weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, semiannual: 2, annual: 1 }[s.cadence] || 12)),
      tip: `First charged ${s.first} — maybe a free trial that turned paid. Keep it only if you use it.`, link: '#/recurring' });
  // category spending spikes: this month on pace for 50%+ above the 3-month average (and at least $100 more)
  const m = monthOf(t), frac = Number(t.slice(8)) / Number(monthEnd(m).slice(8));
  if (frac >= 0.25) {
    // recurring bills are left out: rent on the 1st would otherwise look like a spike all month
    const cur = db.prepare(`SELECT t.category name, SUM(-t.amount) v ${JOIN} WHERE ${SPEND} AND t.recurring_id IS NULL AND t.date BETWEEN ? AND ? GROUP BY t.category`).all(monthStart(m), t);
    const avg = Object.fromEntries(db.prepare(`SELECT t.category name, SUM(-t.amount)/3.0 v ${JOIN} WHERE ${SPEND} AND t.recurring_id IS NULL AND t.date BETWEEN ? AND ? GROUP BY t.category`).all(monthStart(prevMonth(prevMonth(prevMonth(m)))), monthEnd(prevMonth(m))).map(r => [r.name, r.v]));
    for (const c of cur) {
      const pace = c.v / frac, base = avg[c.name] || 0;
      if (base >= 50 && pace > base * 1.5 && pace - base >= 100)
        push('spike', `spike:${c.name}:${m}`, { title: `${c.name} is running high`, amount: round2(c.v), projected: round2(pace), average: round2(base),
          tip: `On pace for ${'$' + Math.round(pace)} this month vs your usual ${'$' + Math.round(base)}.`, link: `#/transactions?category=${encodeURIComponent(c.name)}&from=${monthStart(m)}` });
    }
  }
  const order = { duplicate: 0, fees: 1, interest: 2, fx: 3, spike: 4, newsub: 5 };
  out.sort((a, b) => order[a.type] - order[b.type]);
  return { items: out, yearlyTotal: round2(out.filter(x => ['fees', 'interest', 'fx'].includes(x.type)).reduce((s, x) => s + (x.yearly || 0), 0)) };
}
function dismissLeak(key) {
  const cur = getSetting('leaks_dismissed', []) || [];
  if (key && !cur.includes(key)) { cur.push(String(key).slice(0, 120)); setSetting('leaks_dismissed', cur.slice(-500)); }
}

// ---------------------------------------------------------------- monthly recap
function recap(month) {
  const s = monthStart(month), e = monthEnd(month);
  const tot = m => {
    const sp = db.prepare(`SELECT COALESCE(SUM(-t.amount),0) v ${JOIN} WHERE ${SPEND} AND t.date BETWEEN ? AND ?`).get(monthStart(m), monthEnd(m)).v;
    const inc = db.prepare(`SELECT COALESCE(SUM(t.amount),0) v ${JOIN} WHERE t.excluded=0 AND c.kind='income' AND t.date BETWEEN ? AND ?`).get(monthStart(m), monthEnd(m)).v;
    return { spending: round2(sp), income: round2(inc), net: round2(inc - sp) };
  };
  const cur = tot(month), prev = tot(prevMonth(month));
  const top = db.prepare(`SELECT t.category name, SUM(-t.amount) v ${JOIN} WHERE ${SPEND} AND t.date BETWEEN ? AND ? GROUP BY t.category ORDER BY v DESC LIMIT 1`).get(s, e);
  const n = db.prepare('SELECT COUNT(*) n FROM transactions WHERE date BETWEEN ? AND ?').get(s, e).n;
  return { month, ...cur, prev, topCategory: top ? { name: top.name, total: round2(top.v) } : null, count: n };
}

module.exports = { watchlists, addWatch, updateWatch, leaks, dismissLeak, recap, tagList };
