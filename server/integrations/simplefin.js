// SimpleFIN Bridge (https://beta-bridge.simplefin.org): a low-cost, user-owned bank feed
// that covers thousands of US banks. You paste a one-time Setup Token; we claim an Access URL.
const { db } = require('../db');
const { encrypt, decrypt } = require('../security');
const { upsertAccount, upsertTransactions } = require('../engine/ingest');
const { isoDate } = require('../util');

async function claim(setupToken) {
  let url;
  try { url = Buffer.from(setupToken.trim(), 'base64').toString('utf8'); } catch { throw new Error('That is not a SimpleFIN setup token.'); }
  if (!/^https:\/\//.test(url)) throw new Error('That is not a SimpleFIN setup token.');
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Length': '0' } });
  if (!res.ok) throw new Error(`SimpleFIN rejected the token (${res.status}). Tokens can only be used once — make a new one.`);
  const accessUrl = (await res.text()).trim();
  const info = db.prepare('INSERT INTO connections(provider,name,institution,secret_enc,created,status) VALUES(?,?,?,?,?,?)')
    .run('simplefin', 'SimpleFIN Bridge', 'SimpleFIN', encrypt({ access_url: accessUrl }), Date.now(), 'ok');
  const id = Number(info.lastInsertRowid);
  await sync(id, 90);
  return id;
}

function guessType(name, balance) {
  const n = (name || '').toLowerCase();
  if (/credit|card|visa|mastercard|amex|american express|discover|sapphire|freedom|quicksilver|venture/.test(n)) return 'credit';
  if (/mortgage|loan|heloc|auto|student/.test(n)) return 'loan';
  if (/invest|brokerage|401k|401\(k\)|ira\b|roth|hsa|529|stock|retire/.test(n)) return 'investment';
  if (/crypto|bitcoin|coinbase/.test(n)) return 'crypto';
  return balance < 0 ? 'credit' : 'depository';
}

async function sync(connectionId, days = 45) {
  const conn = db.prepare('SELECT * FROM connections WHERE id=?').get(connectionId);
  const { access_url } = decrypt(conn.secret_enc);
  const u = new URL(access_url);
  const auth = 'Basic ' + Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64');
  const base = `${u.protocol}//${u.host}${u.pathname.replace(/\/$/, '')}`;
  const start = Math.floor((Date.now() - days * 864e5) / 1000);
  const res = await fetch(`${base}/accounts?start-date=${start}&pending=1`, { headers: { Authorization: auth } });
  if (res.status === 403) throw new Error('SimpleFIN access was revoked — reconnect with a new setup token.');
  if (!res.ok) throw new Error(`SimpleFIN error ${res.status}`);
  const data = await res.json();
  let added = 0, updated = 0;
  for (const a of data.accounts || []) {
    const bal = parseFloat(a.balance);
    // keep any type the user set by hand
    const prev = db.prepare('SELECT type FROM accounts WHERE connection_id=? AND external_id=?').get(connectionId, a.id);
    const type = prev ? prev.type : guessType(a.name, bal);
    const liability = type === 'credit' || type === 'loan';
    const accountId = upsertAccount(connectionId, {
      external_id: a.id, name: a.name, type, currency: /^[A-Z]{3}$/.test(a.currency) ? a.currency : 'USD',
      balance: liability ? Math.abs(bal) : bal, available: a['available-balance'] != null ? parseFloat(a['available-balance']) : null,
      institution: (a.org && (a.org.name || a.org.domain)) || 'SimpleFIN',
    });
    const r = upsertTransactions(accountId, (a.transactions || []).map(t => ({
      external_id: t.id, date: isoDate(new Date((t.transacted_at || t.posted) * 1000)), amount: parseFloat(t.amount),
      description: t.description || t.payee || t.memo || 'Transaction', merchantName: t.payee || null, pending: !!t.pending,
    })));
    added += r.added; updated += r.updated;
  }
  const errs = (data.errors || []).join('; ');
  db.prepare('UPDATE connections SET error=? WHERE id=?').run(errs || null, connectionId);
  return { added, updated, accounts: (data.accounts || []).length, warnings: errs };
}

module.exports = { claim, sync };
