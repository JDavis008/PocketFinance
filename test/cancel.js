// Subscription cancellation + share settings: node test/cancel.js
const os = require('os'), fs = require('fs'), path = require('path'), assert = require('assert');
process.env.PP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-cancel-'));
const app = require('../server/index.js');
const { db } = require('../server/db');
const { addDays, today } = require('../server/util');

(async () => {
  const srv = app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-PP': '1', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  let ok = 0; const check = (name, cond, extra) => { assert.ok(cond, name + (extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 400) : '')); ok++; console.log('  ✓', name); };

  await call('POST', '/api/auth/setup', { password: 'correct horse' });
  await call('POST', '/api/demo/load');
  let rec = (await call('GET', '/api/recurring')).body;
  const byName = n => rec.rows.find(r => r.name === n);
  const netflix = byName('Netflix'), apple = byName('Apple'), hulu = byName('Hulu'), spotify = byName('Spotify');

  // ---- plans
  const pa = (await call('GET', `/api/recurring/${apple.id}/cancel`)).body;
  check('Apple-billed subscription goes through the App Store first', pa.channel && pa.channel.id === 'apple' && pa.methods[0].id === 'channel' && /apps\.apple\.com/.test(pa.methods[0].url), pa.methods);
  const pn = (await call('GET', `/api/recurring/${netflix.id}/cancel`)).body;
  check('Netflix uses its cancel page', !pn.channel && pn.methods[0].id === 'online' && pn.methods[0].url === 'https://www.netflix.com/cancelplan');
  check('email method included with a ready letter', pn.methods.some(m => m.id === 'email') && /cancel my Netflix/i.test(pn.email.body) && /ending in \d{4}/.test(pn.email.body), pn.email);
  check('yearly cost', Math.abs(pn.yearly - netflix.monthly * 12) < 0.05);
  check('dispute steps', pn.dispute.length === 3);
  check('unknown id is 400', (await call('GET', '/api/recurring/99999/cancel')).status === 400);

  // ---- review list
  check('subscriptions to review', rec.toReview >= 5, rec.toReview);
  const rv = (await call('GET', '/api/subscriptions/review')).body;
  check('review list biggest first', rv.length === rec.toReview && rv[0].amount >= rv[rv.length - 1].amount);
  await call('POST', `/api/recurring/${spotify.id}/keep`);
  check('keep removes it from review', (await call('GET', '/api/recurring')).body.toReview === rec.toReview - 1);

  // ---- cancel → pending → confirmed
  const c1 = (await call('POST', `/api/recurring/${netflix.id}/cancel`, { method: 'online', ref: 'NF-12345' })).body;
  check('cancel recorded as pending', c1.status === 'cancelled' && c1.cancel_state === 'pending' && c1.cancel_ref === 'NF-12345' && c1.cancelled_at === today(), c1);
  rec = (await call('GET', '/api/recurring')).body;
  check('savings counts it', Math.abs(rec.savings.yearly - netflix.monthly * 12) < 0.05 && rec.savings.count === 1, rec.savings);
  check('cancelled one leaves the review list', !(await call('GET', '/api/subscriptions/review')).body.some(x => x.id === netflix.id));
  // pretend the cancel happened 40 days ago and the billing date passed with no charge
  db.prepare('UPDATE recurring SET cancelled_at=?, next_date=? WHERE id=?').run(addDays(today(), -40), addDays(today(), -10), netflix.id);
  db.prepare('DELETE FROM transactions WHERE recurring_id=? AND date>?').run(netflix.id, addDays(today(), -40)); // no charges since then
  await call('POST', '/api/recurring/detect'); // runs alerts → cancel.check()
  let p = (await call('GET', `/api/recurring/${netflix.id}/cancel`)).body;
  check('auto-confirmed after the billing date passes', p.cancel_state === 'confirmed', p.cancel_state);
  let alerts = (await call('GET', '/api/alerts')).body;
  check('confirmation alert', alerts.some(a => a.key === `cancelok:${netflix.id}`));
  check('savings so far grows with time', (await call('GET', '/api/subscriptions/savings')).body.soFar > 0);

  // ---- cancel → charged anyway → failed + alert
  await call('POST', `/api/recurring/${hulu.id}/cancel`, { method: 'email', date: addDays(today(), -20) });
  const acct = db.prepare('SELECT account_id FROM transactions WHERE recurring_id=? LIMIT 1').get(hulu.id).account_id;
  db.prepare('INSERT INTO transactions(account_id,external_id,date,amount,description,merchant,merchant_key,category,recurring_id,created,reviewed) VALUES(?,?,?,?,?,?,?,?,?,?,1)')
    .run(acct, 'hulu-after', addDays(today(), -2), -18.99, 'HULU 877-8244858 CA', 'Hulu', 'hulu', 'Subscriptions', hulu.id, Date.now());
  await call('POST', '/api/recurring/detect');
  p = (await call('GET', `/api/recurring/${hulu.id}/cancel`)).body;
  check('charge after cancel marks it failed', p.cancel_state === 'failed', p.cancel_state);
  alerts = (await call('GET', '/api/alerts')).body;
  check('failed-cancel alert', alerts.some(a => a.key.startsWith(`cancelfail:${hulu.id}:`)), alerts.map(a => a.key));
  check('failed cancellations are not counted as savings', !(await call('GET', '/api/subscriptions/savings')).body.list.some(x => x.id === hulu.id));

  // ---- undo
  await call('POST', `/api/recurring/${hulu.id}/cancel/undo`);
  p = (await call('GET', `/api/recurring/${hulu.id}/cancel`)).body;
  check('undo makes it active again', p.status === 'active' && p.cancel_state == null && p.cancelled_at == null);
  await call('POST', `/api/recurring/${apple.id}/cancel`);
  check('manual confirm', (await call('POST', `/api/recurring/${apple.id}/cancel/confirm`)).body.cancel_state === 'confirmed');

  // ---- share link setting
  check('app share link must be https', (await call('PUT', '/api/settings', { app_share_url: 'http://example.com/x.apk' })).status === 400);
  await call('PUT', '/api/settings', { app_share_url: 'https://drive.google.com/file/d/abc123/view' });
  check('app share link saved', (await call('GET', '/api/settings')).body.app_share_url === 'https://drive.google.com/file/d/abc123/view');
  check('server link must be https', (await call('PUT', '/api/settings', { server_share_url: 'ftp://x' })).status === 400);
  await call('PUT', '/api/settings', { server_share_url: 'https://drive.google.com/file/d/srv1/view' });
  check('server link saved', (await call('GET', '/api/settings')).body.server_share_url === 'https://drive.google.com/file/d/srv1/view');
  const ci = (await call('GET', '/api/connect-info')).body;
  check('connect info for the phone', ci.port > 0 && Array.isArray(ci.addresses) && ci.lanOpen === false);
  await call('PUT', '/api/settings', { app_share_url: '' });
  check('app share link cleared', (await call('GET', '/api/settings')).body.app_share_url === '');

  srv.close();
  console.log(`\n${ok} cancel + share checks passed`);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
