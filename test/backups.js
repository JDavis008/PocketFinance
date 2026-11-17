// Automatic daily backups + the phone app's /api/hello: node test/backups.js
const os = require('os'), fs = require('fs'), path = require('path'), assert = require('assert');
process.env.PP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-backups-'));
const app = require('../server/index.js');
const autobackup = require('../server/autobackup');

(async () => {
  const srv = app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const client = () => {
    let cookie = '';
    return async (method, url, body) => {
      const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-PP': '1', cookie }, body: body ? JSON.stringify(body) : undefined });
      const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
      const ct = r.headers.get('content-type') || '';
      return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : await r.text() };
    };
  };
  const call = client();
  let ok = 0; const check = (name, cond, extra) => { assert.ok(cond, name + (extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 400) : '')); ok++; console.log('  ✓', name); };

  // ---- the phone app finds servers with this; public and readable cross-origin
  const hello = await fetch(base + '/api/hello');
  check('hello is public', hello.status === 200 && (await hello.json()).app === 'PocketFinance');
  check('hello allows cross-origin reads', hello.headers.get('access-control-allow-origin') === '*');
  check('everything else still needs sign-in', (await call('GET', '/api/backups')).status === 401);

  await call('POST', '/api/auth/setup', { password: 'owner-pass-1' });
  check('empty database is not backed up', autobackup.run() === null && autobackup.list().length === 0);
  await call('POST', '/api/demo/load');

  // ---- daily run: once a day, then a no-op
  const first = autobackup.run();
  check('daily backup written', /^auto-\d{4}-\d{2}-\d{2}\.json$/.test(first), first);
  check('only once a day', autobackup.run() === null);
  let l = (await call('GET', '/api/backups')).body;
  check('listed in Settings', l.auto.length === 1 && l.auto[0].name === first && l.keep === 14 && l.auto[0].size > 1000, l);

  // ---- download is the same format as Full backup (JSON)
  const dl = await call('GET', `/api/backups/${first}`);
  check('download works', dl.status === 200 && /attachment/.test(dl.headers.get('content-disposition') || ''));
  const data = typeof dl.body === 'string' ? JSON.parse(dl.body) : dl.body;
  check('download is a restorable backup', data.version === 1 && data.accounts.length > 0 && data.transactions.length > 0 && Array.isArray(data.kids));
  check('bad names rejected', (await call('GET', '/api/backups/..%2Fsecret.key')).status === 400 && (await call('GET', '/api/backups/auto-2000-01-01.json')).status === 404);
  check('full backup still exports', (await call('GET', '/api/export/backup.json')).body.version === 1);

  // ---- owner only
  await call('POST', '/api/members', { name: 'Partner', password: 'partner-full-1', role: 'full' });
  const partner = client(); await partner('POST', '/api/auth/login', { password: 'partner-full-1' });
  check('members cannot list backups', (await partner('GET', '/api/backups')).status === 403);
  check('members cannot restore backups', (await partner('POST', `/api/backups/${first}/restore`)).status === 403);

  // ---- restore one: changes since then are undone
  const nTx = data.transactions.length;
  const t = (await call('GET', '/api/transactions?limit=1')).body.rows[0];
  await call('DELETE', `/api/transactions/${t.id}`);
  await call('POST', '/api/goals', { name: 'After the backup', target: 50 });
  const r = await call('POST', `/api/backups/${first}/restore`);
  check('restore from an automatic backup', r.status === 200 && r.body.counts.transactions === nTx, r.body);
  check('deleted transaction is back', (await call('GET', `/api/transactions/${t.id}`)).status === 200);
  check('later goal is gone', !(await call('GET', '/api/goals')).body.some(g => g.name === 'After the backup'));

  // ---- back up now + keep the newest 14
  for (let d = 1; d <= 20; d++) fs.writeFileSync(path.join(autobackup.DIR, `auto-2020-01-${String(d).padStart(2, '0')}.json`), '{}');
  const now = await call('POST', '/api/backups/run');
  check('back up now', now.status === 200 && now.body.name === first);
  l = autobackup.list();
  check('keeps the newest 14', l.length === 14 && l[0].name === first && l[13].name === 'auto-2020-01-08.json', l.map(x => x.name));
  check('old copies made before restores are pruned too', fs.readdirSync(autobackup.DIR).filter(f => f.startsWith('before-restore-')).length <= 10);

  srv.close();
  console.log(`\n${ok} backup checks passed`);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
