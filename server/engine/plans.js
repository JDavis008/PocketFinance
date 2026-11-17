// Debt payoff planner (avalanche / snowball) and retirement / financial-independence planner.
const { db, getSetting, setSetting } = require('../db');
const { today, addMonths, addDays, round2 } = require('../util');
const { accountsSummary } = require('./insights');

const MAX_MONTHS = 600;
const num = (v, d) => (v === '' || v == null || !Number.isFinite(Number(v)) ? d : Number(v));

// ---------------------------------------------------------------- debt
function debtList() {
  const cfg = getSetting('debt_plan', {}) || {};
  const ov = cfg.overrides || {};
  return db.prepare("SELECT id, name, type, balance, meta FROM accounts WHERE hidden=0 AND type IN ('credit','loan') AND balance>0.005 ORDER BY balance").all().map(a => {
    let meta = null; try { meta = JSON.parse(a.meta || 'null'); } catch {}
    const L = (meta && meta.liability) || {};
    const o = ov[a.id] || {};
    const aprKnown = L.apr != null && Number.isFinite(Number(L.apr));
    const apr = num(o.apr, aprKnown ? Number(L.apr) : a.type === 'credit' ? 22.9 : 7.5);
    // typical card minimum: interest + 1% of the balance, at least $25
    const estMin = Math.max(25, Math.ceil(a.balance * (a.type === 'credit' ? 0.01 + apr / 1200 : 0.02)));
    const min = num(o.min, L.minimum ? Number(L.minimum) : estMin);
    return { id: a.id, name: a.name, type: a.type, balance: round2(a.balance), apr, min: round2(min),
      aprEstimated: o.apr == null && !aprKnown, minEstimated: o.min == null && !L.minimum };
  });
}

/**
 * Month-by-month payoff. strategy: avalanche (highest APR first), snowball (smallest balance first),
 * or minimum (minimum payments only, nothing rolls over). A fixed monthly budget (all minimums + extra)
 * keeps going after a debt is paid off, so its minimum rolls on to the next target.
 */
function simulate(debts, strategy = 'avalanche', extra = 0) {
  const ds = debts.map(d => ({ ...d, bal: d.balance, interest: 0, paidOff: null }));
  const order = [...ds].sort(strategy === 'snowball' ? (a, b) => a.bal - b.bal || b.apr - a.apr : (a, b) => b.apr - a.apr || a.bal - b.bal);
  const budget = ds.reduce((s, d) => s + d.min, 0) + Math.max(0, extra);
  const timeline = [{ m: 0, balance: round2(ds.reduce((s, d) => s + d.bal, 0)) }];
  let month = 0, totalInterest = 0, totalPaid = 0;
  while (ds.some(d => d.bal > 0.005) && month < MAX_MONTHS) {
    month++;
    for (const d of ds) if (d.bal > 0.005) { const i = d.bal * d.apr / 1200; d.bal += i; d.interest += i; totalInterest += i; }
    let pool = strategy === 'minimum' ? 0 : budget;
    for (const d of ds) if (d.bal > 0.005) { const p = Math.min(d.min, d.bal); d.bal -= p; totalPaid += p; pool -= p; }
    if (strategy !== 'minimum') for (const d of order) { if (pool <= 0.005) break; if (d.bal > 0.005) { const p = Math.min(pool, d.bal); d.bal -= p; totalPaid += p; pool -= p; } }
    for (const d of ds) if (d.bal <= 0.005 && !d.paidOff) { d.bal = 0; d.paidOff = month; }
    timeline.push({ m: month, balance: round2(ds.reduce((s, d) => s + d.bal, 0)) });
  }
  const done = ds.every(d => d.bal <= 0.005);
  const start = today();
  return {
    strategy, extra, months: done ? month : null, payoffDate: done ? addMonths(start, month) : null, neverPaysOff: !done,
    totalInterest: round2(totalInterest), totalPaid: round2(totalPaid), monthlyBudget: round2(budget),
    order: order.map(d => d.id),
    debts: ds.map(d => ({ id: d.id, name: d.name, paidOffMonth: d.paidOff, payoffDate: d.paidOff ? addMonths(start, d.paidOff) : null, interest: round2(d.interest) })),
    timeline: timeline.filter((p, i) => timeline.length <= 120 || i % Math.ceil(timeline.length / 120) === 0 || i === timeline.length - 1),
  };
}

function debtPlan(input) {
  const cfg = getSetting('debt_plan', {}) || {};
  const extra = Math.max(0, num(input && input.extra, num(cfg.extra, 100)));
  const strategy = ['avalanche', 'snowball'].includes(input && input.strategy) ? input.strategy : cfg.strategy || 'avalanche';
  const debts = debtList();
  if (!debts.length) return { debts, extra, strategy, empty: true };
  const avalanche = simulate(debts, 'avalanche', extra), snowball = simulate(debts, 'snowball', extra), minimum = simulate(debts, 'minimum', 0);
  return { debts, extra, strategy, avalanche, snowball, minimum, chosen: strategy === 'snowball' ? snowball : avalanche,
    totalDebt: round2(debts.reduce((s, d) => s + d.balance, 0)), totalMin: round2(debts.reduce((s, d) => s + d.min, 0)) };
}

function saveDebtPlan(b) {
  const cfg = getSetting('debt_plan', {}) || {};
  const next = { extra: cfg.extra ?? 100, strategy: cfg.strategy || 'avalanche', overrides: cfg.overrides || {} };
  if (b.extra != null) next.extra = Math.max(0, num(b.extra, 0));
  if (['avalanche', 'snowball'].includes(b.strategy)) next.strategy = b.strategy;
  if (b.overrides && typeof b.overrides === 'object') {
    for (const [id, o] of Object.entries(b.overrides)) {
      const cur = { ...(next.overrides[id] || {}) };
      if (o.apr !== undefined) { if (o.apr === null || o.apr === '') delete cur.apr; else cur.apr = Math.min(99, Math.max(0, num(o.apr, 0))); }
      if (o.min !== undefined) { if (o.min === null || o.min === '') delete cur.min; else cur.min = Math.max(1, num(o.min, 1)); }
      next.overrides[id] = cur;
    }
  }
  setSetting('debt_plan', next);
}

// ---------------------------------------------------------------- retirement
// small seeded PRNG so the Monte Carlo result is stable between page loads
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function retireDefaults() {
  const s = accountsSummary();
  const t = today();
  const sum = (sql, ...a) => db.prepare(sql).get(...a).v || 0;
  const J = 'FROM transactions t LEFT JOIN categories c ON c.name=t.category';
  const spend12 = sum(`SELECT SUM(-t.amount) v ${J} WHERE t.excluded=0 AND COALESCE(c.kind,'expense')='expense' AND t.date>?`, addDays(t, -365));
  const firstTx = db.prepare('SELECT MIN(date) d FROM transactions').get().d;
  const spanDays = firstTx ? Math.min(365, Math.max(30, (new Date(t) - new Date(firstTx)) / 864e5)) : 365;
  const inc6 = sum(`SELECT SUM(t.amount) v ${J} WHERE t.excluded=0 AND c.kind='income' AND t.date>?`, addDays(t, -182));
  const sp6 = sum(`SELECT SUM(-t.amount) v ${J} WHERE t.excluded=0 AND COALESCE(c.kind,'expense')='expense' AND t.date>?`, addDays(t, -182));
  const span6 = Math.min(182, spanDays);
  return {
    current: round2(s.investments + s.crypto),
    monthly: Math.max(0, Math.round((inc6 - sp6) / (span6 / 30.44))),
    spendYear: spend12 > 0 ? Math.round(spend12 * 365 / spanDays) : 48000,
  };
}

function retirePlan(input) {
  const saved = getSetting('retire_plan', {}) || {};
  const def = retireDefaults();
  const v = { ...saved, ...(input || {}) };
  const p = {
    age: Math.round(Math.min(90, Math.max(16, num(v.age, 35)))),
    retireAge: Math.round(Math.min(95, Math.max(20, num(v.retireAge, 65)))),
    lifeAge: Math.round(Math.min(110, Math.max(60, num(v.lifeAge, 95)))),
    current: Math.max(0, num(v.current, def.current)),
    monthly: Math.max(0, num(v.monthly, def.monthly)),
    spendYear: Math.max(0, num(v.spendYear, def.spendYear)),
    returnPct: Math.min(15, Math.max(0, num(v.returnPct, 7))),
    inflation: Math.min(10, Math.max(0, num(v.inflation, 3))),
    swr: Math.min(10, Math.max(2, num(v.swr, 4))),
    other: Math.max(0, num(v.other, 0)), // yearly income in retirement (pension, Social Security / CPP), today's dollars
  };
  if (p.retireAge <= p.age) p.retireAge = p.age + 1;
  if (p.lifeAge <= p.retireAge) p.lifeAge = p.retireAge + 1;
  // everything in today's dollars, using the real (after-inflation) return
  const r = (1 + p.returnPct / 100) / (1 + p.inflation / 100) - 1;
  const need = Math.max(0, p.spendYear - p.other);
  const fiNumber = round2(need / (p.swr / 100));
  const yearsToRetire = p.retireAge - p.age;

  // deterministic projection
  const path = []; let bal = p.current, fiAge = bal >= fiNumber ? p.age : null;
  for (let age = p.age; age <= p.lifeAge; age++) {
    path.push({ age, balance: round2(Math.max(0, bal)) });
    if (age < p.retireAge) bal = bal * (1 + r) + p.monthly * 12; else bal = bal * (1 + r) - need;
    if (fiAge == null && age < p.retireAge && bal >= fiNumber) fiAge = age + 1;
  }
  const atRetire = (path.find(x => x.age === p.retireAge) || {}).balance || 0;
  const runsOut = path.find(x => x.age > p.retireAge && x.balance <= 0);
  // monthly saving needed to reach the FI number by the retirement age
  const g = Math.pow(1 + r, yearsToRetire);
  const neededMonthly = Math.max(0, r ? (fiNumber - p.current * g) * r / (g - 1) / 12 : (fiNumber - p.current) / yearsToRetire / 12);
  const coastFi = round2(fiNumber / g);

  // Monte Carlo: yearly returns ~ normal(mean, 15%), 1,000 runs
  const rnd = mulberry32(42), sd = 0.15, runs = 1000;
  const gauss = () => { let u = 0, w = 0; while (!u) u = rnd(); while (!w) w = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w); };
  const n = p.lifeAge - p.age; const byYear = Array.from({ length: n + 1 }, () => []);
  let ok = 0;
  for (let k = 0; k < runs; k++) {
    let b = p.current, alive = true; byYear[0].push(b);
    for (let y = 1; y <= n; y++) {
      const ret = (1 + p.returnPct / 100 + sd * gauss()) / (1 + p.inflation / 100) - 1;
      b = p.age + y - 1 < p.retireAge ? b * (1 + ret) + p.monthly * 12 : b * (1 + ret) - need;
      if (b <= 0) { b = 0; alive = false; }
      byYear[y].push(b);
    }
    if (alive) ok++;
  }
  const pct = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return round2(s[Math.min(s.length - 1, Math.floor(q * s.length))]); };
  const bands = byYear.map((arr, i) => ({ age: p.age + i, p10: pct(arr, 0.1), p50: pct(arr, 0.5), p90: pct(arr, 0.9) }));

  return { inputs: p, defaults: def, realReturn: round2(r * 100), fiNumber, fiAge, yearsToFi: fiAge != null ? fiAge - p.age : null,
    atRetire, runsOutAge: runsOut ? runsOut.age : null, neededMonthly: round2(neededMonthly), coastFi, coastReached: p.current >= coastFi,
    successRate: round2(ok / runs * 100), path, bands };
}

function saveRetirePlan(b) {
  const keys = ['age', 'retireAge', 'lifeAge', 'current', 'monthly', 'spendYear', 'returnPct', 'inflation', 'swr', 'other'];
  const cur = getSetting('retire_plan', {}) || {};
  for (const k of keys) if (b[k] !== undefined) { if (b[k] === '' || b[k] === null) delete cur[k]; else if (Number.isFinite(Number(b[k]))) cur[k] = Number(b[k]); }
  setSetting('retire_plan', cur);
}

module.exports = { debtList, simulate, debtPlan, saveDebtPlan, retirePlan, saveRetirePlan };
