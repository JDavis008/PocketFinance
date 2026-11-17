// Detects subscriptions, bills and paychecks from transaction history.
const { db, tx } = require('../db');
const { isKnownSubscription } = require('./categorize');
const { lookup } = require('./cancel-directory');
const { today, addDays, addMonths, daysBetween, median, round2 } = require('../util');

const CADENCES = [
  { id: 'weekly', days: 7, lo: 5, hi: 9, tol: 2, min: 4 },
  { id: 'biweekly', days: 14, lo: 12, hi: 17, tol: 3, min: 3 },
  { id: 'monthly', days: 30, lo: 26, hi: 35, tol: 5, min: 3 },
  { id: 'quarterly', days: 91, lo: 84, hi: 98, tol: 10, min: 2 },
  { id: 'semiannual', days: 182, lo: 170, hi: 195, tol: 15, min: 2 },
  { id: 'annual', days: 365, lo: 350, hi: 380, tol: 20, min: 2 },
];
const CAD = Object.fromEntries(CADENCES.map(c => [c.id, c]));

function step(date, cadence, n = 1) {
  switch (cadence) {
    case 'weekly': return addDays(date, 7 * n);
    case 'biweekly': return addDays(date, 14 * n);
    case 'monthly': return addMonths(date, n);
    case 'quarterly': return addMonths(date, 3 * n);
    case 'semiannual': return addMonths(date, 6 * n);
    case 'annual': return addMonths(date, 12 * n);
    default: return addMonths(date, n);
  }
}
const perMonth = (amount, cadence) => amount * ({ weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, semiannual: 1 / 6, annual: 1 / 12 }[cadence] || 1);

const recentIncrease = f => f.kind !== 'income' && f.prev_amount != null && f.amount > f.prev_amount && f.changed_on && daysBetween(f.changed_on, today()) <= 45;

function detect() {
  const since = addDays(today(), -800);
  const rows = db.prepare(`SELECT t.id, t.date, t.amount, t.merchant, t.merchant_key, t.category, t.account_id
    FROM transactions t JOIN accounts a ON a.id=t.account_id
    LEFT JOIN categories c ON c.name=t.category
    WHERE t.date>=? AND t.pending=0 AND COALESCE(c.kind,'expense')!='transfer' AND t.merchant_key IS NOT NULL
    ORDER BY t.date`).all(since);

  const groups = {};
  for (const r of rows) (groups[`${r.merchant_key}|${r.amount < 0 ? 'out' : 'in'}`] ||= []).push(r);

  const found = [];
  for (const [gkey, list] of Object.entries(groups)) {
    if (list.length < 2) continue;
    const variable = /Utilities|Insurance|Paycheck|Income|Loan/.test(list[list.length - 1].category);
    const tol = variable ? 0.5 : 0.2;
    const clusters = [];
    for (const r of list) {
      const a = Math.abs(r.amount);
      const c = clusters.find(c => Math.abs(a - c.last) <= Math.max(1, c.last * tol));
      if (c) { c.items.push(r); c.last = a; } else clusters.push({ items: [r], last: a });
    }
    clusters.sort((a, b) => b.items.length - a.items.length);
    clusters.forEach((cl, i) => {
      // merge same-day duplicates
      const items = cl.items.filter((r, j, arr) => j === 0 || r.date !== arr[j - 1].date);
      if (items.length < 2) return;
      const gaps = items.slice(1).map((r, j) => daysBetween(items[j].date, r.date));
      const med = median(gaps);
      const cad = CADENCES.find(c => med >= c.lo && med <= c.hi);
      if (!cad) return;
      const last = items[items.length - 1];
      const knownSub = isKnownSubscription(last.merchant) || last.category === 'Subscriptions';
      const minN = knownSub && cad.id === 'monthly' ? 2 : cad.min;
      if (items.length < minN) return;
      const recent = gaps.slice(-6);
      const regular = recent.filter(g => Math.abs(g - cad.days) <= cad.tol || (cad.id === 'monthly' && g >= 26 && g <= 35)).length / recent.length;
      if (regular < (recent.length >= 4 ? 0.6 : 1)) return;
      // A store you shop at all the time can line up by chance; require the pattern to be most of that merchant's activity.
      if (!knownSub) {
        const span = list.filter(r => r.date >= items[0].date).length;
        if (items.length < span * 0.5) return;
        // only two hits months apart is weak evidence unless the merchant has no other activity
        if (items.length === 2 && cad.days > 60 && span > 2) return;
        const amts = items.map(r => Math.abs(r.amount));
        if (!variable && items.length < 4 && Math.max(...amts) > Math.min(...amts) * 1.05) return;
      }
      const amount = Math.abs(last.amount);
      // most recent price change (fixed-price items only)
      let prev = null, changedOn = null;
      if (!variable) for (let j = items.length - 2; j >= 0; j--) {
        const a = Math.abs(items[j].amount);
        if (Math.abs(a - amount) > Math.max(0.5, amount * 0.02)) {
          if (daysBetween(items[j + 1].date, today()) <= 365) { prev = round2(a); changedOn = items[j + 1].date; }
          break;
        }
      }
      let next = step(last.date, cad.id);
      const stale = daysBetween(next, today()) > cad.tol + (cad.days > 60 ? 30 : 10);
      found.push({
        key: i === 0 ? gkey : `${gkey}#${Math.round(amount)}`, merchant_key: last.merchant_key, name: last.merchant, category: last.category,
        amount: round2(amount), prev_amount: prev, changed_on: changedOn,
        cadence: cad.id, last_date: last.date, next_date: next, account_id: last.account_id, stale,
        kind: last.amount > 0 ? 'income' : knownSub ? 'subscription' : 'bill', occurrences: items.length, ids: items.map(r => r.id),
      });
    });
  }

  const events = [];
  const now = Date.now();
  tx(() => {
    const get = db.prepare('SELECT * FROM recurring WHERE key=?');
    const link = db.prepare('UPDATE transactions SET recurring_id=? WHERE id=?');
    for (const f of found) {
      const ex = get.get(f.key);
      if (!ex) {
        if (f.stale) continue;
        const info = lookup(f.merchant_key);
        const r = db.prepare(`INSERT INTO recurring(key,name,merchant_key,category,amount,prev_amount,cadence,last_date,next_date,account_id,status,kind,auto,occurrences,cancel_url,created,updated)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`).run(f.key, f.name, f.merchant_key, f.category, f.amount, f.prev_amount, f.cadence, f.last_date,
          f.next_date, f.account_id, 'active', f.kind, f.occurrences, info ? info.url : null, now, now);
        const id = Number(r.lastInsertRowid);
        f.ids.forEach(t => link.run(id, t));
        events.push({ type: 'new_recurring', id, ...f });
        if (recentIncrease(f)) events.push({ type: 'price_increase', id, ...f });
        continue;
      }
      let status = ex.status;
      if (status === 'active' && f.stale) status = 'inactive';
      if (status === 'inactive' && !f.stale) status = 'active';
      if (status === 'cancelled' && ex.cancelled_at && f.last_date > ex.cancelled_at) events.push({ type: 'charged_after_cancel', id: ex.id, ...f });
      if (recentIncrease(f) && status === 'active') events.push({ type: 'price_increase', id: ex.id, ...f });
      db.prepare(`UPDATE recurring SET name=?, category=?, amount=?, prev_amount=?, cadence=?, last_date=?, next_date=?, account_id=?, status=?, kind=CASE WHEN auto=1 THEN ? ELSE kind END,
        occurrences=?, updated=? WHERE id=?`).run(f.name, f.category, f.amount, f.prev_amount, f.cadence, f.last_date, f.next_date,
        f.account_id, status, f.kind, f.occurrences, now, ex.id);
      f.ids.forEach(t => link.run(ex.id, t));
    }
    // manual bills: roll their due date forward
    for (const m of db.prepare("SELECT id, next_date, cadence FROM recurring WHERE auto=0 AND status='active' AND next_date<?").all(today())) {
      let n = m.next_date; let guard = 0;
      while (n < today() && guard++ < 500) n = step(n, m.cadence);
      db.prepare('UPDATE recurring SET last_date=?, next_date=? WHERE id=?').run(m.next_date, n, m.id);
    }
  });
  return events;
}

/** Upcoming occurrences between two dates (inclusive), including projected repeats. */
function upcoming(from, to) {
  const list = [];
  const rows = db.prepare("SELECT * FROM recurring WHERE status='active'").all();
  for (const r of rows) {
    let d = r.next_date; let guard = 0;
    if (!d) continue;
    // an overdue charge still shows today
    while (d < from && guard++ < 50) d = step(d, r.cadence);
    if (daysBetween(r.next_date, from) > 0 && daysBetween(r.next_date, from) <= 5) d = r.next_date;
    while (d <= to && guard++ < 100) {
      list.push({ id: r.id, name: r.custom_name || r.name, amount: r.amount, kind: r.kind, date: d, category: r.category, cadence: r.cadence, overdue: d < from });
      d = step(d, r.cadence);
    }
  }
  // credit card / loan due dates from the bank
  for (const a of db.prepare("SELECT id, name, institution, meta FROM accounts WHERE type IN ('credit','loan') AND hidden=0").all()) {
    let m = {}; try { m = JSON.parse(a.meta || '{}') || {}; } catch {}
    const l = m.liability;
    if (l && l.due_date && l.due_date >= from && l.due_date <= to)
      list.push({ account_id: a.id, name: `${a.name} payment`, amount: l.minimum || l.statement_balance || 0, kind: 'bill', date: l.due_date, category: 'Credit Card Payment', cadence: 'monthly', statement: true });
  }
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = { detect, upcoming, step, perMonth, CAD };
