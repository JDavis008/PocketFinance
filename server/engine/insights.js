// Spending, budgets, cash flow, net worth and forecasts.
const { db } = require('../db');
const { upcoming, perMonth } = require('./recurring');
const { today, addDays, monthOf, monthStart, monthEnd, prevMonth, round2, parseISO, daysBetween } = require('../util');

const ASSET_TYPES = ['depository', 'investment', 'crypto', 'property', 'vehicle', 'other'];
const LIAB_TYPES = ['credit', 'loan'];
const SPEND_WHERE = "t.excluded=0 AND COALESCE(c.kind,'expense')='expense'";
const INCOME_WHERE = "t.excluded=0 AND c.kind='income'";
const JOIN = 'FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN categories c ON c.name=t.category';

function monthTotals(month) {
  const s = monthStart(month), e = monthEnd(month);
  const spend = db.prepare(`SELECT COALESCE(SUM(-t.amount),0) v ${JOIN} WHERE ${SPEND_WHERE} AND t.date BETWEEN ? AND ?`).get(s, e).v;
  const income = db.prepare(`SELECT COALESCE(SUM(t.amount),0) v ${JOIN} WHERE ${INCOME_WHERE} AND t.date BETWEEN ? AND ?`).get(s, e).v;
  return { month, spending: round2(spend), income: round2(income), net: round2(income - spend) };
}

function byCategory(month) {
  return db.prepare(`SELECT t.category name, c.color, c.icon, c.grp, ROUND(SUM(-t.amount),2) total, COUNT(*) n ${JOIN}
    WHERE ${SPEND_WHERE} AND t.date BETWEEN ? AND ? GROUP BY t.category HAVING total>0 ORDER BY total DESC`).all(monthStart(month), monthEnd(month));
}
function byMerchant(month, limit = 10) {
  return db.prepare(`SELECT t.merchant name, MAX(t.logo) logo, ROUND(SUM(-t.amount),2) total, COUNT(*) n ${JOIN}
    WHERE ${SPEND_WHERE} AND t.date BETWEEN ? AND ? GROUP BY t.merchant_key HAVING total>0 ORDER BY total DESC LIMIT ?`).all(monthStart(month), monthEnd(month), limit);
}

// cumulative daily spend, this month vs last (the classic "are you on pace" chart)
function dailyCumulative(month) {
  const series = m => {
    const rows = db.prepare(`SELECT t.date d, SUM(-t.amount) v ${JOIN} WHERE ${SPEND_WHERE} AND t.date BETWEEN ? AND ? GROUP BY t.date`).all(monthStart(m), monthEnd(m));
    const map = Object.fromEntries(rows.map(r => [Number(r.d.slice(8)), r.v]));
    const days = Number(monthEnd(m).slice(8)); let acc = 0; const out = [];
    for (let d = 1; d <= days; d++) { acc += map[d] || 0; out.push(round2(acc)); }
    return out;
  };
  const cur = series(month);
  const isCurrent = month === monthOf(today());
  return { current: isCurrent ? cur.slice(0, Number(today().slice(8))) : cur, previous: series(prevMonth(month)) };
}

function cashflow(months = 12) {
  const out = []; let m = monthOf(today());
  for (let i = 0; i < months; i++) { out.unshift(monthTotals(m)); m = prevMonth(m); }
  return out;
}

function budgets(month) {
  const rows = db.prepare('SELECT b.category, b.amount, b.rollover, c.icon, c.color, c.grp FROM budgets b LEFT JOIN categories c ON c.name=b.category ORDER BY c.grp, b.category').all();
  const spent = Object.fromEntries(byCategory(month).map(r => [r.name, r.total]));
  const prevSpent = Object.fromEntries(byCategory(prevMonth(month)).map(r => [r.name, r.total]));
  const daysIn = Number(monthEnd(month).slice(8));
  const dayNow = month === monthOf(today()) ? Number(today().slice(8)) : daysIn;
  const list = rows.map(b => {
    const carry = b.rollover ? round2(Math.max(-b.amount, b.amount - (prevSpent[b.category] || 0))) : 0;
    const limit = round2(b.amount + carry);
    const s = spent[b.category] || 0;
    return { ...b, carry, limit, spent: round2(s), remaining: round2(limit - s), pct: limit > 0 ? s / limit : 0, pace: (dayNow / daysIn) };
  });
  const total = list.reduce((a, b) => a + b.limit, 0);
  const totalSpent = list.reduce((a, b) => a + b.spent, 0);
  const allSpend = monthTotals(month).spending;
  return { month, list, total: round2(total), spent: round2(totalSpent), unbudgeted: round2(allSpend - totalSpent), dayNow, daysIn };
}

function accountsSummary() {
  const accts = db.prepare('SELECT * FROM accounts WHERE hidden=0').all();
  const sum = types => round2(accts.filter(a => types.includes(a.type) && a.include_net_worth).reduce((s, a) => s + (a.balance || 0), 0));
  const cash = round2(accts.filter(a => a.type === 'depository').reduce((s, a) => s + (a.balance || 0), 0));
  const credit = round2(accts.filter(a => a.type === 'credit').reduce((s, a) => s + (a.balance || 0), 0));
  const creditLimit = accts.filter(a => a.type === 'credit' && a.credit_limit).reduce((s, a) => s + a.credit_limit, 0);
  const creditUsed = accts.filter(a => a.type === 'credit' && a.credit_limit).reduce((s, a) => s + (a.balance || 0), 0);
  return {
    assets: sum(ASSET_TYPES), liabilities: sum(LIAB_TYPES), netWorth: round2(sum(ASSET_TYPES) - sum(LIAB_TYPES)), cash, credit,
    investments: sum(['investment']), crypto: sum(['crypto']), property: sum(['property', 'vehicle', 'other']), loans: sum(['loan']),
    utilization: creditLimit ? round2(creditUsed / creditLimit * 100) : null,
  };
}

// Net worth over time: carry each account's last known balance forward.
function netWorthHistory(days = 365) {
  const start = addDays(today(), -days);
  const accts = db.prepare('SELECT id, type FROM accounts WHERE hidden=0 AND include_net_worth=1').all();
  const sign = Object.fromEntries(accts.map(a => [a.id, LIAB_TYPES.includes(a.type) ? -1 : 1]));
  const hist = db.prepare('SELECT account_id, date, balance FROM balance_history WHERE date>=? ORDER BY date').all(start);
  const before = db.prepare(`SELECT h.account_id, h.balance FROM balance_history h
    JOIN (SELECT account_id, MAX(date) d FROM balance_history WHERE date<? GROUP BY account_id) x ON x.account_id=h.account_id AND x.d=h.date`).all(start);
  const last = {}; before.forEach(b => { if (sign[b.account_id]) last[b.account_id] = b.balance; });
  const byDate = {}; hist.forEach(h => (byDate[h.date] ||= []).push(h));
  const out = []; let d = start; const end = today();
  let firstSeen = Object.keys(last).length > 0;
  while (d <= end) {
    for (const h of byDate[d] || []) if (sign[h.account_id]) { last[h.account_id] = h.balance; firstSeen = true; }
    if (firstSeen) {
      let assets = 0, liab = 0;
      for (const [id, b] of Object.entries(last)) (sign[id] > 0 ? (assets += b) : (liab += b));
      out.push({ date: d, assets: round2(assets), liabilities: round2(liab), net: round2(assets - liab) });
    }
    d = addDays(d, 1);
  }
  return out;
}

// "Safe to spend": cash now, minus bills before next payday, plus income landing.
function forecast(days = 30) {
  const s = accountsSummary();
  const t = today(), end = addDays(t, days);
  const items = upcoming(t, end);
  let bal = s.cash; const points = [{ date: t, balance: round2(bal) }];
  const byDate = {}; items.forEach(i => (byDate[i.date] ||= []).push(i));
  let d = t; let low = bal, lowDate = t;
  // average discretionary daily spend (last 60 days, excluding recurring)
  const disc = db.prepare(`SELECT COALESCE(SUM(-t.amount),0) v ${JOIN} WHERE ${SPEND_WHERE} AND t.recurring_id IS NULL AND t.date>?`).get(addDays(t, -60)).v / 60;
  for (let i = 1; i <= days; i++) {
    d = addDays(d, 1);
    for (const it of byDate[d] || []) bal += it.kind === 'income' ? it.amount : -it.amount;
    bal -= disc;
    points.push({ date: d, balance: round2(bal) });
    if (bal < low) { low = bal; lowDate = d; }
  }
  const nextPay = items.find(i => i.kind === 'income');
  const billsBeforePay = items.filter(i => i.kind !== 'income' && (!nextPay || i.date <= nextPay.date)).reduce((a, b) => a + b.amount, 0);
  return { points, low: round2(low), lowDate, dailyDiscretionary: round2(disc), nextPaycheck: nextPay || null,
    safeToSpend: round2(s.cash - billsBeforePay), billsBeforePay: round2(billsBeforePay) };
}

function subscriptionTotals() {
  const rows = db.prepare("SELECT amount, cadence, kind FROM recurring WHERE status='active'").all();
  const m = k => round2(rows.filter(r => r.kind === k).reduce((s, r) => s + perMonth(r.amount, r.cadence), 0));
  return { subscriptionsMonthly: m('subscription'), billsMonthly: m('bill'), incomeMonthly: m('income'), count: rows.filter(r => r.kind !== 'income').length };
}

function dashboard() {
  const m = monthOf(today());
  const t = today();
  return {
    month: m, today: t, accounts: accountsSummary(), thisMonth: monthTotals(m), lastMonth: monthTotals(prevMonth(m)),
    daily: dailyCumulative(m), upcoming: upcoming(t, addDays(t, 14)), subs: subscriptionTotals(), budgets: budgets(m),
    topCategories: byCategory(m).slice(0, 6), netWorth: netWorthHistory(180), forecast: forecast(30),
    recent: db.prepare(`SELECT t.*, a.name account_name, c.icon, c.color FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN categories c ON c.name=t.category ORDER BY t.date DESC, t.id DESC LIMIT 8`).all(),
    alerts: db.prepare('SELECT * FROM alerts WHERE read=0 ORDER BY created DESC LIMIT 5').all(),
    credit: db.prepare('SELECT * FROM credit_scores ORDER BY date DESC LIMIT 1').get() || null,
    recurring: db.prepare(`SELECT r.id, COALESCE(r.custom_name, r.name) name, r.amount, r.prev_amount, r.cadence, r.next_date, r.last_date, r.kind, r.category,
        c.icon, c.color, a.name account_name FROM recurring r LEFT JOIN categories c ON c.name=r.category LEFT JOIN accounts a ON a.id=r.account_id
        WHERE r.status='active' AND r.kind!='income' ORDER BY r.next_date`).all()
      .map(r => ({ ...r, monthly: Math.round(perMonth(r.amount, r.cadence) * 100) / 100, paidThisMonth: !!r.last_date && r.last_date >= `${m}-01` })),
  };
}

function report(month) {
  return { month, totals: monthTotals(month), prev: monthTotals(prevMonth(month)), categories: byCategory(month),
    prevCategories: byCategory(prevMonth(month)), merchants: byMerchant(month, 15), daily: dailyCumulative(month), cashflow: cashflow(12),
    income: db.prepare(`SELECT t.merchant name, ROUND(SUM(t.amount),2) total ${JOIN} WHERE ${INCOME_WHERE} AND t.date BETWEEN ? AND ? GROUP BY t.merchant_key ORDER BY total DESC LIMIT 8`).all(monthStart(month), monthEnd(month)) };
}

module.exports = { dashboard, report, budgets, accountsSummary, netWorthHistory, forecast, cashflow, monthTotals, subscriptionTotals };
