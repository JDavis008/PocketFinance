// PocketFinance server: JSON API + static web app.
const path = require('path');
const express = require('express');
const { db, tx, getSetting, setSetting, DATA_DIR } = require('./db');
const sec = require('./security');
const plaid = require('./integrations/plaid');
const simplefin = require('./integrations/simplefin');
const cryptoInt = require('./integrations/crypto');
const teller = require('./integrations/teller');
const importers = require('./integrations/importers');
const { upsertAccount, upsertTransactions, snapshot } = require('./engine/ingest');
const { categorize, invalidateRules, recategorizeAll, merchantKey, ruleMatch } = require('./engine/categorize');
const recurring = require('./engine/recurring');
const insights = require('./engine/insights');
const alerts = require('./engine/alerts');
const { lookup, NEGOTIABLE } = require('./engine/cancel-directory');
const sync = require('./sync');
const reports = require('./engine/reports');
const plans = require('./engine/plans');
const attach = require('./attachments');
const invest = require('./engine/invest');
const watch = require('./engine/watch');
const homes = require('./integrations/homes');
const cancel = require('./engine/cancel');
const demo = require('./demo');
const ious = require('./ious');
const family = require('./family');
const restore = require('./restore');
const autobackup = require('./autobackup');
const emailauth = require('./emailauth');
const { today, addDays, monthOf, round2 } = require('./util');

// ROOT holds public/, node_modules/ (vendor files) and dist/ (the APK). The packaged exe points it at its install folder.
const ROOT = process.env.PP_ROOT || path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 48140);
const HOST = process.env.HOST || getSetting('bind_host', '127.0.0.1') || '127.0.0.1';
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '25mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdn.plaid.com https://cdn.teller.io; frame-src https://cdn.plaid.com https://*.plaid.com https://teller.io https://*.teller.io; connect-src 'self' https://*.plaid.com https://*.teller.io; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'");
  next();
});

// Promise.resolve().then() so errors thrown synchronously also come back as JSON (not Express's HTML stack page)
const wrap = fn => (req, res) => Promise.resolve().then(() => fn(req, res)).then(r => { if (!res.headersSent) res.json(r ?? { ok: true }); })
  .catch(e => { console.error(req.method, req.path, e); res.status(e.status || 400).json({ error: e.message, code: e.code }); });
const bad = msg => Object.assign(new Error(msg), { status: 400 });
const ip = req => req.socket.remoteAddress || '';

// ---------- auth ----------
// Lets the phone app find this server on the Wi-Fi (readable cross-origin; says nothing about the data).
app.get('/api/hello', (req, res) => { res.set('Access-Control-Allow-Origin', '*'); res.json({ app: 'PocketFinance', id: sec.installId() }); });
app.get('/api/auth/status', (req, res) => { const u = sec.sessionUser(req); res.json({ setup: sec.isSetUp(), authed: !!u, user: u ? { name: u.name, role: u.role } : null }); });
app.post('/api/auth/setup', wrap((req, res) => {
  if (sec.isSetUp()) throw bad('Already set up.');
  const pw = String(req.body.password || '');
  if (pw.length < 8) throw bad('Use at least 8 characters.');
  if (req.body.email) emailauth.setOwnerEmail(req.body.email); // optional: for a forgotten password
  sec.setPassword(pw); sec.createSession(res);
}));
app.post('/api/auth/login', wrap((req, res) => {
  if (sec.throttled(ip(req))) throw bad('Too many attempts. Wait 5 minutes.');
  const who = sec.checkLogin(String(req.body.password || ''));
  if (!who) { sec.noteFail(ip(req)); throw Object.assign(new Error('Wrong password.'), { status: 401 }); }
  sec.clearFails(ip(req)); sec.createSession(res, who.memberId);
}));
app.post('/api/auth/logout', wrap((req, res) => { sec.forgetDeviceToken(req.body.device_token); sec.destroySession(req, res); }));
// "Forgot password" and email sign-in: a 6-digit code goes to the address on the account
app.post('/api/auth/email-code', wrap(async req => {
  if (sec.throttled(ip(req))) throw bad('Too many attempts. Wait 5 minutes.');
  return emailauth.requestCode(req.body.email, req.body.purpose);
}));
app.post('/api/auth/email-login', wrap((req, res) => {
  if (sec.throttled(ip(req))) throw bad('Too many attempts. Wait 5 minutes.');
  try { const r = emailauth.useCode(res, req.body.email, req.body.code, req.body.password); sec.clearFails(ip(req)); return r; }
  catch (e) { if (e.status === 401) sec.noteFail(ip(req)); throw e; }
}));
// the phone app signs itself in with the device key it got after your last password sign-in
app.post('/api/auth/device-login', wrap((req, res) => {
  if (sec.throttled(ip(req))) throw bad('Too many attempts. Wait 5 minutes.');
  if (!sec.deviceLogin(res, req.body.token)) { sec.noteFail(ip(req)); throw Object.assign(new Error('This phone needs to sign in again.'), { status: 401 }); }
}));

// read-only bills calendar feed (token in URL so calendar apps can subscribe)
app.get('/cal/:token/bills.ics', (req, res) => {
  if (req.params.token !== sec.calendarToken()) return res.status(404).end();
  res.type('text/calendar').send(ics());
});

app.use('/api', sec.requireAuth);
// remember this phone (called by the PocketFinance app right after a password sign-in)
app.post('/api/auth/device', wrap(req => sec.rememberDevice(req.user, req.body.name)));
// email used for sign-in codes (owner) + the owner's outgoing mail account (SMTP)
app.get('/api/settings/email', sec.ownerOnly, wrap(() => emailauth.smtpStatus()));
app.put('/api/settings/email', sec.ownerOnly, wrap(req => {
  if (req.body.owner_email !== undefined) emailauth.setOwnerEmail(req.body.owner_email);
  if (req.body.smtp) emailauth.saveSmtp(req.body.smtp);
  return emailauth.smtpStatus();
}));
app.post('/api/settings/email/test', sec.ownerOnly, wrap(async () => {
  const to = emailauth.ownerEmail(); if (!to) throw bad('Add your email address first.');
  await emailauth.sendMail(to, 'PocketFinance email works', "This is a test from PocketFinance. Sign-in codes and \"Forgot password\" will come from this address.\n\n— PocketFinance");
  return { sent: to };
}));
app.get('/api/devices', sec.ownerOnly, wrap(() => ({ devices: sec.listDevices() })));
app.delete('/api/devices/:id', sec.ownerOnly, wrap(req => { sec.removeDevice(Number(req.params.id)); }));

app.post('/api/auth/password', sec.ownerOnly, wrap((req, res) => {
  if (!sec.checkPassword(String(req.body.current || ''), getSetting('auth_hash'))) throw bad('Current password is wrong.');
  if (String(req.body.password || '').length < 8) throw bad('Use at least 8 characters.');
  sec.setPassword(req.body.password); sec.destroyAllSessions(); sec.createSession(res);
}));

// ---------- dashboard / reports ----------
app.get('/api/dashboard', wrap(() => ({ ...insights.dashboard(), review: db.prepare('SELECT COUNT(*) n FROM transactions WHERE reviewed=0').get().n, ious: db.prepare("SELECT ROUND(COALESCE(SUM(CASE WHEN direction='owed_me' THEN amount END),0),2) owed_me, ROUND(COALESCE(SUM(CASE WHEN direction='i_owe' THEN amount END),0),2) i_owe, COUNT(*) n FROM ious WHERE settled_at IS NULL").get() })));
app.get('/api/report', wrap(req => insights.report(req.query.month || monthOf(today()))));
app.get('/api/networth', wrap(req => ({ summary: insights.accountsSummary(), history: insights.netWorthHistory(Number(req.query.days) || 365) })));
app.get('/api/forecast', wrap(req => insights.forecast(Number(req.query.days) || 30)));

// ---------- accounts & connections ----------
const parseMeta = a => { try { return { ...a, meta: JSON.parse(a.meta || 'null') }; } catch { return { ...a, meta: null }; } };
app.get('/api/accounts', wrap(() => ({
  accounts: db.prepare(`SELECT a.*, c.provider, c.status conn_status, c.error conn_error, c.last_sync FROM accounts a LEFT JOIN connections c ON c.id=a.connection_id ORDER BY a.type, a.name`).all().map(parseMeta),
  connections: db.prepare('SELECT id, provider, name, institution, status, error, last_sync, created FROM connections ORDER BY created').all(),
  summary: insights.accountsSummary(),
})));
app.get('/api/accounts/:id/history', wrap(req => db.prepare('SELECT date, balance FROM balance_history WHERE account_id=? AND date>=? ORDER BY date').all(req.params.id, addDays(today(), -Number(req.query.days || 365)))));
app.post('/api/accounts', wrap(req => {
  const b = req.body;
  if (!b.name) throw bad('Name is required.');
  const id = upsertAccount(null, { external_id: 'manual-' + Date.now(), name: b.name, type: b.type || 'other', balance: Number(b.balance) || 0,
    credit_limit: b.credit_limit ? Number(b.credit_limit) : null, institution: b.institution || 'Manual', manual: true });
  return { id };
}));
app.patch('/api/accounts/:id', wrap(req => {
  const a = db.prepare('SELECT * FROM accounts WHERE id=?').get(req.params.id); if (!a) throw bad('Not found');
  const b = req.body;
  const f = { name: b.name ?? a.name, type: b.type ?? a.type, hidden: b.hidden != null ? (b.hidden ? 1 : 0) : a.hidden,
    include_net_worth: b.include_net_worth != null ? (b.include_net_worth ? 1 : 0) : a.include_net_worth, credit_limit: b.credit_limit ?? a.credit_limit };
  db.prepare('UPDATE accounts SET name=?, type=?, hidden=?, include_net_worth=?, credit_limit=? WHERE id=?').run(f.name, f.type, f.hidden, f.include_net_worth, f.credit_limit, a.id);
  if (b.balance != null && (a.manual || a.connection_id == null || b.force)) {
    db.prepare('UPDATE accounts SET balance=?, updated=? WHERE id=?').run(Number(b.balance), Date.now(), a.id); snapshot(a.id, Number(b.balance));
  }
}));
app.delete('/api/accounts/:id', wrap(req => { db.prepare('DELETE FROM accounts WHERE id=?').run(req.params.id); }));
app.post('/api/connections/:id/sync', wrap(async req => { const r = await sync.syncConnection(Number(req.params.id)); sync.afterSync(); return r; }));
app.delete('/api/connections/:id', wrap(async req => {
  const c = db.prepare('SELECT * FROM connections WHERE id=?').get(req.params.id); if (!c) throw bad('Not found');
  if (c.provider === 'plaid') await plaid.remove(c.id);
  if (c.provider === 'teller') await teller.remove(c.id);
  if (c.provider === 'demo') return demo.clear();
  db.prepare('DELETE FROM connections WHERE id=?').run(c.id);
}));
app.post('/api/sync', wrap(() => sync.syncAll()));

// Plaid
app.get('/api/plaid/status', wrap(() => { const c = getSetting('plaid', {}) || {}; return { configured: plaid.configured(), env: c.env || 'sandbox' }; }));
app.post('/api/plaid/link-token', wrap(async req => ({ link_token: await plaid.createLinkToken(req.body.connectionId) })));
app.post('/api/plaid/exchange', wrap(async req => { const id = await plaid.exchange(req.body.public_token, req.body.institution); sync.afterSync(); return { id }; }));
app.post('/api/plaid/reconnected', wrap(async req => { db.prepare("UPDATE connections SET status='ok', error=NULL WHERE id=?").run(req.body.connectionId); return sync.syncConnection(req.body.connectionId); }));
app.post('/api/plaid/sandbox', wrap(async () => { const id = await plaid.sandboxItem(); sync.afterSync(); return { id }; }));
// Teller
app.get('/api/teller/status', wrap(() => teller.status()));
app.put('/api/teller/settings', sec.ownerOnly, wrap(req => { teller.save(req.body || {}); return teller.status(); }));
app.post('/api/teller/enroll', wrap(async req => { const id = await teller.enroll(req.body || {}); sync.afterSync(); return { id }; }));
app.get('/api/teller/enrollment/:id', wrap(req => ({ enrollmentId: teller.enrollmentOf(Number(req.params.id)) })));
app.post('/api/teller/reconnected', wrap(async req => { db.prepare("UPDATE connections SET status='ok', error=NULL WHERE id=?").run(req.body.connectionId); const r = await sync.syncConnection(req.body.connectionId); sync.afterSync(); return r; }));
// SimpleFIN
app.post('/api/simplefin/connect', wrap(async req => { const id = await simplefin.claim(String(req.body.token || '')); sync.afterSync(); return { id }; }));
// Crypto
app.post('/api/crypto', wrap(async req => { const id = await cryptoInt.add(req.body); return { id }; }));
app.get('/api/crypto/coins', wrap(() => Object.keys(cryptoInt.COINS)));

// File import
app.post('/api/import/preview', wrap(req => {
  const p = importers.parseFile(req.body.filename, String(req.body.content || ''), { flip: !!req.body.flip, bank: req.body.bank || null });
  return { format: p.format, preset: p.preset, count: p.rows.length, accounts: p.accounts, sample: p.rows.slice(0, 15),
    from: p.rows.reduce((m, r) => (!m || r.date < m ? r.date : m), null), to: p.rows.reduce((m, r) => (!m || r.date > m ? r.date : m), null),
    balance: p.balance ?? null, accountType: p.accountType || null };
}));
app.post('/api/import/commit', wrap(req => {
  const b = req.body;
  const p = importers.parseFile(b.filename, String(b.content || ''), { flip: !!b.flip, bank: b.bank || null });
  const rows = importers.fingerprint(p.rows);
  let fileConn = db.prepare("SELECT id FROM connections WHERE provider='file'").get();
  if (!fileConn) fileConn = { id: Number(db.prepare("INSERT INTO connections(provider,name,institution,created,status) VALUES('file','File imports','Imported',?,'ok')").run(Date.now()).lastInsertRowid) };
  const knownCats = new Set(db.prepare('SELECT name FROM categories').all().map(c => c.name));
  const groups = {};
  for (const r of rows) {
    let target = b.accountId ? Number(b.accountId) : null;
    if (!target) {
      const name = r.account || b.newAccountName || 'Imported account';
      groups[name] ||= upsertAccount(fileConn.id, { external_id: 'file:' + name.toLowerCase(), name, type: b.accountType || p.accountType || 'depository', institution: p.institution || 'Imported' });
      target = groups[name];
    }
    (groups['#' + target] ||= { id: target, list: [] }).list.push({ ...r, category: b.keepCategories && knownCats.has(r.category) ? r.category : null });
  }
  let added = 0, updated = 0;
  for (const g of Object.values(groups)) if (g && g.list) { const r = upsertTransactions(g.id, g.list); added += r.added; updated += r.updated; }
  if (p.balance != null && !b.accountId) for (const v of Object.values(groups)) if (typeof v === 'number') {
    const bal = (b.accountType || p.accountType) === 'credit' ? Math.abs(p.balance) : p.balance;
    db.prepare('UPDATE accounts SET balance=? WHERE id=?').run(bal, v); snapshot(v, bal);
  }
  sync.afterSync();
  return { added, updated };
}));

// ---------- transactions ----------
app.get('/api/transactions', wrap(req => {
  const q = req.query, where = ['1=1'], args = [];
  if (q.q) { where.push('(t.merchant LIKE ? OR t.description LIKE ? OR t.notes LIKE ? OR CAST(ABS(t.amount) AS TEXT) LIKE ?)'); const s = `%${q.q}%`; args.push(s, s, s, s); }
  if (q.category) { where.push('t.category=?'); args.push(q.category); }
  if (q.account) { where.push('t.account_id=?'); args.push(q.account); }
  if (q.from) { where.push('t.date>=?'); args.push(q.from); }
  if (q.to) { where.push('t.date<=?'); args.push(q.to); }
  if (q.merchant_key) { where.push('t.merchant_key=?'); args.push(q.merchant_key); }
  if (q.recurring) { where.push('t.recurring_id=?'); args.push(q.recurring); }
  if (q.type === 'expense') where.push('t.amount<0'); if (q.type === 'income') where.push('t.amount>0');
  if (q.uncategorized) where.push("t.category='Uncategorized'");
  if (q.tax) where.push('t.tax_deductible=1');
  if (q.tag) { where.push('t.tags LIKE ?'); args.push(`%,${q.tag},%`); }
  if (q.review) where.push('t.reviewed=0');
  const W = where.join(' AND ');
  const limit = Math.min(Number(q.limit) || 100, 1000), offset = Number(q.offset) || 0;
  return {
    rows: db.prepare(`SELECT t.*, a.name account_name, a.mask account_mask, c.icon, c.color, (SELECT COUNT(*) FROM attachments x WHERE x.tx_id=t.id) att FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN categories c ON c.name=t.category WHERE ${W} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset),
    total: db.prepare(`SELECT COUNT(*) n, ROUND(SUM(CASE WHEN t.amount<0 THEN -t.amount ELSE 0 END),2) out, ROUND(SUM(CASE WHEN t.amount>0 THEN t.amount ELSE 0 END),2) inc FROM transactions t WHERE ${W}`).get(...args),
  };
}));
app.get('/api/transactions/:id', wrap(req => {
  const t = db.prepare('SELECT t.*, a.name account_name, c.icon, c.color FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN categories c ON c.name=t.category WHERE t.id=?').get(req.params.id);
  if (!t) throw bad('Not found'); return { ...t, ious: ious.forTx(t.id) };
}));
app.post('/api/transactions', wrap(req => {
  const b = req.body;
  if (!b.account_id || !b.date || b.amount == null) throw bad('Account, date and amount are required.');
  return upsertTransactions(Number(b.account_id), [{ external_id: 'manual-' + Date.now(), date: b.date, amount: Number(b.amount), description: b.description || 'Manual transaction', category: b.category || null, notes: b.notes || null }]);
}));
app.patch('/api/transactions/:id', wrap(req => {
  const t = db.prepare('SELECT * FROM transactions WHERE id=?').get(req.params.id); if (!t) throw bad('Not found');
  const b = req.body;
  const merchant = b.merchant ?? t.merchant;
  db.prepare('UPDATE transactions SET category=?, merchant=?, merchant_key=?, notes=?, excluded=?, tax_deductible=?, tags=?, reviewed=?, user_category=CASE WHEN ? THEN 1 ELSE user_category END WHERE id=?').run(
    b.category ?? t.category, merchant, merchantKey(merchant), b.notes ?? t.notes, b.excluded != null ? (b.excluded ? 1 : 0) : t.excluded,
    b.tax_deductible != null ? (b.tax_deductible ? 1 : 0) : t.tax_deductible, b.tags !== undefined ? reports.normTags(b.tags) : t.tags,
    b.reviewed != null ? (b.reviewed ? 1 : 0) : t.reviewed, b.category != null || b.merchant != null || b.excluded != null ? 1 : 0, t.id);
  let applied = 0;
  if (b.applyToAll) {
    // remember it as a rule and apply to other transactions from this merchant
    db.prepare('INSERT INTO rules(match_field,match_type,pattern,set_category,set_merchant,set_excluded,created) VALUES(?,?,?,?,?,?,?)')
      .run('merchant', 'equals', t.merchant, b.category ?? null, b.merchant && b.merchant !== t.merchant ? b.merchant : null, b.excluded != null ? (b.excluded ? 1 : 0) : null, Date.now());
    invalidateRules();
    applied = db.prepare('UPDATE transactions SET category=COALESCE(?,category), merchant=COALESCE(?,merchant), merchant_key=COALESCE(?,merchant_key), excluded=COALESCE(?,excluded) WHERE merchant_key=? AND id!=?')
      .run(b.category ?? null, b.merchant ?? null, b.merchant ? merchantKey(b.merchant) : null, b.excluded != null ? (b.excluded ? 1 : 0) : null, t.merchant_key, t.id).changes;
  }
  if (b.category || b.excluded != null) recurring.detect();
  return { applied };
}));
// review inbox: mark some (ids) or everything reviewed
app.post('/api/transactions/review', wrap(req => {
  const b = req.body || {};
  if (b.all) return { changed: db.prepare('UPDATE transactions SET reviewed=1 WHERE reviewed=0').run().changes };
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isInteger).slice(0, 5000);
  const st = db.prepare('UPDATE transactions SET reviewed=? WHERE id=?');
  let changed = 0; tx(() => ids.forEach(id => { changed += st.run(b.reviewed === false ? 0 : 1, id).changes; }));
  return { changed };
}));
app.get('/api/tags', wrap(() => reports.allTags()));
// split one transaction into several categories
app.post('/api/transactions/:id/split', wrap(req => {
  const t = db.prepare('SELECT * FROM transactions WHERE id=?').get(req.params.id); if (!t) throw bad('Not found');
  const parts = (req.body.parts || []).map(p => ({ amount: Number(p.amount), category: p.category })).filter(p => p.amount);
  const total = round2(parts.reduce((s, p) => s + p.amount, 0));
  if (parts.length < 2 || Math.abs(total - Math.abs(t.amount)) > 0.01) throw bad(`Parts must add up to ${Math.abs(t.amount).toFixed(2)}.`);
  const sign = t.amount < 0 ? -1 : 1;
  tx(() => {
    db.prepare('UPDATE transactions SET amount=?, category=?, user_category=1 WHERE id=?').run(sign * parts[0].amount, parts[0].category, t.id);
    parts.slice(1).forEach((p, i) => db.prepare(`INSERT INTO transactions(account_id,external_id,date,amount,description,merchant,merchant_key,category,pending,notes,excluded,user_category,created,tags,reviewed)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?,1)`).run(t.account_id, `${t.external_id}:split${i + 1}`, t.date, sign * p.amount, t.description, t.merchant, t.merchant_key, p.category, t.pending, 'Split', t.excluded, Date.now(), t.tags));
  });
}));
app.delete('/api/transactions/:id', wrap(req => {
  const files = db.prepare('SELECT file FROM attachments WHERE tx_id=?').all(req.params.id);
  db.prepare('DELETE FROM transactions WHERE id=?').run(req.params.id);
  files.forEach(f => attach.removeFile(f.file));
}));

// ---------- receipts / attachments ----------
app.get('/api/transactions/:id/attachments', wrap(req => db.prepare('SELECT id, filename, mime, size, created FROM attachments WHERE tx_id=? ORDER BY id').all(req.params.id)));
app.post('/api/transactions/:id/attachments', wrap(req => attach.add(Number(req.params.id), req.body || {})));
app.get('/api/attachments/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id=?').get(req.params.id);
  const p = a && attach.pathOf(a.file);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox allow-downloads");
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.type(a.mime).setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${a.filename.replace(/[^\w.\- ]/g, '_')}"`);
  res.sendFile(p);
});
app.delete('/api/attachments/:id', wrap(req => attach.remove(Number(req.params.id))));

// ---------- categories & rules ----------
app.get('/api/categories', wrap(() => db.prepare('SELECT * FROM categories ORDER BY kind DESC, grp, name').all()));
app.post('/api/categories', wrap(req => {
  const b = req.body; if (!b.name) throw bad('Name required');
  db.prepare('INSERT OR REPLACE INTO categories(name,grp,icon,color,kind) VALUES(?,?,?,?,?)').run(b.name, b.grp || 'Other', b.icon || '🏷️', b.color || '#64748b', b.kind || 'expense');
}));
app.delete('/api/categories/:name', wrap(req => {
  const n = req.params.name; if (n === 'Uncategorized') throw bad('Cannot delete Uncategorized');
  tx(() => { db.prepare("UPDATE transactions SET category='Uncategorized' WHERE category=?").run(n); db.prepare('DELETE FROM budgets WHERE category=?').run(n); db.prepare('DELETE FROM categories WHERE name=?').run(n); });
}));
app.get('/api/rules', wrap(() => db.prepare('SELECT * FROM rules ORDER BY id DESC').all()));
app.post('/api/rules', wrap(req => {
  const b = req.body; if (!b.pattern) throw bad('Pattern required');
  if (b.match_type === 'regex') { try { new RegExp(b.pattern); } catch { throw bad('Invalid regular expression'); } }
  db.prepare('INSERT INTO rules(match_field,match_type,pattern,set_category,set_merchant,set_excluded,created) VALUES(?,?,?,?,?,?,?)')
    .run(b.match_field || 'merchant', b.match_type || 'contains', b.pattern, b.set_category || null, b.set_merchant || null, b.set_excluded == null || b.set_excluded === '' ? null : Number(b.set_excluded), Date.now());
  const ruleId = Number(db.prepare('SELECT MAX(id) id FROM rules').get().id);
  const tags = reports.normTags(b.set_tags);
  if (tags) db.prepare('UPDATE rules SET set_tags=? WHERE id=?').run(tags, ruleId);
  invalidateRules();
  const recategorized = recategorizeAll();
  // auto-tag rules add their tags to every matching transaction (existing tags are kept)
  let tagged = 0;
  if (tags) {
    const rule = db.prepare('SELECT * FROM rules WHERE id=?').get(ruleId);
    const upd = db.prepare('UPDATE transactions SET tags=? WHERE id=?');
    tx(() => { for (const t of db.prepare('SELECT id, merchant, description, tags FROM transactions').all()) if (ruleMatch(rule, t)) {
      const merged = reports.normTags([...reports.tagList(t.tags), ...reports.tagList(tags)]); if (merged !== t.tags) { upd.run(merged, t.id); tagged++; } } });
  }
  return { recategorized, tagged };
}));
app.delete('/api/rules/:id', wrap(req => { db.prepare('DELETE FROM rules WHERE id=?').run(req.params.id); invalidateRules(); }));
app.post('/api/rules/test', wrap(req => {
  const rule = req.body;
  return db.prepare('SELECT id, merchant, description, amount, date, category FROM transactions ORDER BY date DESC LIMIT 5000').all().filter(t => ruleMatch(rule, t)).slice(0, 50);
}));

// ---------- recurring / subscriptions ----------
app.get('/api/recurring', wrap(() => {
  const rows = db.prepare(`SELECT r.*, a.name account_name FROM recurring r LEFT JOIN accounts a ON a.id=r.account_id ORDER BY CASE r.status WHEN 'active' THEN 0 WHEN 'inactive' THEN 2 ELSE 1 END, r.next_date`).all()
    .map(r => ({ ...r, monthly: round2(recurring.perMonth(r.amount, r.cadence)), cancel: lookup(r.merchant_key), negotiable: NEGOTIABLE[r.category] ? NEGOTIABLE[r.category].tips : null,
      history: db.prepare('SELECT date, amount FROM transactions WHERE recurring_id=? ORDER BY date DESC LIMIT 12').all(r.id) }));
  const paid = db.prepare(`SELECT r.id, COALESCE(r.custom_name, r.name) name, r.kind, r.category, t.date, ABS(t.amount) amount FROM transactions t JOIN recurring r ON r.id=t.recurring_id
    WHERE t.date>=? AND t.date<? ORDER BY t.date`).all(today().slice(0, 8) + '01', today());
  return { rows, paid, totals: insights.subscriptionTotals(), upcoming: recurring.upcoming(today(), addDays(today(), 45)), savings: cancel.savings(),
    toReview: db.prepare("SELECT COUNT(*) n FROM recurring WHERE status='active' AND kind='subscription' AND (reviewed_at IS NULL OR reviewed_at<?)").get(addDays(today(), -90)).n };
}));
app.post('/api/recurring', wrap(req => {
  const b = req.body; if (!b.name || !b.amount || !b.next_date) throw bad('Name, amount and next date are required.');
  const r = db.prepare(`INSERT INTO recurring(key,name,merchant_key,category,amount,cadence,next_date,status,kind,auto,created,updated,cancel_url)
    VALUES(?,?,?,?,?,?,?,'active',?,0,?,?,?)`).run('manual:' + Date.now(), b.name, merchantKey(b.name), b.category || 'Bills & Utilities', Math.abs(Number(b.amount)),
    b.cadence || 'monthly', b.next_date, b.kind || 'bill', Date.now(), Date.now(), (lookup(merchantKey(b.name)) || {}).url || null);
  return { id: Number(r.lastInsertRowid) };
}));
app.patch('/api/recurring/:id', wrap(req => {
  const r = db.prepare('SELECT * FROM recurring WHERE id=?').get(req.params.id); if (!r) throw bad('Not found');
  const b = req.body;
  const status = b.status ?? r.status;
  db.prepare('UPDATE recurring SET custom_name=?, status=?, kind=?, cadence=?, amount=?, next_date=?, category=?, cancel_url=?, notes=?, cancelled_at=?, auto=?, updated=? WHERE id=?').run(
    b.custom_name ?? r.custom_name, status, b.kind ?? r.kind, b.cadence ?? r.cadence, b.amount != null ? Math.abs(Number(b.amount)) : r.amount, b.next_date ?? r.next_date,
    b.category ?? r.category, b.cancel_url ?? r.cancel_url, b.notes ?? r.notes, status === 'cancelled' ? (r.cancelled_at || today()) : null,
    b.kind && b.kind !== r.kind ? 0 : r.auto, Date.now(), r.id);
}));
app.delete('/api/recurring/:id', wrap(req => {
  db.prepare('UPDATE transactions SET recurring_id=NULL WHERE recurring_id=?').run(req.params.id);
  // keep a tombstone for auto-detected items so they are not re-detected
  const r = db.prepare('SELECT auto FROM recurring WHERE id=?').get(req.params.id);
  if (r && r.auto) db.prepare("UPDATE recurring SET status='ignored' WHERE id=?").run(req.params.id);
  else db.prepare('DELETE FROM recurring WHERE id=?').run(req.params.id);
}));
// cancelling subscriptions
app.get('/api/recurring/:id/cancel', wrap(req => cancel.plan(Number(req.params.id))));
app.post('/api/recurring/:id/cancel', wrap(req => cancel.request(Number(req.params.id), req.body || {})));
app.post('/api/recurring/:id/cancel/confirm', wrap(req => cancel.confirm(Number(req.params.id))));
app.post('/api/recurring/:id/cancel/undo', wrap(req => { cancel.undo(Number(req.params.id)); }));
app.post('/api/recurring/:id/keep', wrap(req => { cancel.keep(Number(req.params.id)); }));
app.get('/api/subscriptions/review', wrap(() => cancel.toReview()));
app.get('/api/subscriptions/savings', wrap(() => cancel.savings()));
app.post('/api/recurring/detect', wrap(() => { const e = recurring.detect(); alerts.evaluate(e); return { events: e.length }; }));
app.get('/api/calendar', wrap(() => ({ url: `/cal/${sec.calendarToken()}/bills.ics` })));

function ics() {
  const esc = s => String(s).replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PocketFinance//Bills//EN', 'X-WR-CALNAME:Bills & Subscriptions', 'CALSCALE:GREGORIAN'];
  for (const u of recurring.upcoming(today(), addDays(today(), 120))) {
    const d = u.date.replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:pp-${u.id || 'a' + u.account_id}-${d}@pocketpilot`, `DTSTAMP:${d}T090000Z`, `DTSTART;VALUE=DATE:${d}`,
      `SUMMARY:${esc(`${u.kind === 'income' ? '💵' : '💸'} ${u.name} $${Number(u.amount).toFixed(2)}`)}`, `DESCRIPTION:${esc(`${u.category} · ${u.cadence}`)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-P1D', `DESCRIPTION:${esc(u.name)} due tomorrow`, 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
app.get('/api/calendar.ics', (req, res) => res.type('text/calendar').setHeader('Content-Disposition', 'attachment; filename="bills.ics"').send(ics()));

// ---------- budgets ----------
app.get('/api/budgets', wrap(req => {
  const m = req.query.month || monthOf(today());
  return { ...insights.budgets(m), income: insights.monthTotals(m).income, plannedIncome: insights.subscriptionTotals().incomeMonthly };
}));

// ---------- reports & planners ----------
app.get('/api/reports/range', wrap(req => reports.range(req.query)));
app.get('/api/reports/year', wrap(req => reports.yearReview(req.query.year)));
app.get('/api/reports/tax', wrap(req => reports.taxYear(req.query.year)));
app.get('/api/export/tax.csv', (req, res) => {
  const r = reports.taxYear(req.query.year);
  const q = v => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const out = ['Date,Merchant,Category,Amount,Notes,Receipt', ...r.flagged.map(t => [t.date, t.merchant, t.category, t.amount.toFixed(2), t.notes, t.att ? 'yes' : 'no'].map(q).join(','))];
  res.type('text/csv').setHeader('Content-Disposition', `attachment; filename="pocketfinance-tax-${r.year}.csv"`).send(out.join('\n'));
});

// ---------- investments, watchlists, money leaks ----------
app.get('/api/invest', wrap(() => invest.portfolio()));
app.put('/api/invest/fee', wrap(req => { invest.setFee(req.body.ticker, req.body.pct); return invest.portfolio(); }));
app.get('/api/watchlists', wrap(() => watch.watchlists()));
app.post('/api/watchlists', wrap(req => watch.addWatch(req.body || {})));
app.patch('/api/watchlists/:id', wrap(req => watch.updateWatch(Number(req.params.id), req.body || {})));
app.delete('/api/watchlists/:id', wrap(req => { db.prepare('DELETE FROM watchlists WHERE id=?').run(req.params.id); }));
app.get('/api/leaks', wrap(() => watch.leaks()));
app.post('/api/leaks/dismiss', wrap(req => { watch.dismissLeak(req.body.key); }));

// ---------- home values ----------
app.get('/api/homes', wrap(() => ({ homes: homes.list(), settings: homes.settings() })));
app.post('/api/homes', wrap(req => homes.create(req.body || {})));
app.put('/api/homes/:id', wrap(req => homes.update(Number(req.params.id), req.body || {})));
app.post('/api/homes/:id/refresh', wrap(req => homes.valuate(Number(req.params.id), { force: true })));
app.put('/api/homes-settings', sec.ownerOnly, wrap(req => homes.saveSettings(req.body || {})));

// ---------- household members (owner only) ----------
app.get('/api/members', sec.ownerOnly, wrap(() => ({ members: sec.listMembers(), owner_name: getSetting('owner_name', '') || '' })));
app.post('/api/members', sec.ownerOnly, wrap(req => { const r = sec.addMember(req.body || {}); if (req.body.email) { try { emailauth.setMemberEmail(r.id, req.body.email); } catch (e) { sec.removeMember(r.id); throw e; } } return r; }));
app.patch('/api/members/:id', sec.ownerOnly, wrap(req => { const id = Number(req.params.id); if (req.body.email !== undefined) emailauth.setMemberEmail(id, req.body.email); const { email, ...rest } = req.body || {}; if (Object.keys(rest).length) sec.updateMember(id, rest); }));
app.delete('/api/members/:id', sec.ownerOnly, wrap(req => sec.removeMember(Number(req.params.id))));
app.get('/api/plans/debt', wrap(req => plans.debtPlan(req.query.extra != null || req.query.strategy ? req.query : null)));
app.put('/api/plans/debt', wrap(req => { plans.saveDebtPlan(req.body || {}); return plans.debtPlan(); }));
app.get('/api/plans/retire', wrap(() => plans.retirePlan()));
app.post('/api/plans/retire/preview', wrap(req => plans.retirePlan(req.body || {})));
app.put('/api/plans/retire', wrap(req => { plans.saveRetirePlan(req.body || {}); return plans.retirePlan(); }));
app.put('/api/budgets/:category', wrap(req => {
  db.prepare('INSERT INTO budgets(category,amount,rollover) VALUES(?,?,?) ON CONFLICT(category) DO UPDATE SET amount=excluded.amount, rollover=excluded.rollover')
    .run(req.params.category, Math.abs(Number(req.body.amount) || 0), req.body.rollover ? 1 : 0);
}));
app.delete('/api/budgets/:category', wrap(req => { db.prepare('DELETE FROM budgets WHERE category=?').run(req.params.category); }));
app.post('/api/budgets/suggest', wrap(() => {
  // average of the last 3 full months, rounded up to $10
  const out = [];
  const m = monthOf(today());
  const rows = db.prepare(`SELECT t.category, SUM(-t.amount)/3.0 avg FROM transactions t LEFT JOIN categories c ON c.name=t.category
    WHERE t.excluded=0 AND COALESCE(c.kind,'expense')='expense' AND t.date>=? AND t.date<? GROUP BY t.category HAVING avg>20`).all(addDays(`${m}-01`, -92).slice(0, 8) + '01', `${m}-01`);
  for (const r of rows) out.push({ category: r.category, amount: Math.ceil(r.avg / 10) * 10 });
  return out;
}));

// ---------- goals ----------
app.get('/api/goals', wrap(() => db.prepare('SELECT g.*, a.balance account_balance, a.name account_name FROM goals g LEFT JOIN accounts a ON a.id=g.account_id ORDER BY g.created').all()
  .map(g => ({ ...g, saved: g.account_id ? g.account_balance : g.saved, events: db.prepare('SELECT * FROM goal_events WHERE goal_id=? ORDER BY date DESC LIMIT 10').all(g.id) }))));
app.post('/api/goals', wrap(req => {
  const b = req.body; if (!b.name || !b.target) throw bad('Name and target are required.');
  return { id: Number(db.prepare('INSERT INTO goals(name,target,saved,target_date,account_id,color,icon,created) VALUES(?,?,?,?,?,?,?,?)')
    .run(b.name, Number(b.target), Number(b.saved) || 0, b.target_date || null, b.account_id || null, b.color || '#6366f1', b.icon || '🎯', Date.now()).lastInsertRowid) };
}));
app.patch('/api/goals/:id', wrap(req => {
  const g = db.prepare('SELECT * FROM goals WHERE id=?').get(req.params.id); if (!g) throw bad('Not found'); const b = req.body;
  db.prepare('UPDATE goals SET name=?, target=?, target_date=?, account_id=?, color=?, icon=? WHERE id=?').run(b.name ?? g.name, b.target ?? g.target, b.target_date ?? g.target_date,
    b.account_id === undefined ? g.account_id : b.account_id || null, b.color ?? g.color, b.icon ?? g.icon, g.id);
}));
app.post('/api/goals/:id/contribute', wrap(req => {
  const amt = Number(req.body.amount); if (!amt) throw bad('Amount required');
  tx(() => { db.prepare('UPDATE goals SET saved=saved+? WHERE id=?').run(amt, req.params.id); db.prepare('INSERT INTO goal_events(goal_id,date,amount,note) VALUES(?,?,?,?)').run(req.params.id, today(), amt, req.body.note || null); });
}));
app.delete('/api/goals/:id', wrap(req => { db.prepare('DELETE FROM goals WHERE id=?').run(req.params.id); }));

// ---------- credit score ----------
app.get('/api/credit', wrap(() => ({ scores: db.prepare('SELECT * FROM credit_scores ORDER BY date').all(), utilization: insights.accountsSummary().utilization })));
app.post('/api/credit', wrap(req => {
  const s = Number(req.body.score); if (!(s >= 300 && s <= 900)) throw bad('Score must be 300–900.');
  db.prepare('INSERT INTO credit_scores(date,score,bureau,notes) VALUES(?,?,?,?)').run(req.body.date || today(), s, req.body.bureau || '', req.body.notes || '');
}));
app.delete('/api/credit/:id', wrap(req => { db.prepare('DELETE FROM credit_scores WHERE id=?').run(req.params.id); }));

// ---------- bill negotiation tracker ----------
app.get('/api/negotiations', wrap(() => {
  const rows = db.prepare('SELECT * FROM negotiations ORDER BY date DESC').all();
  const candidates = db.prepare("SELECT * FROM recurring WHERE status='active' AND kind!='income' AND category IN ('Bills & Utilities','Insurance','Subscriptions') ORDER BY amount DESC").all()
    .map(r => ({ ...r, tips: (NEGOTIABLE[r.category] || {}).tips || [] }));
  const saved = rows.filter(r => r.status === 'won').reduce((s, r) => s + (r.before_amount - r.after_amount) * (r.months || 12), 0);
  return { rows, candidates, savedYear: round2(saved) };
}));
app.post('/api/negotiations', wrap(req => {
  const b = req.body;
  db.prepare('INSERT INTO negotiations(recurring_id,provider,before_amount,after_amount,months,date,status,notes) VALUES(?,?,?,?,?,?,?,?)').run(b.recurring_id || null, b.provider,
    Number(b.before_amount) || 0, Number(b.after_amount) || 0, Number(b.months) || 12, b.date || today(), b.status || 'won', b.notes || '');
  if (b.recurring_id && b.status === 'won') db.prepare('UPDATE recurring SET amount=? WHERE id=?').run(Number(b.after_amount), b.recurring_id);
}));
app.delete('/api/negotiations/:id', wrap(req => { db.prepare('DELETE FROM negotiations WHERE id=?').run(req.params.id); }));

// ---------- alerts ----------
app.get('/api/alerts', wrap(() => db.prepare('SELECT * FROM alerts ORDER BY created DESC LIMIT 100').all()));
app.post('/api/alerts/read', wrap(req => { if (req.body.id) db.prepare('UPDATE alerts SET read=1 WHERE id=?').run(req.body.id); else db.prepare('UPDATE alerts SET read=1').run(); }));
app.post('/api/alerts/test', wrap(async () => { await alerts.push('PocketFinance test', 'Notifications are working.'); }));

// ---------- settings ----------
app.get('/api/settings', wrap(() => {
  const p = getSetting('plaid', {}) || {};
  return {
    plaid: { client_id: p.client_id || '', env: p.env || 'sandbox', redirect_uri: p.redirect_uri || '', has_secret: !!p.secret },
    notify: getSetting('notify', {}) || {}, thresholds: { low_balance: 100, large_tx: 500, bill_days: 3, ...(getSetting('thresholds', {}) || {}) },
    sync_hours: getSetting('sync_hours', 6), app_share_url: getSetting('app_share_url', '') || '', server_share_url: getSetting('server_share_url', '') || '', quick_logins: getSetting('quick_logins', []), data_dir: DATA_DIR, bind_host: getSetting('bind_host', '127.0.0.1'), demo: !!getSetting('demo'),
  };
}));
app.put('/api/settings', wrap(req => {
  const b = req.body;
  if ((b.plaid || b.bind_host || b.owner_name !== undefined) && req.user.role !== 'owner') throw Object.assign(new Error('Only the owner can change bank keys and network access.'), { status: 403 });
  if (b.owner_name !== undefined) setSetting('owner_name', String(b.owner_name).trim().slice(0, 40));
  if (b.plaid) { const cur = getSetting('plaid', {}) || {}; setSetting('plaid', { ...cur, client_id: b.plaid.client_id?.trim() ?? cur.client_id, env: b.plaid.env || cur.env, redirect_uri: b.plaid.redirect_uri?.trim() ?? cur.redirect_uri, ...(b.plaid.secret ? { secret: b.plaid.secret.trim() } : {}) }); }
  if (b.notify) setSetting('notify', b.notify);
  for (const k of ['app_share_url', 'server_share_url']) if (b[k] !== undefined) {
    const u = String(b[k] || '').trim();
    if (u && !/^https:\/\/\S{4,500}$/.test(u)) throw bad('Use a full https:// link.');
    setSetting(k, u);
  }
  if (Array.isArray(b.quick_logins)) setSetting('quick_logins', b.quick_logins.map(String).filter(x => /^[a-z0-9-]{1,30}$/.test(x)).slice(0, 8));
  if (b.thresholds) setSetting('thresholds', b.thresholds);
  if (b.sync_hours) setSetting('sync_hours', Math.max(1, Number(b.sync_hours)));
  if (b.bind_host) {
    const nh = b.bind_host === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';
    if (nh !== getSetting('bind_host', '127.0.0.1')) {
      setSetting('bind_host', nh);
      // the run.cmd loop brings the server straight back on the new address
      if ((require.main === module || process.env.PP_PACKAGED) && !process.env.HOST) setTimeout(() => process.exit(0), 800);
    }
  }
}));
// ---------- shared expenses / IOUs ----------
app.get('/api/ious', wrap(() => ious.list()));
app.post('/api/ious', wrap(req => ious.add(req.body || {})));
app.patch('/api/ious/:id', wrap(req => ious.update(Number(req.params.id), req.body || {})));
app.delete('/api/ious/:id', wrap(req => ious.remove(Number(req.params.id))));
app.post('/api/ious/settle', wrap(req => ious.settlePerson((req.body || {}).person)));

// ---------- family: kids' allowance + chores, monthly money check-in ----------
app.get('/api/kids', wrap(() => family.list()));
app.post('/api/kids', wrap(req => family.addKid(req.body || {})));
app.patch('/api/kids/:id', wrap(req => family.updateKid(Number(req.params.id), req.body || {})));
app.delete('/api/kids/:id', wrap(req => family.removeKid(Number(req.params.id))));
app.post('/api/kids/:id/ledger', wrap(req => family.addEntry(Number(req.params.id), req.body || {})));
app.delete('/api/kids/ledger/:id', wrap(req => family.removeEntry(Number(req.params.id))));
app.post('/api/kids/:id/chores', wrap(req => family.addChore(Number(req.params.id), req.body || {})));
app.patch('/api/chores/:id', wrap(req => family.updateChore(Number(req.params.id), req.body || {})));
app.delete('/api/chores/:id', wrap(req => family.removeChore(Number(req.params.id))));
app.post('/api/chores/:id/done', wrap(req => family.choreDone(Number(req.params.id))));
app.post('/api/chores/:id/undo', wrap(req => family.choreUndo(Number(req.params.id))));
app.get('/api/family/checkin', wrap(req => family.checkin(req.query.month, { insights, recurring })));
app.put('/api/family/notes/:month', wrap(req => family.saveNotes(req.params.month, (req.body || {}).notes)));
// restore a Full backup (JSON); owner only, keeps a copy of the current database in data/backups
app.post('/api/restore', sec.ownerOnly, wrap(req => { const r = restore.restore(req.body); sync.afterSync(); return r; }));
// automatic daily backups (data/backups/auto-YYYY-MM-DD.json): list, back up now, download, restore
app.get('/api/backups', sec.ownerOnly, wrap(() => ({ auto: autobackup.list(), keep: autobackup.KEEP, folder: autobackup.DIR })));
app.post('/api/backups/run', sec.ownerOnly, wrap(() => ({ name: autobackup.run(true), auto: autobackup.list() })));
app.get('/api/backups/:name', sec.ownerOnly, (req, res) => {
  let f; try { f = autobackup.file(req.params.name); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  res.download(f, `pocketfinance-${req.params.name}`);
});
app.post('/api/backups/:name/restore', sec.ownerOnly, wrap(req => { const r = restore.restore(autobackup.read(req.params.name)); sync.afterSync(); return r; }));

app.post('/api/demo/load', wrap(() => { demo.load(); sync.afterSync(); }));
app.post('/api/demo/clear', wrap(() => { demo.clear(); }));

// ---------- export ----------
app.get('/api/export/transactions.csv', (req, res) => {
  const rows = db.prepare('SELECT t.date, a.name account, t.merchant, t.description, t.category, t.amount, t.notes, t.excluded, t.tax_deductible FROM transactions t JOIN accounts a ON a.id=t.account_id ORDER BY t.date DESC').all();
  const q = v => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const out = ['Date,Account,Merchant,Description,Category,Amount,Notes,Excluded,Tax Deductible', ...rows.map(r => [r.date, r.account, r.merchant, r.description, r.category, r.amount, r.notes, r.excluded, r.tax_deductible].map(q).join(','))];
  res.type('text/csv').setHeader('Content-Disposition', `attachment; filename="pocketpilot-transactions-${today()}.csv"`).send(out.join('\n'));
});
app.get('/api/export/backup.json', (req, res) => {
  res.setHeader('Content-Disposition', `attachment; filename="pocketfinance-backup-${today()}.json"`); res.json(autobackup.snapshot());
});

// ---------- AI advisor (Gemini) ----------
const gemini = require('./integrations/gemini');
const advisor = require('./engine/advisor');
app.get('/api/ai/status', wrap(() => ({ configured: gemini.configured(), model: gemini.cfg().model, profile: getSetting('ai_profile', '') || '', insights: getSetting('ai_insights') || null })));
app.get('/api/ai/history', wrap(() => advisor.history()));
app.delete('/api/ai/history', wrap(() => { advisor.clearHistory(); }));
app.post('/api/ai/ask', wrap(req => advisor.ask(req.body.question)));
app.post('/api/ai/insights', wrap(req => advisor.dailyInsights(!!req.body.refresh)));
app.get('/api/ai/snapshot', wrap(() => ({ text: advisor.snapshot() })));
app.post('/api/ai/models', wrap(req => gemini.listModels(req.body.key)));
app.put('/api/ai/settings', sec.ownerOnly, wrap(req => {
  const b = req.body;
  if (b.key !== undefined || b.model) gemini.save({ key: b.key, model: b.model });
  if (b.profile !== undefined) setSetting('ai_profile', String(b.profile).slice(0, 1500));
  setSetting('ai_insights', null);
}));

// Android app download (signed-in users only)
const APK = path.join(ROOT, 'dist', 'PocketFinance.apk');
app.get('/api/app.apk', (req, res) => {
  if (!require('fs').existsSync(APK)) return res.status(404).json({ error: 'The Android app has not been built yet.' });
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.download(APK, 'PocketFinance.apk');
});

// ---------- connect your phone ----------
// the addresses a phone can use to reach this PC, with a QR code for each
app.get('/api/connect-info', wrap(() => {
  const os = require('os'), qrcode = require('qrcode-generator');
  const lanOpen = HOST === '0.0.0.0';
  const lan = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) for (const a of list || []) {
    if (a.family !== 'IPv4' || a.internal) continue;
    if (/^169\.254\./.test(a.address)) continue; // no network
    if (/vethernet|virtualbox|vmware|hyper-v|wsl|docker/i.test(name)) continue;
    lan.push({ name, url: `http://${a.address}:${PORT}`, tailscale: /^100\./.test(a.address) || /tailscale/i.test(name) });
  }
  const qr = url => { const q = qrcode(0, 'M'); q.addData(url); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); };
  return { port: PORT, lanOpen, bind_host: getSetting('bind_host', '127.0.0.1'), addresses: lan.map(x => ({ ...x, qr: qr(x.url) })), packaged: !!process.env.PP_PACKAGED };
}));

// ---------- static web app ----------
app.get('/vendor/inter.woff2', (req, res) => res.sendFile(path.join(ROOT, 'node_modules', '@fontsource-variable', 'inter', 'files', 'inter-latin-wght-normal.woff2'), { maxAge: '30d' }));
app.get('/vendor/chart.js', (req, res) => res.sendFile(path.join(ROOT, 'node_modules', 'chart.js', 'dist', 'chart.umd.min.js')));
app.use(express.static(path.join(ROOT, 'public'), { maxAge: 0 }));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

// last-resort error handler: plain JSON, never a stack trace (bad JSON bodies, oversized uploads, etc.)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(req.method, req.path, err.message);
  res.status(err.status || err.statusCode || 500).json({ error: err.status === 413 || err.type === 'entity.too.large' ? 'That file is too large.' : err.expose ? err.message : 'Something went wrong.' });
});

function start() {
  return app.listen(PORT, HOST, () => {
    console.log(`[${new Date().toISOString()}] PocketFinance listening on http://${HOST}:${PORT}`);
    sync.startSchedule();
    try { attach.sweep(); } catch (e) { console.error('receipt sweep', e.message); }
  });
}
if (require.main === module) start();
module.exports = app;
app.start = start;
