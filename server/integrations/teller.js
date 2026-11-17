// Teller (https://teller.io): direct connections to the big US banks and card issuers
// (Chase, Bank of America, Wells Fargo, Citi, Capital One, US Bank, Amex and more).
// Free "development" environment allows 100 real connections — enough for personal use.
// Live requests need the app's mTLS client certificate; sandbox needs none.
const https = require('https');
const http = require('http');
const { db, getSetting, setSetting } = require('../db');
const { encrypt, decrypt } = require('../security');
const { upsertAccount, upsertTransactions } = require('../engine/ingest');
const { addDays, today } = require('../util');

const BASE = process.env.PP_TELLER_BASE || 'https://api.teller.io';
const ENVS = ['sandbox', 'development', 'production'];

function cfg() {
  const c = getSetting('teller', {}) || {};
  let cert = null, key = null;
  try { if (c.tls_enc) ({ cert, key } = decrypt(c.tls_enc)); } catch { /* key file changed */ }
  return { application_id: c.application_id || '', env: ENVS.includes(c.env) ? c.env : 'sandbox', cert, key };
}
const configured = () => !!cfg().application_id;
const status = () => { const c = cfg(); return { configured: !!c.application_id, application_id: c.application_id, env: c.env, has_cert: !!(c.cert && c.key) }; };

function save({ application_id, env, cert, key, clear_cert }) {
  const cur = getSetting('teller', {}) || {};
  const next = { ...cur };
  if (application_id != null) next.application_id = String(application_id).trim();
  if (env && ENVS.includes(env)) next.env = env;
  if (clear_cert) delete next.tls_enc;
  if (cert || key) {
    if (!/-----BEGIN CERTIFICATE-----/.test(cert || '')) throw Object.assign(new Error('certificate.pem does not look like a certificate.'), { status: 400 });
    if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(key || '')) throw Object.assign(new Error('private_key.pem does not look like a private key.'), { status: 400 });
    next.tls_enc = encrypt({ cert, key });
  }
  setSetting('teller', next);
}

function request(path, token, method = 'GET') {
  const c = cfg();
  const u = new URL(path, BASE);
  const lib = u.protocol === 'http:' ? http : https;
  const opts = { method, headers: { Authorization: 'Basic ' + Buffer.from(token + ':').toString('base64'), Accept: 'application/json' }, timeout: 30000 };
  if (c.cert && c.key && u.protocol === 'https:') { opts.cert = c.cert; opts.key = c.key; }
  return new Promise((resolve, reject) => {
    const req = lib.request(u, opts, res => {
      let body = ''; res.on('data', d => (body += d)); res.on('end', () => {
        let json = null; try { json = body ? JSON.parse(body) : null; } catch { /* not json */ }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json);
        const err = (json && json.error) || {};
        const e = new Error(err.message || `Teller error ${res.statusCode}`);
        e.status = res.statusCode; e.code = err.code || null;
        if (/^enrollment\.disconnected/.test(e.code || '')) { e.code = 'TELLER_RECONNECT'; e.message = 'Bank login expired — click Reconnect.'; }
        else if (res.statusCode === 401 || res.statusCode === 403) {
          if (!c.cert) e.message = 'Teller needs your certificate for real banks (Settings → Teller).';
        }
        reject(e);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Teller did not answer in time')));
    req.on('error', reject);
    req.end();
  });
}

async function enroll({ accessToken, enrollment }) {
  if (!accessToken) throw Object.assign(new Error('Missing access token from Teller Connect.'), { status: 400 });
  const name = (enrollment && enrollment.institution && enrollment.institution.name) || 'Bank';
  const enrollmentId = (enrollment && enrollment.id) || null;
  // re-linking the same bank replaces the old token instead of duplicating accounts
  const existing = enrollmentId && db.prepare("SELECT id, secret_enc FROM connections WHERE provider='teller'").all()
    .find(c => { try { return decrypt(c.secret_enc).enrollment_id === enrollmentId; } catch { return false; } });
  let id;
  if (existing) {
    db.prepare("UPDATE connections SET secret_enc=?, status='ok', error=NULL WHERE id=?").run(encrypt({ access_token: accessToken, enrollment_id: enrollmentId }), existing.id);
    id = existing.id;
  } else {
    id = Number(db.prepare('INSERT INTO connections(provider,name,institution,secret_enc,created,status) VALUES(?,?,?,?,?,?)')
      .run('teller', name, name, encrypt({ access_token: accessToken, enrollment_id: enrollmentId }), Date.now(), 'ok').lastInsertRowid);
  }
  await sync(id, 730);
  return id;
}

// Teller category -> the Plaid-style category codes the categorizer already understands
const CAT = {
  accommodation: ['TRAVEL'], bar: ['FOOD_AND_DRINK'], dining: ['FOOD_AND_DRINK'], groceries: ['FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES'],
  fuel: ['TRANSPORTATION', 'TRANSPORTATION_GAS'], transport: ['TRANSPORTATION'], transportation: ['TRANSPORTATION'],
  utilities: ['RENT_AND_UTILITIES'], phone: ['RENT_AND_UTILITIES'], health: ['MEDICAL'], entertainment: ['ENTERTAINMENT'], sport: ['ENTERTAINMENT'],
  shopping: ['GENERAL_MERCHANDISE'], clothing: ['GENERAL_MERCHANDISE'], electronics: ['GENERAL_MERCHANDISE'], home: ['HOME_IMPROVEMENT'],
  income: ['INCOME'], loan: ['LOAN_PAYMENTS'], charity: ['GOVERNMENT_AND_NON_PROFIT'],
  service: ['GENERAL_SERVICES'], software: ['GENERAL_SERVICES'], insurance: ['GENERAL_SERVICES'], education: ['GENERAL_SERVICES'],
};

async function allTransactions(accountId, token, since) {
  const out = []; let fromId = null;
  for (let page = 0; page < 40; page++) {
    const q = new URLSearchParams({ count: '250', start_date: since });
    if (fromId) q.set('from_id', fromId);
    const list = await request(`/accounts/${accountId}/transactions?${q}`, token);
    if (!Array.isArray(list) || !list.length) break;
    out.push(...list);
    if (list.length < 250 || list[list.length - 1].date < since) break;
    fromId = list[list.length - 1].id;
  }
  return out.filter(t => t.date >= since);
}

async function sync(connectionId, days) {
  const conn = db.prepare('SELECT * FROM connections WHERE id=?').get(connectionId);
  const { access_token } = decrypt(conn.secret_enc);
  const since = addDays(today(), -(days || (conn.last_sync ? 60 : 730)));
  const accounts = await request('/accounts', access_token);
  let added = 0, updated = 0; const warnings = [];
  for (const a of accounts || []) {
    if (a.status === 'closed') continue;
    const credit = a.type === 'credit';
    let bal = {};
    try { if (!a.links || a.links.balances) bal = await request(`/accounts/${a.id}/balances`, access_token) || {}; } catch (e) { warnings.push(`${a.name}: ${e.message}`); }
    const num = v => (v == null || v === '' ? null : parseFloat(v));
    const ledger = num(bal.ledger), available = num(bal.available);
    const balance = credit ? Math.abs(ledger ?? 0) : (ledger ?? available ?? 0);
    const accountId = upsertAccount(connectionId, {
      external_id: a.id, name: a.name, mask: a.last_four || null, type: credit ? 'credit' : 'depository', subtype: a.subtype || null,
      currency: a.currency || 'USD', balance, available: credit ? null : available,
      credit_limit: credit && available != null && ledger != null ? Math.round((available + Math.abs(ledger)) * 100) / 100 : null,
      institution: (a.institution && a.institution.name) || conn.institution,
    });
    if (a.links && !a.links.transactions) continue;
    let txs = [];
    try { txs = await allTransactions(a.id, access_token, since); } catch (e) { warnings.push(`${a.name}: ${e.message}`); continue; }
    // Card feeds can report purchases as positive; normalise to "negative = money out".
    let flip = false;
    if (credit) {
      const spend = txs.filter(t => t.type !== 'payment' && !/payment|thank you|autopay/i.test(t.description || ''));
      flip = spend.length > 0 && spend.filter(t => parseFloat(t.amount) > 0).length > spend.length / 2;
    }
    const r = upsertTransactions(accountId, txs.map(t => {
      const amt = parseFloat(t.amount) || 0;
      const d = t.details || {}, cat = CAT[d.category];
      return {
        external_id: t.id, date: t.date, amount: flip ? -amt : amt, description: t.description || (d.counterparty && d.counterparty.name) || 'Transaction',
        merchantName: (d.counterparty && d.counterparty.type !== 'person' && d.counterparty.name) || null, pending: t.status === 'pending',
        pfc: cat ? { primary: cat[0], detailed: cat[1] || null } : null,
      };
    }));
    added += r.added; updated += r.updated;
  }
  return { added, updated, accounts: (accounts || []).length, warnings: warnings.join('; ') || null };
}

async function remove(connectionId) {
  const conn = db.prepare('SELECT secret_enc FROM connections WHERE id=?').get(connectionId);
  try { await request('/accounts', decrypt(conn.secret_enc).access_token, 'DELETE'); } catch { /* already revoked */ }
}

function enrollmentOf(connectionId) {
  const conn = db.prepare("SELECT secret_enc FROM connections WHERE id=? AND provider='teller'").get(connectionId);
  if (!conn) throw Object.assign(new Error('Connection not found'), { status: 404 });
  return decrypt(conn.secret_enc).enrollment_id;
}

module.exports = { configured, status, save, enroll, sync, remove, enrollmentOf, cfg };
