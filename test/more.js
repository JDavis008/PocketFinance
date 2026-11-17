// Investments, watchlists, money leaks, taxes, recap, auto-tag rules, household access: node test/more.js
const os = require('os'), fs = require('fs'), path = require('path'), assert = require('assert');
process.env.PP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-more-'));
const app = require('../server/index.js');
const invest = require('../server/engine/invest');

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
  let ok = 0; const check = (name, cond, extra) => { assert.ok(cond, name + (extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 500) : '')); ok++; console.log('  ✓', name); };
  const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

  await call('POST', '/api/auth/setup', { password: 'owner-pass-1' });
  await call('POST', '/api/demo/load');

  // ---- investments
  const cls = invest.classify;
  check('S&P 500 fund is US stocks', cls({ ticker: 'FXAIX', name: 'Fidelity 500 Index' }).us === 1);
  check('bond fund', cls({ ticker: 'BND' }).bonds === 1);
  check('money market is cash', cls({ ticker: 'SPAXX', name: 'Fidelity Government Money Market' }).cash === 1);
  const td = cls({ ticker: 'VFFVX', name: 'Vanguard Target Retirement 2055' });
  check('target-date split adds to 100%', near(Object.values(td).reduce((s, v) => s + v, 0), 1, 1e-9) && td.bonds > 0 && td.us > td.intl, td);
  check('unknown name falls back to other', cls({ name: 'Mystery LLC units' }).other === 1);
  const p = (await call('GET', '/api/invest')).body;
  check('portfolio total matches investment accounts', p.total > 0 && near(p.total, p.accounts.reduce((s, a) => s + a.balance, 0), 1), [p.total]);
  check('allocation adds to total', near(p.allocation.reduce((s, a) => s + a.value, 0), p.total, 1));
  check('fees from built-in table', p.fees.yearly > 0 && p.fees.avgPct > 0 && p.fees.avgPct < 0.1, p.fees);
  check('fee drag computed', p.fees.drag && p.fees.drag.cheap >= p.fees.drag.yours);
  check('dividends from interest category', p.dividends.total > 0);
  check('value history', p.history.length > 30);
  const p2 = (await call('PUT', '/api/invest/fee', { ticker: 'fxaix', pct: 0.5 })).body;
  check('fee override applies', p2.holdings.find(h => h.ticker === 'FXAIX').fee === 0.5 && p2.fees.yearly > p.fees.yearly);
  check('bad fee rejected', (await call('PUT', '/api/invest/fee', { ticker: 'X', pct: 9 })).status === 400);
  await call('PUT', '/api/invest/fee', { ticker: 'FXAIX', pct: '' });
  check('clearing override restores built-in', (await call('GET', '/api/invest')).body.holdings.find(h => h.ticker === 'FXAIX').fee === 0.015);

  // ---- watchlists
  const kroger = (await call('GET', '/api/transactions?q=kroger&limit=1')).body.rows[0];
  const w1 = (await call('POST', '/api/watchlists', { kind: 'merchant', value: kroger.merchant_key, monthly_limit: 1 })).body;
  const w2 = (await call('POST', '/api/watchlists', { kind: 'category', value: 'Dining & Drinks' })).body;
  check('bad watch rejected', (await call('POST', '/api/watchlists', { kind: 'nope', value: 'x' })).status === 400);
  let wl = (await call('GET', '/api/watchlists')).body;
  const wk = wl.find(w => w.id === w1.id), wd = wl.find(w => w.id === w2.id);
  check('watch named after merchant', wk.name === kroger.merchant, wk.name);
  check('six months of history', wk.series.length === 6 && wd.series.length === 6);
  const m = new Date().toISOString().slice(0, 7);
  const dining = (await call('GET', `/api/transactions?category=${encodeURIComponent('Dining & Drinks')}&from=${m}-01&limit=1`)).body.total.out || 0;
  check('category watch matches transactions', near(wd.spent, dining, 0.02), [wd.spent, dining]);
  await call('PATCH', `/api/watchlists/${w2.id}`, { monthly_limit: 50, name: 'Eating out' });
  wl = (await call('GET', '/api/watchlists')).body;
  check('edit watch', wl.find(w => w.id === w2.id).name === 'Eating out' && wl.find(w => w.id === w2.id).monthly_limit === 50);
  await call('POST', '/api/recurring/detect'); // runs alert evaluation
  const al = (await call('GET', '/api/alerts')).body;
  if (wk.spent >= 1) check('over-limit watch alert', al.some(a => a.type === 'watch' && a.key === `watch:${w1.id}:${m}:over`), al.map(a => a.key));
  await call('DELETE', `/api/watchlists/${w1.id}`);
  check('delete watch', (await call('GET', '/api/watchlists')).body.length === 1);

  // ---- money leaks
  const lk = (await call('GET', '/api/leaks')).body;
  const types = lk.items.map(x => x.type);
  check('finds bank fees', types.includes('fees') && near(lk.items.find(x => x.type === 'fees').amount, 50.5), lk.items.find(x => x.type === 'fees'));
  check('finds card interest', types.includes('interest'));
  check('finds foreign fee', types.includes('fx'));
  const dup = lk.items.find(x => x.type === 'duplicate');
  check('finds the double charge', dup && dup.items.length === 2 && /Best Buy/i.test(dup.title), types);
  check('regular repeat purchases are not duplicates', lk.items.filter(x => x.type === 'duplicate').length === 1, lk.items.filter(x => x.type === 'duplicate').map(x => x.title));
  check('yearly cost estimate', lk.yearlyTotal > 100);
  check('long-running subscriptions are not "new"', !types.includes('newsub'), lk.items.filter(x => x.type === 'newsub').map(x => x.title));
  check('rent on the 1st is not a spike', !lk.items.some(x => x.type === 'spike' && /Housing/.test(x.title)));
  check('leak alerts raised', al.some(a => a.type === 'leak'), al.map(a => a.type));
  await call('POST', '/api/leaks/dismiss', { key: dup.key });
  check('dismiss hides it', !(await call('GET', '/api/leaks')).body.items.some(x => x.key === dup.key));
  check('recap alert for last month', al.some(a => a.type === 'recap' && /recap/.test(a.title)), al.map(a => a.title));

  // ---- auto-tag rules
  const rule = (await call('POST', '/api/rules', { match_field: 'merchant', match_type: 'contains', pattern: 'Starbucks', set_tags: 'coffee, #treats' })).body;
  check('auto-tag rule tags existing', rule.tagged > 0, rule);
  const sb = (await call('GET', '/api/transactions?q=starbucks&limit=500')).body;
  check('all matches tagged', sb.rows.every(t => t.tags === ',coffee,treats,'), sb.rows.slice(0, 2).map(t => t.tags));
  check('rule stored tags', (await call('GET', '/api/rules')).body.some(r => r.set_tags === ',coffee,treats,'));
  await call('POST', '/api/transactions', { account_id: sb.rows[0].account_id, date: new Date().toISOString().slice(0, 10), amount: -5.25, description: 'STARBUCKS STORE 99999' });
  const nt = (await call('GET', '/api/transactions?q=99999')).body.rows[0];
  check('new transactions get tagged', nt && nt.tags === ',coffee,treats,', nt);

  // ---- taxes
  const t1 = (await call('GET', '/api/transactions?q=kroger&limit=2')).body.rows;
  for (const t of t1) await call('PATCH', `/api/transactions/${t.id}`, { tax_deductible: true });
  const yr = t1[0].date.slice(0, 4);
  const tax = (await call('GET', `/api/reports/tax?year=${yr}`)).body;
  const want = t1.filter(t => t.date.startsWith(yr)).reduce((s, t) => s - t.amount, 0);
  check('tax total = flagged', near(tax.total, want, 0.02), [tax.total, want]);
  check('missing receipts counted', tax.missingReceipts === tax.flagged.length);
  check('income listed', tax.incomeTotal > 0);
  const csv = await call('GET', `/api/export/tax.csv?year=${yr}`);
  check('tax csv', csv.status === 200 && csv.body.startsWith('Date,Merchant') && csv.body.split('\n').length === tax.flagged.length + 1);

  // ---- household
  check('owner is owner', (await call('GET', '/api/auth/status')).body.user.role === 'owner');
  check('member needs unique password', (await call('POST', '/api/members', { name: 'Sam', password: 'owner-pass-1' })).status === 400);
  const viewer = (await call('POST', '/api/members', { name: 'Sam', password: 'sam-view-pass', role: 'view' })).body;
  const editor = (await call('POST', '/api/members', { name: 'Riley', password: 'riley-full-pass', role: 'full' })).body;
  check('members created', viewer.id && editor.id);
  const v = client(), e = client();
  check('viewer signs in', (await v('POST', '/api/auth/login', { password: 'sam-view-pass' })).status === 200);
  const vs = (await v('GET', '/api/auth/status')).body;
  check('viewer identity', vs.user.name === 'Sam' && vs.user.role === 'view', vs);
  check('viewer can read', (await v('GET', '/api/dashboard')).status === 200);
  const blocked = await v('PATCH', `/api/transactions/${t1[0].id}`, { notes: 'hi' });
  check('viewer cannot edit', blocked.status === 403 && blocked.body.code === 'VIEW_ONLY');
  check('viewer can preview plans', (await v('POST', '/api/plans/retire/preview', { age: 40 })).status === 200);
  check('viewer cannot see members', (await v('GET', '/api/members')).status === 403);
  await e('POST', '/api/auth/login', { password: 'riley-full-pass' });
  check('editor can edit', (await e('PATCH', `/api/transactions/${t1[0].id}`, { notes: 'from Riley' })).status === 200);
  check('editor cannot change plaid keys', (await e('PUT', '/api/settings', { plaid: { client_id: 'x' } })).status === 403);
  check('editor can change thresholds', (await e('PUT', '/api/settings', { thresholds: { low_balance: 50, large_tx: 500, bill_days: 3 } })).status === 200);
  check('editor cannot change owner password', (await e('POST', '/api/auth/password', { current: 'owner-pass-1', password: 'hijacked-123' })).status === 403);
  check('editor cannot add members', (await e('POST', '/api/members', { name: 'X', password: 'xxxxxxxxxx' })).status === 403);
  check('members listed for owner', (await call('GET', '/api/members')).body.members.length === 2);
  await call('PATCH', `/api/members/${viewer.id}`, { role: 'full' });
  check('role change signs them out', (await v('GET', '/api/dashboard')).status === 401);
  await call('DELETE', `/api/members/${editor.id}`);
  check('removed member is signed out', (await e('GET', '/api/dashboard')).status === 401);
  check('removed member cannot sign in', (await e('POST', '/api/auth/login', { password: 'riley-full-pass' })).status === 401);
  check('owner still signed in', (await call('GET', '/api/dashboard')).status === 200);
  check('wrong password is JSON, no stack', (await (async () => { const r = await client()('POST', '/api/auth/login', { password: 'nope-nope' }); return r.status === 401 && r.body.error === 'Wrong password.'; })()));

  srv.close();
  console.log(`\n${ok} more-feature checks passed`);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
