// Premium-style features against a throwaway database: node test/premium.js
const os = require('os'), fs = require('fs'), path = require('path'), assert = require('assert');
process.env.PP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-prem-'));
const app = require('../server/index.js');
const plans = require('../server/engine/plans');

(async () => {
  const srv = app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-PP': '1', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  let ok = 0; const check = (name, cond, extra) => { assert.ok(cond, name + (extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 500) : '')); ok++; console.log('  ✓', name); };
  const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

  await call('POST', '/api/auth/setup', { password: 'correct horse' });
  await call('POST', '/api/demo/load');

  // ---- review inbox
  const dash = (await call('GET', '/api/dashboard')).body;
  check('dashboard has review count', dash.review > 0, dash.review);
  const inbox = (await call('GET', '/api/transactions?review=1&limit=1000')).body;
  check('inbox lists only recent unreviewed', inbox.total.n === dash.review && inbox.rows.every(t => !t.reviewed), inbox.total);
  const t30 = new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 10);
  check('old history is not in the inbox', inbox.rows.every(t => t.date >= t30));
  const first = inbox.rows[0];
  check('mark some reviewed', (await call('POST', '/api/transactions/review', { ids: [first.id] })).body.changed === 1);
  check('count drops by one', (await call('GET', '/api/dashboard')).body.review === dash.review - 1);
  check('mark unreviewed again', (await call('POST', '/api/transactions/review', { ids: [first.id], reviewed: false })).body.changed === 1);

  // ---- tags
  await call('PATCH', `/api/transactions/${first.id}`, { tags: ' #Vacation, work trip,vacation, ,' + 'x'.repeat(50) });
  let t = (await call('GET', `/api/transactions/${first.id}`)).body;
  check('tags normalised and deduped', t.tags === `,Vacation,work trip,${'x'.repeat(30)},`, t.tags);
  check('tag-only edit does not mark reviewed', t.reviewed === 0);
  check('tag-only edit keeps auto category', t.user_category === 0, t.user_category);
  await call('PATCH', `/api/transactions/${first.id}`, { tags: ['Vacation'], reviewed: true });
  t = (await call('GET', `/api/transactions/${first.id}`)).body;
  check('tags from array + reviewed flag', t.tags === ',Vacation,' && t.reviewed === 1);
  const tags = (await call('GET', '/api/tags')).body;
  check('tag list', tags.length === 1 && tags[0].name === 'Vacation' && tags[0].count === 1, tags);
  check('filter by tag', (await call('GET', '/api/transactions?tag=Vacation')).body.total.n === 1);
  check('tag filter is exact', (await call('GET', '/api/transactions?tag=Vacat')).body.total.n === 0);
  await call('PATCH', `/api/transactions/${first.id}`, { tags: '' });
  check('clearing tags', (await call('GET', `/api/transactions/${first.id}`)).body.tags === null);
  await call('PATCH', `/api/transactions/${first.id}`, { tags: 'Vacation' });
  check('mark all reviewed', (await call('POST', '/api/transactions/review', { all: true })).body.changed === dash.review - 1);
  check('inbox empty', (await call('GET', '/api/dashboard')).body.review === 0);

  // ---- receipts
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const up = await call('POST', `/api/transactions/${first.id}/attachments`, { filename: '../../evil<>.png', data: 'data:image/png;base64,' + png.toString('base64') });
  check('upload receipt', up.status === 200 && up.body.mime === 'image/png', up.body);
  check('filename sanitised', !/[\\/<>]/.test(up.body.filename), up.body.filename);
  const fake = await call('POST', `/api/transactions/${first.id}/attachments`, { filename: 'x.png', data: Buffer.from('<script>alert(1)</script>').toString('base64') });
  check('rejects non-image disguised as png', fake.status === 400, fake.body);
  const pdf = await call('POST', `/api/transactions/${first.id}/attachments`, { filename: 'invoice.pdf', data: Buffer.from('%PDF-1.4\n%fake\n').toString('base64') });
  check('accepts pdf', pdf.status === 200 && pdf.body.mime === 'application/pdf');
  const list = (await call('GET', `/api/transactions/${first.id}/attachments`)).body;
  check('lists attachments', list.length === 2);
  const got = await call('GET', `/api/attachments/${up.body.id}`);
  check('serves the file back', got.status === 200 && got.body.equals(png) && got.headers.get('content-type') === 'image/png');
  check('file served with strict CSP', /sandbox/.test(got.headers.get('content-security-policy')));
  check('row shows attachment count', (await call('GET', '/api/transactions?tag=Vacation')).body.rows[0].att === 2);
  const dir = path.join(process.env.PP_DATA, 'receipts');
  check('files on disk', fs.readdirSync(dir).length === 2);
  await call('DELETE', `/api/attachments/${pdf.body.id}`);
  check('delete one attachment removes file', fs.readdirSync(dir).length === 1);
  await call('DELETE', `/api/transactions/${first.id}`);
  check('deleting transaction removes its files', fs.readdirSync(dir).length === 0);
  check('attachment gone', (await call('GET', `/api/attachments/${up.body.id}`)).status === 404);
  check('needs login', (await fetch(`${base}/api/attachments/1`)).status === 401);

  // ---- reports
  const m = new Date().toISOString().slice(0, 7);
  const prevM = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
  const monthRep = (await call('GET', `/api/report?month=${prevM}`)).body;
  const lastDay = new Date(Number(prevM.slice(0, 4)), Number(prevM.slice(5)), 0).getDate();
  const rr = (await call('GET', `/api/reports/range?from=${prevM}-01&to=${prevM}-${lastDay}`)).body;
  check('range totals match monthly report', near(rr.totals.spending, monthRep.totals.spending) && near(rr.totals.income, monthRep.totals.income), [rr.totals, monthRep.totals]);
  check('groups add up to spending', near(rr.groups.reduce((s, g) => s + g.total, 0), rr.totals.spending, 0.05));
  const sk = rr.sankey;
  const left = sk.income.reduce((s, x) => s + x.total, 0) + sk.fromSavings, right = sk.groups.reduce((s, x) => s + x.total, 0) + sk.saved;
  check('cash-flow diagram balances', near(left, right, 0.05), [left, right]);
  check('groups have categories', sk.groups.every(g => near(g.children.reduce((s, c) => s + c.total, 0), g.total, 0.05)));
  check('previous period same length', rr.prev.to < rr.from);
  const byMerchant = (await call('GET', `/api/reports/range?from=${prevM}-01&to=${prevM}-${lastDay}&groupBy=merchant`)).body;
  check('group by merchant', byMerchant.groups.length > 3 && near(byMerchant.groups.reduce((s, g) => s + g.total, 0), rr.totals.spending, 0.05));
  const ytd = (await call('GET', `/api/reports/range?from=${m.slice(0, 4)}-01-01&groupBy=group`)).body;
  check('ytd monthly trend', ytd.monthly.length === Number(m.slice(5)) && ytd.groups.length > 2, ytd.monthly.length);
  check('bad range rejected', (await call('GET', '/api/reports/range?from=2025-05-01&to=2025-01-01')).status === 400);
  const yr = (await call('GET', '/api/reports/year')).body;
  check('year in review', yr.topCategories.length > 0 && yr.topMerchants.length > 0 && yr.biggest && yr.regular && yr.months.length >= 1, Object.keys(yr));
  check('year subscriptions counted', yr.subscriptions > 0, yr.subscriptions);
  check('no-spend days sensible', yr.noSpendDays >= 0 && yr.noSpendDays < yr.days);

  // ---- budgets: left to assign
  const bud = (await call('GET', '/api/budgets')).body;
  check('budgets report income + planned income', bud.income >= 0 && bud.plannedIncome > 0, [bud.income, bud.plannedIncome]);

  // ---- debt planner (unit)
  const one = plans.simulate([{ id: 1, name: 'A', balance: 1000, apr: 12, min: 100 }], 'avalanche', 0);
  check('single debt payoff months', one.months === 11, one.months);
  check('single debt interest', near(one.totalInterest, 58.98, 1), one.totalInterest);
  const two = [{ id: 1, name: 'Card', balance: 5000, apr: 24, min: 150 }, { id: 2, name: 'Small', balance: 800, apr: 6, min: 30 }];
  const av = plans.simulate(two, 'avalanche', 200), sn = plans.simulate(two, 'snowball', 200), mn = plans.simulate(two, 'minimum', 0);
  check('avalanche saves interest vs snowball', av.totalInterest <= sn.totalInterest, [av.totalInterest, sn.totalInterest]);
  check('snowball clears smallest first', sn.debts.find(d => d.id === 2).paidOffMonth < sn.debts.find(d => d.id === 1).paidOffMonth);
  check('minimum-only costs more', mn.totalInterest > av.totalInterest && mn.months > av.months);
  check('never-pays-off detected', plans.simulate([{ id: 1, name: 'X', balance: 10000, apr: 30, min: 100 }], 'minimum', 0).neverPaysOff === true);

  // ---- debt planner (API, demo card + auto loan)
  let dp = (await call('GET', '/api/plans/debt')).body;
  check('demo debts listed', dp.debts.length >= 2 && dp.avalanche.months > 0, dp.debts);
  const card = dp.debts.find(d => d.type === 'credit');
  check('card APR from bank data', card.apr === 24.99 && !card.aprEstimated);
  const moreExtra = (await call('GET', '/api/plans/debt?extra=1000')).body;
  check('more extra pays off sooner', moreExtra.avalanche.months < dp.avalanche.months);
  dp = (await call('PUT', '/api/plans/debt', { extra: 250, strategy: 'snowball', overrides: { [card.id]: { apr: 19.5, min: 80 } } })).body;
  check('saved plan + overrides', dp.extra === 250 && dp.strategy === 'snowball' && dp.debts.find(d => d.id === card.id).apr === 19.5 && dp.chosen.strategy === 'snowball');
  dp = (await call('PUT', '/api/plans/debt', { overrides: { [card.id]: { apr: '' } } })).body;
  check('clearing override restores bank APR', dp.debts.find(d => d.id === card.id).apr === 24.99);

  // ---- retirement
  let rp = (await call('GET', '/api/plans/retire')).body;
  check('retire defaults from data', rp.inputs.current > 0 && rp.inputs.spendYear > 0, rp.defaults);
  check('FI number = spending / 4%', near(rp.fiNumber, rp.inputs.spendYear / 0.04, 1));
  check('success rate in range', rp.successRate >= 0 && rp.successRate <= 100);
  check('bands cover every year', rp.bands.length === rp.inputs.lifeAge - rp.inputs.age + 1);
  const again = (await call('GET', '/api/plans/retire')).body;
  check('monte carlo is stable', again.successRate === rp.successRate);
  const custom = (await call('POST', '/api/plans/retire/preview', { age: 30, retireAge: 60, current: 50000, monthly: 0, spendYear: 40000, returnPct: 7, inflation: 3, swr: 4 })).body;
  const hit = (await call('POST', '/api/plans/retire/preview', { age: 30, retireAge: 60, current: 50000, monthly: custom.neededMonthly + 1, spendYear: 40000, returnPct: 7, inflation: 3, swr: 4 })).body;
  check('needed monthly reaches FI by retirement', hit.atRetire >= hit.fiNumber - 50 && hit.fiAge <= 60, [hit.atRetire, hit.fiNumber, hit.fiAge]);
  check('preview does not save', (await call('GET', '/api/plans/retire')).body.inputs.age === rp.inputs.age);
  rp = (await call('PUT', '/api/plans/retire', { age: 41, other: 12000 })).body;
  check('saved retire inputs', rp.inputs.age === 41 && near(rp.fiNumber, (rp.inputs.spendYear - 12000) / 0.04, 1));
  check('bad inputs clamped', (await call('POST', '/api/plans/retire/preview', { age: 80, retireAge: 50, swr: 50 })).body.inputs.retireAge === 81);

  // ---- quick bank logins (dashboard)
  check('no bank logins until you add one', JSON.stringify((await call('GET', '/api/settings')).body.quick_logins) === '[]');
  await call('PUT', '/api/settings', { quick_logins: ['bmo-us', 'chase', 'bad id!<', 'x'.repeat(40)] });
  check('quick logins saved + filtered', JSON.stringify((await call('GET', '/api/settings')).body.quick_logins) === '["bmo-us","chase"]');

  srv.close();
  console.log(`\n${ok} premium checks passed`);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
