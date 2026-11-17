// File imports: any bank CSV (with presets for the big US and Canadian banks), OFX/QFX/QBO
// statements, and exports from Mint, Monarch, YNAB, Copilot, Rocket Money, Empower and Quicken.
const crypto = require('crypto');

function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  text = text.replace(/^﻿/, '');
  const sample = text.split(/\r?\n/).slice(0, 15).join('\n');
  const count = ch => sample.split(ch).length - 1;
  const delim = [',', '\t', ';'].sort((a, b) => count(b) - count(a))[0] || ',';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(v => v.trim() !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur); if (row.some(v => v.trim() !== '')) rows.push(row);
  return rows;
}

const money = v => {
  if (v == null) return NaN;
  let s = String(v).trim(); if (!s) return NaN;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /^\$\s*-/.test(s) || /-$/.test(s);
  s = s.replace(/[^0-9.,]/g, '');
  if (!/\d/.test(s)) return NaN;
  if (/,\d{2}$/.test(s) && !/\.\d/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
  const n = parseFloat(s); return isNaN(n) ? NaN : neg ? -n : n;
};

function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) { let y = m[3]; if (y.length === 2) y = (Number(y) > 70 ? '19' : '20') + y; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (!/[a-z]{3}/i.test(s) || !/\d/.test(s)) return null;
  const d = new Date(s); if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return null;
}

// Each preset: test(headers) and how amounts are signed. Most specific first.
const PRESETS = [
  { id: 'rocketmoney', name: 'Rocket Money export', test: h => h.includes('custom name') && h.includes('ignored from'), sign: 'positive-is-expense',
    cols: { date: 'date', desc: 'name', merchant: 'custom name', amount: 'amount', category: 'category', account: 'account name', notes: 'note' } },
  { id: 'mint', name: 'Mint export', test: h => h.includes('transaction type') && h.includes('original description'), sign: 'type-column',
    cols: { date: 'date', desc: 'original description', merchant: 'description', amount: 'amount', type: 'transaction type', category: 'category', account: 'account name', notes: 'notes' } },
  { id: 'monarch', name: 'Monarch export', test: h => h.includes('original statement') && h.includes('merchant'), sign: 'signed',
    cols: { date: 'date', desc: 'original statement', merchant: 'merchant', amount: 'amount', category: 'category', account: 'account', notes: 'notes' } },
  { id: 'ynab', name: 'YNAB export', test: h => h.includes('outflow') && h.includes('inflow') && h.includes('payee'), sign: 'in-out',
    cols: { date: 'date', desc: 'payee', outflow: 'outflow', inflow: 'inflow', category: 'category', account: 'account', notes: 'memo' } },
  { id: 'copilot', name: 'Copilot export', test: h => h.includes('parent category') && h.includes('excluded'), sign: 'positive-is-expense',
    cols: { date: 'date', desc: 'name', amount: 'amount', category: 'category', account: 'account', notes: 'note', type: 'type' } },
  { id: 'empower', name: 'Empower / Personal Capital export', test: h => h.includes('tags') && h.includes('account') && h.includes('description') && h.includes('category') && !h.includes('merchant'), sign: 'signed',
    cols: { date: 'date', desc: 'description', amount: 'amount', category: 'category', account: 'account' } },
  // ---- bank exports ----
  { id: 'chase-card', name: 'Chase credit card CSV', test: h => h.includes('transaction date') && h.includes('post date') && h.includes('type') && h.includes('amount') && h.includes('memo'), sign: 'signed',
    cols: { date: 'transaction date', desc: 'description', amount: 'amount', category: 'category', notes: 'memo' } },
  { id: 'chase-bank', name: 'Chase checking / savings CSV', test: h => h.includes('details') && h.includes('posting date') && h.includes('check or slip #'), sign: 'signed',
    cols: { date: 'posting date', desc: 'description', amount: 'amount' } },
  { id: 'discover', name: 'Discover card CSV', test: h => h.includes('trans. date') && h.includes('post date') && h.includes('amount'), sign: 'positive-is-expense',
    cols: { date: 'trans. date', desc: 'description', amount: 'amount', category: 'category' } },
  { id: 'amex', name: 'American Express CSV', test: h => h.includes('card member') && h.includes('amount') && h.includes('date'), sign: 'positive-is-expense',
    cols: { date: 'date', desc: 'description', amount: 'amount', category: 'category' } },
  { id: 'bmo-ca-card', name: 'BMO Mastercard CSV', test: h => h.includes('item #') && h.includes('card #') && h.includes('transaction amount'), sign: 'positive-is-expense',
    cols: { date: 'transaction date', desc: 'description', amount: 'transaction amount' } },
  { id: 'bmo-ca-bank', name: 'BMO bank account CSV', test: h => h.includes('first bank card') && h.includes('transaction amount'), sign: 'signed',
    cols: { date: 'date posted', desc: 'description', amount: 'transaction amount' } },
  { id: 'rbc', name: 'RBC Royal Bank CSV', test: h => h.includes('description 1') && (h.includes('cad$') || h.includes('usd$')), sign: 'signed',
    cols: { date: 'transaction date', desc: 'description 1', desc2: 'description 2', amount: 'cad$', amount2: 'usd$' } },
  { id: 'capitalone-card', name: 'Capital One card CSV', test: h => h.includes('card no.') && h.includes('debit') && h.includes('credit'), sign: 'in-out',
    cols: { date: 'transaction date', desc: 'description', outflow: 'debit', inflow: 'credit', category: 'category' } },
];

// Banks whose plain "Date, Description, Amount" card files show purchases as positive numbers.
const POSITIVE_IS_EXPENSE_BANKS = new Set(['amex', 'discover']);

const pick = (h, names) => { for (const n of names) { const i = h.indexOf(n); if (i >= 0) return h[i]; } return null; };

function detect(headers) {
  const h = headers.map(x => x.trim().toLowerCase());
  for (const p of PRESETS) if (p.test(h)) return { ...p, headers: h };
  // generic bank CSV
  const cols = {
    date: pick(h, ['date', 'transaction date', 'trans. date', 'posted date', 'posting date', 'post date', 'trans date', 'date posted', 'booking date', 'value date']),
    desc: pick(h, ['description', 'payee', 'name', 'merchant', 'memo', 'details', 'transaction description', 'original description', 'transaction details', 'narrative']),
    amount: pick(h, ['amount', 'transaction amount', 'amount (usd)', 'amount (cad)', 'amt']),
    outflow: pick(h, ['debit', 'withdrawal', 'withdrawals', 'outflow', 'debit amount', 'money out', 'withdrawal amount']),
    inflow: pick(h, ['credit', 'deposit', 'deposits', 'inflow', 'credit amount', 'money in', 'deposit amount']),
    category: pick(h, ['category']), account: pick(h, ['account', 'account name']), notes: pick(h, ['notes', 'note', 'memo']),
    type: pick(h, ['transaction type', 'type', 'credit/debit']),
  };
  if (cols.notes === cols.desc) cols.notes = null;
  const sign = cols.amount ? (cols.type ? 'type-column' : 'signed') : 'in-out';
  return { id: 'generic', name: 'Bank CSV', cols, sign, headers: h };
}

// Files with no header row (Wells Fargo, TD Canada Trust, CIBC, Scotiabank): work out the columns from the data.
function headerless(rows) {
  const data = rows.filter(r => parseDate(r[0]));
  if (!data.length || data.length < rows.length * 0.6) return null;
  const n = Math.max(...data.map(r => r.length));
  const cell = (r, i) => (r[i] || '').trim();
  const moneyOrEmpty = i => data.every(r => !cell(r, i) || !isNaN(money(cell(r, i))));
  let desc = -1, bestLen = 0;
  for (let i = 1; i < n; i++) {
    const len = data.reduce((s, r) => s + (cell(r, i) && isNaN(money(cell(r, i))) ? cell(r, i).length : 0), 0);
    if (len > bestLen) { desc = i; bestLen = len; }
  }
  if (desc < 0) return null;
  // Wells Fargo / Scotiabank: date, signed amount, …, description
  if (desc > 1 && data.every(r => !isNaN(money(cell(r, 1))))) return { desc, amount: 1, data };
  // TD / CIBC: date, description, withdrawal, deposit[, balance]
  if (desc + 2 < n + 1 && moneyOrEmpty(desc + 1) && moneyOrEmpty(desc + 2)) return { desc, outflow: desc + 1, inflow: desc + 2, data };
  return null;
}

function fromCSV(text, opts = {}) {
  const rows = parseCSV(text);
  if (!rows.length) throw new Error('The file has no rows.');
  const out = [];
  const push = (date, amount, desc, extra = {}) => {
    if (opts.flip) amount = -amount;
    desc = (desc || '').replace(/^\[[A-Z]{2}\]\s*/, ''); // BMO prefixes descriptions with codes like [DN], [PR]
    out.push({ date, amount: Math.round(amount * 100) / 100, description: desc || 'Transaction', merchant: extra.merchant || null,
      category: extra.category || null, account: extra.account || null, notes: extra.notes || null });
  };

  // some banks put a few lines of summary above the header
  const hi = rows.findIndex(r => r.length >= 3 && !parseDate(r[0]) && r.some(c => /(^|\W)date(\W|$)/i.test(c.trim())));
  if (hi < 0) {
    const hl = headerless(rows);
    if (!hl) throw new Error('Could not find the date and amount columns in this CSV.');
    for (const r of hl.data) {
      let amount;
      if (hl.amount != null) amount = money(r[hl.amount]);
      else {
        const o = money(r[hl.outflow]), i = money(r[hl.inflow]);
        if (isNaN(o) && isNaN(i)) continue;
        amount = (isNaN(i) ? 0 : Math.abs(i)) - (isNaN(o) ? 0 : Math.abs(o));
      }
      if (isNaN(amount)) continue;
      if (opts.sign === 'positive-is-expense' && hl.amount != null) amount = -amount;
      push(parseDate(r[0]), amount, (r[hl.desc] || '').trim());
    }
    return { format: 'Bank CSV (no header row)', preset: 'headerless', rows: out, accounts: [] };
  }

  const preset = detect(rows[hi]);
  const idx = name => (name ? preset.headers.indexOf(name) : -1);
  const c = preset.cols;
  if (idx(c.date) < 0 || (idx(c.amount) < 0 && idx(c.outflow) < 0 && idx(c.inflow) < 0))
    throw new Error('Could not find the date and amount columns in this CSV.');
  let sign = preset.sign;
  if (preset.id === 'generic' && opts.sign === 'positive-is-expense' && sign === 'signed') sign = 'positive-is-expense';
  for (const r of rows.slice(hi + 1)) {
    const get = n => (idx(n) >= 0 ? (r[idx(n)] || '').trim() : '');
    const date = parseDate(get(c.date)); if (!date) continue;
    let amount;
    if (sign === 'in-out' || (idx(c.amount) < 0)) {
      const o = money(get(c.outflow)), i = money(get(c.inflow));
      if (isNaN(o) && isNaN(i)) continue;
      amount = (isNaN(i) ? 0 : Math.abs(i)) - (isNaN(o) ? 0 : Math.abs(o));
    } else {
      amount = money(get(c.amount));
      if (isNaN(amount) && c.amount2) amount = money(get(c.amount2));
      if (isNaN(amount)) continue;
      if (sign === 'positive-is-expense') {
        amount = -amount;
        if (preset.id === 'copilot' && /income/i.test(get(c.type))) amount = Math.abs(amount);
      } else if (sign === 'type-column') {
        const t = get(c.type).toLowerCase();
        if (/debit|withdraw|purchase|sale/.test(t)) amount = -Math.abs(amount);
        else if (/credit|deposit|refund/.test(t)) amount = Math.abs(amount);
      }
    }
    const desc = [get(c.desc), get(c.desc2)].filter(Boolean).join(' ') || get(c.merchant) || 'Transaction';
    push(date, amount, desc, { merchant: get(c.merchant), category: get(c.category), account: get(c.account), notes: get(c.notes) });
  }
  return { format: preset.name, preset: preset.id, rows: out, accounts: [...new Set(out.map(r => r.account).filter(Boolean))] };
}

function fromOFX(text) {
  const tag = (block, name) => { const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i')); return m ? m[1].trim() : null; };
  const acctId = tag(text, 'ACCTID'), org = tag(text, 'ORG');
  const isCC = /<CCACCTFROM>/i.test(text);
  const bal = (text.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]*)/i) || [])[1];
  const rows = [];
  for (const m of text.matchAll(/<STMTTRN>([\s\S]*?)(<\/STMTTRN>|(?=<STMTTRN>)|(?=<\/BANKTRANLIST>))/gi)) {
    const b = m[1];
    const amount = parseFloat(tag(b, 'TRNAMT')); if (isNaN(amount)) continue;
    rows.push({ date: parseDate(tag(b, 'DTPOSTED')), amount, external_id: tag(b, 'FITID'),
      description: [tag(b, 'NAME'), tag(b, 'MEMO')].filter(Boolean).join(' ').trim() || tag(b, 'TRNTYPE') || 'Transaction' });
  }
  const accountName = `${org || 'Bank'} ${isCC ? 'Card' : 'Account'}${acctId ? ' ••' + acctId.slice(-4) : ''}`;
  return { format: 'OFX/QFX statement', preset: 'ofx', rows: rows.map(r => ({ ...r, account: accountName })), accounts: [accountName],
    balance: bal != null ? parseFloat(bal) : null, accountType: isCC ? 'credit' : 'depository', institution: org };
}

function parseFile(filename, content, opts = {}) {
  const looksOFX = /\.(ofx|qfx|qbo)$/i.test(filename || '') || /<OFX>/i.test(content.slice(0, 4000));
  if (looksOFX) return fromOFX(content);
  if (opts.bank && POSITIVE_IS_EXPENSE_BANKS.has(opts.bank) && !opts.sign) opts = { ...opts, sign: 'positive-is-expense' };
  return fromCSV(content, opts);
}

// Stable id for de-duplicating re-imports of the same file.
function fingerprint(rows) {
  const seen = {};
  return rows.map(r => {
    if (r.external_id) return r;
    const base = `${r.date}|${r.amount}|${r.description}`;
    seen[base] = (seen[base] || 0) + 1;
    return { ...r, external_id: 'imp_' + crypto.createHash('sha1').update(`${base}|${seen[base]}`).digest('hex').slice(0, 20) };
  });
}

module.exports = { parseFile, fingerprint, parseCSV, parseDate, PRESETS };
