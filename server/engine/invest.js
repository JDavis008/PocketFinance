// Investments: holdings across accounts, asset mix, fee analyzer, gains, dividends and history.
const { db, getSetting, setSetting } = require('../db');
const { today, addDays, round2 } = require('../util');

// Expense ratios (% per year) of popular funds and ETFs. Users can override or add any ticker.
const FEES = {
  FXAIX: 0.015, FZROX: 0, FZILX: 0, FSKAX: 0.015, FTIHX: 0.06, FXNAX: 0.025, FSPSX: 0.035, FNILX: 0,
  VFIAX: 0.04, VTSAX: 0.04, VTIAX: 0.12, VBTLX: 0.05, VTI: 0.03, VOO: 0.03, VXUS: 0.05, BND: 0.03, VEA: 0.05, VWO: 0.07, VIG: 0.05, VYM: 0.06, VGT: 0.09, VNQ: 0.13, VT: 0.06, BNDX: 0.07, VTEB: 0.05,
  VFFVX: 0.08, VTTSX: 0.08, VFIFX: 0.08, VTHRX: 0.08, VTTVX: 0.08, VTIVX: 0.08, VTINX: 0.08, VLXVX: 0.08,
  SPY: 0.0945, IVV: 0.03, ITOT: 0.03, IXUS: 0.07, AGG: 0.03, IEFA: 0.07, IEMG: 0.09, IJH: 0.05, IJR: 0.06, TLT: 0.15, SHY: 0.15, LQD: 0.14, GLD: 0.40, IAU: 0.25, SLV: 0.50,
  SCHB: 0.03, SCHX: 0.03, SCHD: 0.06, SCHF: 0.06, SCHZ: 0.03, SWPPX: 0.02, SWTSX: 0.03, SCHG: 0.04,
  QQQ: 0.20, QQQM: 0.15, DIA: 0.16, IWM: 0.19, ARKK: 0.75, XLK: 0.09, XLF: 0.09, XLE: 0.09, VUG: 0.04, VTV: 0.04, RSP: 0.20, JEPI: 0.35, JEPQ: 0.35,
  // Canadian ETFs
  XEQT: 0.20, VEQT: 0.24, XGRO: 0.20, VGRO: 0.24, XBAL: 0.20, VBAL: 0.24, ZSP: 0.09, XIC: 0.06, VFV: 0.09, ZAG: 0.09, XAW: 0.22, VCN: 0.05, ZEB: 0.28, HXT: 0.03,
};
const CHEAP = 0.05; // what a low-cost index fund costs, for the comparison

const US_STOCK = /^(FXAIX|FZROX|FSKAX|FNILX|VFIAX|VTSAX|VTI|VOO|SPY|IVV|ITOT|SCHB|SCHX|SWPPX|SWTSX|SCHG|SCHD|QQQ|QQQM|DIA|IWM|IJH|IJR|VIG|VYM|VGT|XLK|XLF|XLE|VUG|VTV|RSP|ARKK|JEPI|JEPQ|VFV|ZSP|HXT)$/;
const INTL_STOCK = /^(FZILX|FTIHX|FSPSX|VTIAX|VXUS|VEA|VWO|IXUS|IEFA|IEMG|SCHF|XAW)$/;
const BONDS = /^(FXNAX|VBTLX|BND|BNDX|VTEB|AGG|TLT|SHY|LQD|SCHZ|ZAG)$/;
const CA_STOCK = /^(XIC|VCN|ZEB)$/;
const REAL_ESTATE = /^(VNQ|SCHH|IYR|XLRE)$/;
const COMMOD = /^(GLD|IAU|SLV)$/;
const ALLOC_ALL_EQUITY = /^(XEQT|VEQT)$/;
const ALLOC_GROWTH = /^(XGRO|VGRO)$/;
const ALLOC_BAL = /^(XBAL|VBAL)$/;

/** Split one holding into asset classes: {us, intl, bonds, cash, crypto, realestate, other} fractions. */
function classify(h) {
  const t = String(h.ticker || '').toUpperCase(), name = String(h.name || ''), type = String(h.type || '').toLowerCase();
  if (type === 'cash' || /money market|cash|sweep|settlement/i.test(name) || /^(SPAXX|FDRXX|VMFXX|SWVXX|FZFXX|CORE)$/.test(t)) return { cash: 1 };
  if (type === 'cryptocurrency' || h.crypto) return { crypto: 1 };
  const td = name.match(/(?:target|retirement|freedom|lifepath)[^0-9]*(20\d\d)/i) || (/^(VFFVX|VTTSX|VFIFX|VTHRX|VTTVX|VTIVX|VTINX|VLXVX)$/.test(t) && { 1: { VLXVX: 2065, VTTSX: 2060, VFFVX: 2055, VFIFX: 2050, VTIVX: 2045, VTHRX: 2030, VTTVX: 2025, VTINX: 2020 }[t] || 2040 });
  if (td) {
    // glide path: about 90% stocks 25+ years out, sliding to ~50% at the target year
    const yrs = Number(td[1]) - Number(today().slice(0, 4));
    const stocks = Math.max(0.3, Math.min(0.9, 0.5 + yrs * 0.016));
    return { us: stocks * 0.6, intl: stocks * 0.4, bonds: 1 - stocks };
  }
  if (ALLOC_ALL_EQUITY.test(t)) return { us: 0.45, intl: 0.3, ca: 0.25 };
  if (ALLOC_GROWTH.test(t)) return { us: 0.36, intl: 0.24, ca: 0.2, bonds: 0.2 };
  if (ALLOC_BAL.test(t)) return { us: 0.27, intl: 0.18, ca: 0.15, bonds: 0.4 };
  if (US_STOCK.test(t)) return { us: 1 };
  if (INTL_STOCK.test(t)) return { intl: 1 };
  if (BONDS.test(t) || type === 'fixed income' || /bond|treasury|fixed income|income fund/i.test(name)) return { bonds: 1 };
  if (CA_STOCK.test(t)) return { ca: 1 };
  if (REAL_ESTATE.test(t) || /real estate|reit/i.test(name)) return { realestate: 1 };
  if (COMMOD.test(t) || /gold|silver|commodit/i.test(name)) return { other: 1 };
  if (/international|intl|developed|emerging|ex-us|world ex/i.test(name)) return { intl: 1 };
  if (/s&p|500|total (stock )?market|index|growth|value|nasdaq|dow|equity|stock/i.test(name) || ['equity', 'etf', 'mutual fund'].includes(type)) return { us: 1 };
  return { other: 1 };
}
const CLASS_LABEL = { us: 'US stocks', intl: 'International stocks', ca: 'Canadian stocks', bonds: 'Bonds', cash: 'Cash', crypto: 'Crypto', realestate: 'Real estate', other: 'Other' };

function feeFor(ticker) {
  const t = String(ticker || '').toUpperCase(); if (!t) return null;
  const ov = (getSetting('fee_overrides', {}) || {})[t];
  if (ov != null) return { pct: ov, source: 'you' };
  if (FEES[t] != null) return { pct: FEES[t], source: 'built-in' };
  return null;
}

function portfolio() {
  const accts = db.prepare("SELECT id, name, type, balance, institution, meta FROM accounts WHERE hidden=0 AND type IN ('investment','crypto') ORDER BY balance DESC").all();
  const holdings = [];
  for (const a of accts) {
    let meta = null; try { meta = JSON.parse(a.meta || 'null'); } catch {}
    const list = (meta && Array.isArray(meta.holdings) && meta.holdings.length) ? meta.holdings : null;
    if (list) {
      const sum = list.reduce((s, h) => s + (Number(h.value) || 0), 0);
      for (const h of list) holdings.push({ account: a.name, account_id: a.id, name: h.name || h.ticker || 'Holding', ticker: h.ticker || null, quantity: h.quantity ?? null, value: Number(h.value) || 0, cost: h.cost != null ? Number(h.cost) : null, type: h.type || null });
      // account balance not covered by listed holdings counts as cash
      if (a.balance - sum > 1) holdings.push({ account: a.name, account_id: a.id, name: 'Cash & other', ticker: null, value: round2(a.balance - sum), cost: null, type: 'cash' });
    } else {
      const crypto = a.type === 'crypto';
      holdings.push({ account: a.name, account_id: a.id, name: crypto ? (meta && meta.symbol ? `${meta.symbol} (${a.name})` : a.name) : `${a.name} (no holdings detail)`, ticker: crypto && meta && meta.symbol ? meta.symbol : null,
        value: a.balance, cost: null, type: crypto ? 'cryptocurrency' : null, crypto, unknown: !crypto });
    }
  }
  const total = holdings.reduce((s, h) => s + h.value, 0);
  const mix = {};
  let feeYear = 0, feeCovered = 0;
  for (const h of holdings) {
    const c = h.unknown ? { other: 1 } : classify(h);
    h.classes = Object.keys(c);
    for (const [k, f] of Object.entries(c)) mix[k] = (mix[k] || 0) + h.value * f;
    const fee = h.crypto || h.type === 'cash' ? null : feeFor(h.ticker);
    h.fee = fee ? fee.pct : null; h.feeSource = fee ? fee.source : null;
    h.feeYear = fee ? round2(h.value * fee.pct / 100) : null;
    if (fee) { feeYear += h.feeYear; feeCovered += h.value; }
    h.gain = h.cost != null && h.cost > 0 ? round2(h.value - h.cost) : null;
  }
  const allocation = Object.entries(mix).map(([k, v]) => ({ key: k, label: CLASS_LABEL[k], value: round2(v), pct: total ? round2(v / total * 100) : 0 })).sort((a, b) => b.value - a.value);
  const avgFee = feeCovered ? feeYear / feeCovered * 100 : null;
  // 30-year fee drag: same money at 7% growth, your average fee vs a 0.05% index fund
  let drag = null;
  if (avgFee != null && total > 0) {
    const grow = (fee) => total * Math.pow(1 + 0.07 - fee / 100, 30);
    drag = { years: 30, yours: round2(grow(avgFee)), cheap: round2(grow(Math.min(avgFee, CHEAP))), lost: round2(grow(Math.min(avgFee, CHEAP)) - grow(avgFee)) };
  }
  const withCost = holdings.filter(h => h.gain != null);
  const gains = withCost.length ? { value: round2(withCost.reduce((s, h) => s + h.value, 0)), cost: round2(withCost.reduce((s, h) => s + h.cost, 0)) } : null;
  if (gains) { gains.gain = round2(gains.value - gains.cost); gains.pct = gains.cost ? round2(gains.gain / gains.cost * 100) : null; }

  // dividends & interest received (last 12 months), by month
  const div = db.prepare("SELECT substr(date,1,7) m, ROUND(SUM(amount),2) v FROM transactions WHERE excluded=0 AND category='Interest & Dividends' AND amount>0 AND date>? GROUP BY m ORDER BY m").all(addDays(today(), -365));
  // value history of investment + crypto accounts
  const ids = accts.map(a => a.id);
  let history = [];
  if (ids.length) {
    const start = addDays(today(), -365);
    const rows = db.prepare(`SELECT account_id, date, balance FROM balance_history WHERE account_id IN (${ids.map(() => '?').join(',')}) AND date>=? ORDER BY date`).all(...ids, start);
    const last = {}; const byDate = {};
    rows.forEach(r => (byDate[r.date] ||= []).push(r));
    for (const d of Object.keys(byDate).sort()) { byDate[d].forEach(r => { last[r.account_id] = r.balance; }); history.push({ date: d, value: round2(Object.values(last).reduce((s, v) => s + v, 0)) }); }
    if (history.length > 120) { const step = Math.ceil(history.length / 120); history = history.filter((p, i) => i % step === 0 || i === history.length - 1); }
  }
  const change = history.length > 1 ? round2(history[history.length - 1].value - history[0].value) : null;
  const unknownFees = holdings.filter(h => h.ticker && h.fee == null && !h.crypto && h.type !== 'cash').map(h => h.ticker);
  return { total: round2(total), accounts: accts.map(a => ({ id: a.id, name: a.name, type: a.type, balance: a.balance, institution: a.institution })),
    holdings: holdings.sort((a, b) => b.value - a.value), allocation, fees: { yearly: round2(feeYear), avgPct: avgFee != null ? Math.round(avgFee * 1000) / 1000 : null, covered: round2(feeCovered), drag, unknown: [...new Set(unknownFees)] },
    gains, dividends: { months: div, total: round2(div.reduce((s, r) => s + r.v, 0)) }, history, change };
}

function setFee(ticker, pct) {
  const t = String(ticker || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 12);
  if (!t) throw Object.assign(new Error('Ticker required.'), { status: 400 });
  const cur = getSetting('fee_overrides', {}) || {};
  if (pct === '' || pct == null) delete cur[t];
  else { const v = Number(pct); if (!(v >= 0 && v <= 5)) throw Object.assign(new Error('Expense ratio must be between 0% and 5%.'), { status: 400 }); cur[t] = v; }
  setSetting('fee_overrides', cur);
}

module.exports = { portfolio, classify, setFee, FEES };
