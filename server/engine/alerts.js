// In-app alerts, with optional phone push through ntfy (https://ntfy.sh or self-hosted).
const { db, getSetting } = require('../db');
const { today, addDays, monthOf } = require('../util');
const { upcoming } = require('./recurring');
const { budgets } = require('./insights');
const { prevMonth } = require('../util');

const fmt = n => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function push(title, body) {
  const n = getSetting('notify', {}) || {};
  if (!n.ntfy_topic) return;
  const server = (n.ntfy_server || 'https://ntfy.sh').replace(/\/$/, '');
  try {
    await fetch(`${server}/${encodeURIComponent(n.ntfy_topic)}`, {
      method: 'POST', body, headers: { Title: title.replace(/[^\x20-\x7E]/g, ''), Tags: 'moneybag', ...(n.ntfy_token ? { Authorization: `Bearer ${n.ntfy_token}` } : {}) },
    });
  } catch { /* offline */ }
}

function add(type, key, title, body, link) {
  const r = db.prepare('INSERT OR IGNORE INTO alerts(created,type,title,body,key,link) VALUES(?,?,?,?,?,?)').run(Date.now(), type, title, body, key, link || null);
  if (r.changes) { const prefs = getSetting('notify', {}) || {}; if (prefs[`push_${type}`] !== false) push(title, body); }
  return r.changes;
}

/** Run after every sync. recurringEvents comes from recurring.detect(). */
function evaluate(recurringEvents = []) {
  const s = { low_balance: 100, large_tx: 500, bill_days: 3, ...(getSetting('thresholds', {}) || {}) };
  const t = today();
  for (const e of recurringEvents) {
    if (e.type === 'new_recurring' && e.kind !== 'income')
      add('subscription', `new:${e.id}`, `New ${e.kind}: ${e.name}`, `${fmt(e.amount)} ${e.cadence}. Next charge ${e.next_date}.`, '#/recurring');
    if (e.type === 'price_increase')
      add('price', `price:${e.id}:${e.changed_on}`, `${e.name} went up`, `${fmt(e.prev_amount)} → ${fmt(e.amount)} (${e.cadence}).`, '#/recurring');
    if (e.type === 'charged_after_cancel')
      add('cancel', `aftercancel:${e.id}:${e.last_date}`, `${e.name} charged after you cancelled`, `${fmt(e.amount)} on ${e.last_date}. Ask for a refund.`, '#/recurring');
  }
  for (const a of db.prepare("SELECT id,name,balance,available FROM accounts WHERE type='depository' AND hidden=0").all()) {
    const b = a.available ?? a.balance;
    if (b < s.low_balance) add('balance', `low:${a.id}:${t}`, `Low balance: ${a.name}`, `${fmt(b)} available.`, '#/accounts');
  }
  for (const x of db.prepare("SELECT t.id,t.merchant,t.amount,t.date FROM transactions t LEFT JOIN categories c ON c.name=t.category WHERE t.date>=? AND t.amount<=? AND COALESCE(c.kind,'expense')='expense'").all(addDays(t, -3), -s.large_tx))
    add('large', `large:${x.id}`, `Large charge: ${x.merchant}`, `${fmt(x.amount)} on ${x.date}.`, '#/transactions');
  for (const u of upcoming(t, addDays(t, s.bill_days)))
    if (u.kind !== 'income') add('bill', `bill:${u.id || 'a' + u.account_id}:${u.date}`, `${u.name} due ${u.date === t ? 'today' : u.date}`, `${fmt(u.amount)}`, '#/recurring');
  const b = budgets(monthOf(t));
  for (const x of b.list) {
    if (x.limit <= 0) continue;
    if (x.pct >= 1) add('budget', `over:${x.category}:${b.month}`, `Over budget: ${x.category}`, `${fmt(x.spent)} of ${fmt(x.limit)}.`, '#/budgets');
    else if (x.pct >= 0.8) add('budget', `near:${x.category}:${b.month}`, `80% of ${x.category} budget used`, `${fmt(x.remaining)} left this month.`, '#/budgets');
  }
  // subscription cancellations: confirmed (no charge after the billing date) or failed (charged anyway)
  for (const e of require('./cancel').check()) {
    if (e.type === 'cancel_confirmed') add('cancel', `cancelok:${e.id}`, `${e.name} cancellation confirmed`, `No charge since you cancelled — that's ${fmt(e.amount)} you keep.`, '#/recurring?tab=inactive');
    if (e.type === 'cancel_failed') add('cancel', `cancelfail:${e.id}:${e.date}`, `${e.name} charged you after cancelling`, `${fmt(e.amount)} on ${e.date}. Open it for a refund request and dispute steps.`, '#/recurring?tab=inactive');
  }
  // watchlist limits, money leaks, and a recap of last month (once, in the new month)
  const watch = require('./watch');
  for (const w of watch.watchlists()) {
    if (!w.monthly_limit) continue;
    if (w.spent >= w.monthly_limit) add('watch', `watch:${w.id}:${b.month}:over`, `Over your ${w.name} limit`, `${fmt(w.spent)} of ${fmt(w.monthly_limit)} this month.`, '#/watch');
    else if (w.pct >= 80) add('watch', `watch:${w.id}:${b.month}:near`, `80% of your ${w.name} limit`, `${fmt(w.spent)} of ${fmt(w.monthly_limit)} this month.`, '#/watch');
  }
  for (const l of watch.leaks().items) if (['fees', 'duplicate', 'interest', 'fx'].includes(l.type))
    add('leak', `leak:${l.key}`, l.title, `${fmt(l.amount)}${l.yearly ? ` · about ${fmt(l.yearly)} a year at this rate` : ''}`, '#/leaks');
  const pm = prevMonth(monthOf(t));
  if (db.prepare('SELECT COUNT(*) n FROM transactions WHERE date LIKE ?').get(pm + '%').n >= 5) {
    const r = watch.recap(pm);
    const name = new Date(pm + '-15').toLocaleDateString('en-US', { month: 'long' });
    const d = r.prev.spending ? Math.round((r.spending - r.prev.spending) / r.prev.spending * 100) : null;
    add('recap', `recap:${pm}`, `Your ${name} recap`, `Spent ${fmt(r.spending)}${d != null ? ` (${d >= 0 ? '+' : ''}${d}% vs the month before)` : ''}, earned ${fmt(r.income)}, ${r.net >= 0 ? 'saved' : 'overspent by'} ${fmt(r.net)}.${r.topCategory ? ` Biggest category: ${r.topCategory.name}.` : ''}`, '#/reports?tab=flow&preset=last-month');
  }
  for (const c of db.prepare("SELECT id,name,error FROM connections WHERE status='error'").all())
    add('connection', `conn:${c.id}:${t}`, `${c.name} needs attention`, c.error || 'Reconnect this account.', '#/accounts');
}

module.exports = { evaluate, add, push };
