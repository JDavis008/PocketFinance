// End-to-end API check against a throwaway database: node test/smoke.js
const os = require('os'), fs = require('fs'), path = require('path'), assert = require('assert');
process.env.PP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-test-'));
const app = require('../server/index.js');

(async () => {
  const srv = app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-PP': '1', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
  };
  let ok = 0; const check = (name, cond, extra) => { assert.ok(cond, name + (extra ? ' ' + JSON.stringify(extra).slice(0, 400) : '')); ok++; console.log('  ✓', name); };

  check('needs setup', (await call('GET', '/api/auth/status')).body.setup === false);
  check('api locked', (await call('GET', '/api/dashboard')).status === 401);
  check('setup', (await call('POST', '/api/auth/setup', { password: 'correct horse' })).status === 200);
  check('csrf header required', (await fetch(base + '/api/demo/load', { method: 'POST', headers: { cookie } })).status === 403);
  check('demo load', (await call('POST', '/api/demo/load')).status === 200);

  const d = (await call('GET', '/api/dashboard')).body;
  check('net worth computed', d.accounts.netWorth > 10000, d.accounts);
  check('spending this month', d.thisMonth.spending > 0, d.thisMonth);
  check('budgets present', d.budgets.list.length === 8);
  check('forecast points', d.forecast.points.length === 31);

  const rec = (await call('GET', '/api/recurring')).body;
  const names = rec.rows.filter(r => r.status === 'active').map(r => `${r.name}:${r.cadence}:${r.kind}`);
  console.log('    recurring:', names.join(' | '));
  for (const n of ['Netflix', 'Spotify', 'Hulu', 'Verizon', 'Xfinity', 'GEICO', 'Paycheck', 'Apple', 'Planet Fitness']) check(`detected ${n}`, rec.rows.some(r => r.name === n && r.status === 'active'), names);
  check('paycheck biweekly', rec.rows.find(r => r.name === 'Paycheck').cadence === 'biweekly');
  check('amazon prime annual', rec.rows.some(r => r.name === 'Amazon Prime' && r.cadence === 'annual'), names);
  check('netflix price increase noticed', rec.rows.find(r => r.name === 'Netflix').prev_amount === 15.49);
  check('netflix cancel link', !!rec.rows.find(r => r.name === 'Netflix').cancel);
  check('upcoming list', rec.upcoming.length > 5);

  const tx = (await call('GET', '/api/transactions?limit=5&q=kroger')).body;
  check('search transactions', tx.rows.length > 0 && tx.rows.every(r => r.merchant === 'Kroger'), tx.rows.map(r => r.merchant));
  const one = tx.rows[0];
  check('recategorize w/ rule', (await call('PATCH', `/api/transactions/${one.id}`, { category: 'Shopping', applyToAll: true })).body.applied > 0);
  check('rule stored', (await call('GET', '/api/rules')).body.length === 1);

  const split = (await call('GET', '/api/transactions?limit=1&q=target')).body.rows[0];
  const amt = Math.abs(split.amount);
  check('split', (await call('POST', `/api/transactions/${split.id}/split`, { parts: [{ amount: (amt - 10).toFixed(2), category: 'Groceries' }, { amount: '10', category: 'Shopping' }] })).status === 200);

  const csv = 'Date,Description,Amount\n11/01/2026,"NETFLIX.COM",-17.99\n11/02/2026,"PAYROLL DIRECT DEP",2000.00\n11/03/2026,"SHELL OIL 1234",-40.12\n';
  const pv = (await call('POST', '/api/import/preview', { filename: 'bank.csv', content: csv })).body;
  check('csv preview', pv.count === 3 && pv.sample[0].amount === -17.99, pv);
  const cm = (await call('POST', '/api/import/commit', { filename: 'bank.csv', content: csv, newAccountName: 'Credit Union' })).body;
  check('csv import', cm.added === 3, cm);
  check('csv re-import dedupes', (await call('POST', '/api/import/commit', { filename: 'bank.csv', content: csv, newAccountName: 'Credit Union' })).body.added === 0);

  const mint = 'Date,Description,Original Description,Amount,Transaction Type,Category,Account Name,Labels,Notes\n10/05/2026,Starbucks,STARBUCKS 123,5.25,debit,Coffee Shops,Mint Card,,\n10/06/2026,Employer,ACME PAYROLL,1500,credit,Paycheck,Mint Checking,,\n';
  const mp = (await call('POST', '/api/import/preview', { filename: 'mint.csv', content: mint })).body;
  check('mint preset', mp.preset === 'mint' && mp.sample[0].amount === -5.25 && mp.sample[1].amount === 1500, mp);

  const ofx = `OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>1<ACCTID>99887766</BANKACCTFROM><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261101120000<TRNAMT>-12.50<FITID>A1<NAME>CHIPOTLE 2231</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261102<TRNAMT>100.00<FITID>A2<NAME>ZELLE FROM BOB</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>1234.56<DTASOF>20261103</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  const op = (await call('POST', '/api/import/commit', { filename: 'stmt.qfx', content: ofx })).body;
  check('ofx import', op.added === 2, op);

  check('manual asset', (await call('POST', '/api/accounts', { name: 'House', type: 'property', balance: 350000 })).status === 200);
  check('net worth up', (await call('GET', '/api/networth')).body.summary.property >= 350000);
  check('report', (await call('GET', '/api/report')).body.cashflow.length === 12);
  check('budget suggest', (await call('POST', '/api/budgets/suggest')).body.length > 3);
  check('goals', (await call('GET', '/api/goals')).body.length === 2);
  check('credit', (await call('GET', '/api/credit')).body.scores.length === 5);
  check('negotiation candidates', (await call('GET', '/api/negotiations')).body.candidates.length > 2);
  check('alerts generated', (await call('GET', '/api/alerts')).body.length > 0);
  const cal = (await call('GET', '/api/calendar')).body.url;
  check('ics feed', (await fetch(base + cal).then(r => r.text())).includes('BEGIN:VEVENT'));
  check('csv export', (await call('GET', '/api/export/transactions.csv')).body.startsWith('Date,Account'));
  check('demo clear', (await call('POST', '/api/demo/clear')).status === 200);
  check('demo gone', !(await call('GET', '/api/accounts')).body.accounts.some(a => a.name === 'Everyday Checking'));
  check('web app served', (await fetch(base + '/').then(r => r.text())).includes('<title>'));

  console.log(`\n${ok} checks passed`);
  srv.close(); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
