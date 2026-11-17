// Custom-range reports, cash-flow (Sankey) data and the year in review.
const { db } = require('../db');
const { today, addDays, daysBetween, round2, monthOf, monthEnd } = require('../util');
const { netWorthHistory } = require('./insights');

const JOIN = 'FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN categories c ON c.name=t.category';
const SPEND = "t.excluded=0 AND COALESCE(c.kind,'expense')='expense'";
const INCOME = "t.excluded=0 AND c.kind='income'";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ',a,b,' <-> ['a','b']
const tagList = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
function normTags(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(',');
  const seen = new Set(), out = [];
  for (let t of raw) {
    t = String(t).replace(/[,\n\r]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^#/, '').slice(0, 30);
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
    if (out.length >= 10) break;
  }
  return out.length ? ',' + out.join(',') + ',' : null;
}
function allTags() {
  const n = {};
  for (const r of db.prepare("SELECT tags FROM transactions WHERE tags IS NOT NULL AND tags!=''").all()) for (const t of tagList(r.tags)) n[t] = (n[t] || 0) + 1;
  return Object.entries(n).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function filters(o) {
  const w = [], args = [];
  if (o.account) { w.push('t.account_id=?'); args.push(Number(o.account)); }
  if (o.tag) { w.push('t.tags LIKE ?'); args.push(`%,${o.tag},%`); }
  return { sql: w.length ? ' AND ' + w.join(' AND ') : '', args };
}

function totals(from, to, f) {
  const s = db.prepare(`SELECT COALESCE(SUM(-t.amount),0) v, COUNT(*) n ${JOIN} WHERE ${SPEND} AND t.date BETWEEN ? AND ?${f.sql}`).get(from, to, ...f.args);
  const i = db.prepare(`SELECT COALESCE(SUM(t.amount),0) v ${JOIN} WHERE ${INCOME} AND t.date BETWEEN ? AND ?${f.sql}`).get(from, to, ...f.args).v;
  return { spending: round2(s.v), income: round2(i), net: round2(i - s.v), count: s.n };
}

/** Report for any date range. groupBy: category | group | merchant | account | tag */
function range(o = {}) {
  const to = DATE_RE.test(o.to || '') ? o.to : today();
  const from = DATE_RE.test(o.from || '') ? o.from : to.slice(0, 8) + '01';
  if (from > to) throw Object.assign(new Error('"From" must be before "to".'), { status: 400 });
  const groupBy = ['category', 'group', 'merchant', 'account', 'tag'].includes(o.groupBy) ? o.groupBy : 'category';
  const f = filters(o);
  const days = daysBetween(from, to) + 1;
  const tot = totals(from, to, f);
  const prevTo = addDays(from, -1), prevFrom = addDays(from, -days);
  const prev = totals(prevFrom, prevTo, f);

  let groups;
  if (groupBy === 'tag') {
    const m = {};
    for (const r of db.prepare(`SELECT t.tags, -t.amount v ${JOIN} WHERE ${SPEND} AND t.date BETWEEN ? AND ?${f.sql}`).all(from, to, ...f.args)) {
      const tags = tagList(r.tags); for (const t of tags.length ? tags : ['(no tag)']) { m[t] ||= { name: t, total: 0, n: 0 }; m[t].total += r.v; m[t].n++; }
    }
    groups = Object.values(m).map(g => ({ ...g, total: round2(g.total) }));
  } else {
    const col = { category: 't.category', group: "COALESCE(c.grp,'Other')", merchant: 't.merchant_key', account: 'a.id' }[groupBy];
    const label = { category: 't.category', group: "COALESCE(c.grp,'Other')", merchant: 'MAX(t.merchant)', account: 'MAX(a.name)' }[groupBy];
    const extra = groupBy === 'category' ? ', MAX(c.color) color, MAX(c.icon) icon' : groupBy === 'merchant' ? ', MAX(t.logo) logo, MAX(t.merchant_key) key' : groupBy === 'account' ? ', a.id key' : '';
    groups = db.prepare(`SELECT ${label} name, ROUND(SUM(-t.amount),2) total, COUNT(*) n${extra} ${JOIN} WHERE ${SPEND} AND t.date BETWEEN ? AND ?${f.sql} GROUP BY ${col}`).all(from, to, ...f.args);
  }
  groups = groups.filter(g => g.total > 0.004).sort((a, b) => b.total - a.total);
  // previous-period amount per group, for the change column
  if (groupBy === 'category' || groupBy === 'group') {
    const col = groupBy === 'category' ? 't.category' : "COALESCE(c.grp,'Other')";
    const pm = Object.fromEntries(db.prepare(`SELECT ${col} name, SUM(-t.amount) total ${JOIN} WHERE ${SPEND} AND t.date BETWEEN ? AND ?${f.sql} GROUP BY ${col}`).all(prevFrom, prevTo, ...f.args).map(r => [r.name, round2(r.total)]));
    groups.forEach(g => { g.prev = pm[g.name] || 0; });
  }

  // month-by-month trend inside the range (at most 36 buckets)
  const monthly = [];
  for (let m = monthOf(from), i = 0; m <= monthOf(to) && i < 36; i++) {
    const s = m + '-01' < from ? from : m + '-01', e = monthEnd(m) > to ? to : monthEnd(m);
    monthly.push({ month: m, ...totals(s, e, f) });
    const [y, mo] = m.split('-').map(Number); m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  }

  // cash-flow diagram: income sources -> money in -> spending groups (+ categories) and savings
  const income = db.prepare(`SELECT t.category name, MAX(c.color) color, ROUND(SUM(t.amount),2) total ${JOIN} WHERE ${INCOME} AND t.date BETWEEN ? AND ?${f.sql} GROUP BY t.category HAVING total>0 ORDER BY total DESC`).all(from, to, ...f.args);
  const cats = db.prepare(`SELECT t.category name, COALESCE(MAX(c.grp),'Other') grp, MAX(c.color) color, ROUND(SUM(-t.amount),2) total ${JOIN} WHERE ${SPEND} AND t.date BETWEEN ? AND ?${f.sql} GROUP BY t.category HAVING total>0 ORDER BY total DESC`).all(from, to, ...f.args);
  const byGroup = {};
  for (const c of cats) { byGroup[c.grp] ||= { name: c.grp, total: 0, color: c.color, children: [] }; byGroup[c.grp].total = round2(byGroup[c.grp].total + c.total); byGroup[c.grp].children.push(c); }
  const sankey = { income, groups: Object.values(byGroup).sort((a, b) => b.total - a.total), saved: round2(Math.max(0, tot.net)), fromSavings: round2(Math.max(0, -tot.net)) };

  return { from, to, days, groupBy, totals: { ...tot, savingsRate: tot.income > 0 ? round2(tot.net / tot.income * 100) : null, perDay: round2(tot.spending / days) },
    prev: { from: prevFrom, to: prevTo, ...prev }, groups, monthly, sankey };
}

/** "Wrapped"-style summary of a calendar year (to date, for the current year). */
function yearReview(year) {
  year = Number(year) || Number(today().slice(0, 4));
  const from = `${year}-01-01`, end = `${year}-12-31`, to = end < today() ? end : today();
  if (from > today()) throw Object.assign(new Error('That year has not started yet.'), { status: 400 });
  const none = { sql: '', args: [] };
  const tot = totals(from, to, none);
  const prevTot = totals(`${year - 1}-01-01`, `${year - 1}-12-31`, none);
  const W = `${SPEND} AND t.date BETWEEN ? AND ?`;
  const topCategories = db.prepare(`SELECT t.category name, MAX(c.icon) icon, MAX(c.color) color, ROUND(SUM(-t.amount),2) total ${JOIN} WHERE ${W} GROUP BY t.category HAVING total>0 ORDER BY total DESC LIMIT 5`).all(from, to);
  const topMerchants = db.prepare(`SELECT MAX(t.merchant) name, MAX(t.logo) logo, ROUND(SUM(-t.amount),2) total, COUNT(*) n ${JOIN} WHERE ${W} GROUP BY t.merchant_key HAVING total>0 ORDER BY total DESC LIMIT 5`).all(from, to);
  const regular = db.prepare(`SELECT MAX(t.merchant) name, COUNT(*) n, ROUND(SUM(-t.amount),2) total ${JOIN} WHERE ${W} AND t.amount<0 GROUP BY t.merchant_key ORDER BY n DESC, total DESC LIMIT 1`).get(from, to) || null;
  const biggest = db.prepare(`SELECT t.id, t.merchant name, t.date, ROUND(-t.amount,2) total, t.category ${JOIN} WHERE ${W} AND t.amount<0 ORDER BY t.amount ASC LIMIT 1`).get(from, to) || null;
  const subs = db.prepare(`SELECT COALESCE(ROUND(SUM(-t.amount),2),0) v ${JOIN} JOIN recurring r ON r.id=t.recurring_id WHERE ${W} AND r.kind='subscription'`).get(from, to).v;
  const months = [];
  for (let m = 1; m <= 12; m++) { const mm = `${year}-${String(m).padStart(2, '0')}`; if (mm + '-01' > to) break; months.push({ month: mm, ...totals(mm + '-01', monthEnd(mm) > to ? to : monthEnd(mm), none) }); }
  const spentMonths = months.filter(m => m.spending > 0);
  const spendDays = new Set(db.prepare(`SELECT DISTINCT t.date d ${JOIN} WHERE ${W} AND t.amount<0`).all(from, to).map(r => r.d));
  const dayCount = daysBetween(from, to) + 1;
  // net worth change across the year, from balance history
  let netWorth = null;
  const h = netWorthHistory(daysBetween(from, today()) + 1).filter(p => p.date >= from && p.date <= to);
  if (h.length > 1) netWorth = { start: h[0].net, end: h[h.length - 1].net, change: round2(h[h.length - 1].net - h[0].net), since: h[0].date };
  return {
    year, from, to, partial: to < end, days: dayCount,
    totals: { ...tot, savingsRate: tot.income > 0 ? round2(tot.net / tot.income * 100) : null, perDay: round2(tot.spending / dayCount) },
    prev: prevTot, topCategories, topMerchants, regular, biggest, subscriptions: round2(subs), months,
    priciestMonth: spentMonths.length ? spentMonths.reduce((a, b) => (b.spending > a.spending ? b : a)) : null,
    // only finished months can be the thriftiest (a half-done month always looks cheap)
    thriftiestMonth: (full => (full.length > 1 ? full.reduce((a, b) => (b.spending < a.spending ? b : a)) : null))(spentMonths.filter(m => monthEnd(m.month) <= to)),
    noSpendDays: dayCount - spendDays.size, netWorth,
    years: db.prepare("SELECT DISTINCT substr(date,1,4) y FROM transactions ORDER BY y DESC").all().map(r => Number(r.y)),
  };
}

// Categories people often deduct or need at tax time (US/Canada) — shown so they can be reviewed and flagged.
const TAX_HINTS = {
  'Gifts & Donations': 'Charitable donations (keep receipts over $250)',
  'Health & Wellness': 'Medical expenses above 7.5% of income (US) / 3% (Canada)',
  'Education': 'Tuition and education credits',
  'Business': 'Business or self-employment expenses',
  'Taxes': 'Property tax / estimated tax payments',
  'Kids': 'Childcare may qualify for a credit',
};
/** Tax summary for a calendar year: flagged deductions, likely ones to review, income by type. */
function taxYear(year) {
  year = Number(year) || Number(today().slice(0, 4));
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const flagged = db.prepare(`SELECT t.id, t.date, t.merchant, t.category, ROUND(-t.amount,2) amount, t.notes, (SELECT COUNT(*) FROM attachments x WHERE x.tx_id=t.id) att ${JOIN}
    WHERE t.tax_deductible=1 AND t.date BETWEEN ? AND ? ORDER BY t.category, t.date`).all(from, to);
  const byCat = {};
  for (const r of flagged) { byCat[r.category] ||= { name: r.category, total: 0, n: 0, receipts: 0 }; byCat[r.category].total = round2(byCat[r.category].total + r.amount); byCat[r.category].n++; if (r.att) byCat[r.category].receipts++; }
  const review = db.prepare(`SELECT t.category name, ROUND(SUM(-t.amount),2) total, COUNT(*) n ${JOIN} WHERE t.excluded=0 AND t.amount<0 AND t.tax_deductible=0 AND t.date BETWEEN ? AND ?
    AND t.category IN (${Object.keys(TAX_HINTS).map(() => '?').join(',')}) GROUP BY t.category ORDER BY total DESC`).all(from, to, ...Object.keys(TAX_HINTS)).map(r => ({ ...r, hint: TAX_HINTS[r.name] }));
  const income = db.prepare(`SELECT t.category name, ROUND(SUM(t.amount),2) total, COUNT(*) n ${JOIN} WHERE ${INCOME} AND t.date BETWEEN ? AND ? GROUP BY t.category ORDER BY total DESC`).all(from, to);
  return { year, flagged, categories: Object.values(byCat).sort((a, b) => b.total - a.total), total: round2(flagged.reduce((s, r) => s + r.amount, 0)),
    missingReceipts: flagged.filter(r => !r.att).length, review, income, incomeTotal: round2(income.reduce((s, r) => s + r.total, 0)),
    years: db.prepare('SELECT DISTINCT substr(date,1,4) y FROM transactions ORDER BY y DESC').all().map(r => Number(r.y)) };
}

module.exports = { range, yearReview, taxYear, normTags, tagList, allTags };
