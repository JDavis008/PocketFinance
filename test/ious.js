// Split & IOUs, backup restore: node test/ious.js
const os = require('os'), fs = require('fs'), path = require('path'), assert = require('assert');
process.env.PP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-ious-'));
const app = require('../server/index.js');

(async () => {
  const srv = app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const client = () => {
    let cookie = '';
    return async (method, url, body) => {
      const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-PP': '1', cookie }, body: body ? JSON.stringify(body) : undefined });
      const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
      const ct = r.headers.get('content-type') || '';
      return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
    };
  };
  const call = client();
  let ok = 0; const check = (name, cond, extra) => { assert.ok(cond, name + (extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 500) : '')); ok++; console.log('  ✓', name); };

  await call('POST', '/api/auth/setup', { password: 'owner-pass-1' });
  await call('POST', '/api/demo/load');

  // ---- IOUs from the demo
  let l = (await call('GET', '/api/ious')).body;
  check('demo IOUs listed', l.open.length === 4 && l.settled.length === 1, l);
  check('Sam owes the trip halves', l.people.find(p => p.person === 'Sam').net === 515.27, l.people);
  check('owed / owe totals', l.owed_me > 500 && l.i_owe === 60, [l.owed_me, l.i_owe]);
  check('dashboard shows IOU totals', (await call('GET', '/api/dashboard')).body.ious.n === 4);

  // ---- share a transaction's cost
  const t = (await call('GET', '/api/transactions?q=AMC&limit=1')).body.rows[0];
  const add = await call('POST', '/api/ious', { tx_id: t.id, person: '  Riley ', amount: -20, direction: 'owed_me', note: 'Movie' });
  check('IOU from a transaction', add.status === 200 && add.body.id, add.body);
  const tx = (await call('GET', `/api/transactions/${t.id}`)).body;
  check('transaction shows its IOU', tx.ious.length === 1 && tx.ious[0].person === 'Riley' && tx.ious[0].amount === 20 && tx.ious[0].date === t.date, tx.ious);
  check('person required', (await call('POST', '/api/ious', { amount: 5 })).status === 400);
  check('amount required', (await call('POST', '/api/ious', { person: 'X', amount: 0 })).status === 400);
  check('unknown transaction rejected', (await call('POST', '/api/ious', { person: 'X', amount: 5, tx_id: 999999 })).status === 400);

  // ---- edit, settle, reopen, settle a person, delete
  check('edit amount', (await call('PATCH', `/api/ious/${add.body.id}`, { amount: 25 })).status === 200);
  check('settle one', (await call('PATCH', `/api/ious/${add.body.id}`, { settled: true })).status === 200);
  l = (await call('GET', '/api/ious')).body;
  check('settled moves out of open', !l.open.some(i => i.id === add.body.id) && l.settled.some(i => i.id === add.body.id && i.amount === 25));
  await call('PATCH', `/api/ious/${add.body.id}`, { settled: false });
  check('reopen', (await call('GET', '/api/ious')).body.open.some(i => i.id === add.body.id));
  const st = (await call('POST', '/api/ious/settle', { person: 'sam' })).body;
  check('settle up with a person (any case)', st.settled === 2, st);
  check('Sam is even', !(await call('GET', '/api/ious')).body.people.some(p => p.person === 'Sam'));
  await call('DELETE', `/api/ious/${add.body.id}`);
  check('delete', !(await call('GET', '/api/ious')).body.open.some(i => i.id === add.body.id));

  // ---- view-only member can read but not write
  await call('POST', '/api/members', { name: 'Kid', password: 'kid-view-pass', role: 'view' });
  const kid = client(); await kid('POST', '/api/auth/login', { password: 'kid-view-pass' });
  check('view-only can see IOUs', (await kid('GET', '/api/ious')).status === 200);
  check('view-only cannot add IOUs', (await kid('POST', '/api/ious', { person: 'Z', amount: 3 })).status === 403);

  // ---- backup → change → restore
  const backup = (await call('GET', '/api/export/backup.json')).body;
  check('backup includes IOUs', Array.isArray(backup.ious) && backup.ious.length === 5, backup.ious && backup.ious.length);
  const nTx = backup.transactions.length;
  await call('POST', '/api/goals', { name: 'Added after backup', target: 100 });
  await call('DELETE', `/api/transactions/${t.id}`);
  check('members cannot restore', (await kid('POST', '/api/restore', backup)).status === 403);
  check('bad file rejected', (await call('POST', '/api/restore', { hello: 1 })).status === 400);
  const r = await call('POST', '/api/restore', backup);
  check('restore ok', r.status === 200 && r.body.counts.transactions === nTx && /^before-restore-/.test(r.body.saved_copy), r.body);
  check('copy of old database saved', fs.existsSync(path.join(process.env.PP_DATA, 'backups', r.body.saved_copy)));
  check('deleted transaction is back', (await call('GET', `/api/transactions/${t.id}`)).status === 200);
  check('goal added after backup is gone', !(await call('GET', '/api/goals')).body.some(g => g.name === 'Added after backup'));
  check('IOUs restored', (await call('GET', '/api/ious')).body.open.length + (await call('GET', '/api/ious')).body.settled.length === 5);
  check('accounts restored', (await call('GET', '/api/accounts')).body.accounts.length === backup.accounts.length);
  check('owner still signed in after restore', (await call('GET', '/api/dashboard')).status === 200);

  // ---- demo clear removes demo IOUs
  await call('POST', '/api/ious', { person: 'Mine', amount: 10 });
  await call('POST', '/api/demo/load'); await call('POST', '/api/demo/clear');
  l = (await call('GET', '/api/ious')).body;
  check('demo clear keeps my own IOU only', l.open.length === 1 && l.open[0].person === 'Mine', l.open);

  srv.close();
  console.log(`\n${ok} IOU/restore checks passed`);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
