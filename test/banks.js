// Bank file formats + Teller connector (against a fake Teller API): node test/banks.js
const http = require('http'), os = require('os'), fs = require('fs'), path = require('path'), assert = require('assert');

let ok = 0; const check = (n, c, x) => { assert.ok(c, n + (x ? ' ' + JSON.stringify(x).slice(0, 400) : '')); ok++; console.log('  ✓', n); };

// ---------- file formats ----------
const { parseFile } = require('../server/integrations/importers');
const F = {
  'chase-card': ['Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
    '01/14/2026,01/15/2026,STARBUCKS STORE 123,Food & Drink,Sale,-6.45,', '01/20/2026,01/20/2026,Payment Thank You-Mobile,,Payment,500.00,'],
  'chase-bank': ['Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #,',
    'DEBIT,01/14/2026,"SHELL OIL 5744",-42.10,DEBIT_CARD,1234.50,,', 'CREDIT,01/15/2026,"ACME CORP PAYROLL PPD ID: 123",2150.00,ACH_CREDIT,3384.50,,'],
  boa: ['Description,,Summary Amt.', 'Beginning balance as of 01/01/2026,,"1,000.00"', 'Total credits,,"2,150.00"', '',
    'Date,Description,Amount,Running Bal.', '01/01/2026,Beginning balance as of 01/01/2026,,"1,000.00"',
    '01/14/2026,"NETFLIX.COM DES:PURCHASE","-15.49","984.51"', '01/15/2026,"ACME PAYROLL DES:PAYROLL","2,150.00","3,134.51"'],
  wells: ['"01/14/2026","-23.45","*","","PURCHASE AUTHORIZED ON 01/13 KROGER #123"', '"01/15/2026","2150.00","*","","ACME PAYROLL"'],
  capone: ['Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit',
    '2026-01-14,2026-01-15,1234,AMAZON.COM,Merchandise,54.99,', '2026-01-20,2026-01-20,1234,CAPITAL ONE AUTOPAY PYMT,Payment/Credit,,300.00'],
  discover: ['Trans. Date,Post Date,Description,Amount,Category', '01/14/2026,01/14/2026,TARGET 00012345,61.20,Merchandise', '01/20/2026,01/20/2026,INTERNET PAYMENT - THANK YOU,-200.00,Payments and Credits'],
  amex: ['Date,Description,Card Member,Account #,Amount', '01/14/2026,DELTA AIR LINES,J DOE,-41004,412.30', '01/20/2026,AUTOPAY PAYMENT - THANK YOU,J DOE,-41004,-412.30'],
  amexPlain: ['Date,Description,Amount', '01/14/2026,UBER TRIP,18.40', '01/20/2026,PAYMENT RECEIVED,-18.40'],
  citi: ['Status,Date,Description,Debit,Credit', 'Cleared,01/14/2026,"COSTCO WHSE #123",88.10,', 'Cleared,01/20/2026,"ONLINE PAYMENT, THANK YOU",,-88.10'],
  bmoBank: ['Following data is valid as of 20260120103000 (Year/Month/Day/Hour/Minute/Second)', '', '',
    'First Bank Card,Transaction Type,Date Posted, Transaction Amount,Description', '',
    "'5191230012345678',DEBIT,20260114,-45.67,[DN]TIM HORTONS #1234", "'5191230012345678',CREDIT,20260115,2150.00,[DD]ACME PAYROLL"],
  bmoCard: ['Following data is valid as of 20260120', '', 'Item #,Card #,Transaction Date,Posting Date,Transaction Amount,Description',
    "1,'5191230099998888',20260114,20260115,32.10,LOBLAWS 1234 TORONTO ON", "2,'5191230099998888',20260118,20260118,-500.00,PAYMENT RECEIVED - THANK YOU"],
  bmoUS: ['Posted Date,Description,Amount,Transaction Type', '01/14/2026,ZELLE PAYMENT TO JOHN,-75.00,Debit', '01/15/2026,DIRECT DEP ACME,2150.00,Credit'],
  rbc: ['"Account Type","Account Number","Transaction Date","Cheque Number","Description 1","Description 2","CAD$","USD$"',
    'Chequing,01234-5678901,1/14/2026,,"POS PURCHASE","SOBEYS #123",-54.20,', 'Chequing,01234-5678901,1/15/2026,,"PAYROLL DEPOSIT","ACME",2150.00,'],
  td: ['01/14/2026,TIM HORTONS #12,4.35,,1995.65', '01/15/2026,ACME PAYROLL,,2150.00,4145.65'],
  cibc: ['2026-01-14,"Point of Sale - Interac RETAIL PURCHASE METRO",54.20,', '2026-01-15,"PAYROLL DEPOSIT ACME",,2150.00'],
  usbank: ['"Date","Transaction","Name","Memo","Amount"', '"2026-01-14","DEBIT","DEBIT PURCHASE -VISA HY-VEE","Download from usbank.com.","-31.4000"', '"2026-01-15","CREDIT","ACME PAYROLL","Download from usbank.com.","2150.0000"'],
};
const parse = (k, opts) => parseFile(k + '.csv', F[k].join('\r\n'), opts || {});
const amounts = p => p.rows.map(r => r.amount);
const dates = p => p.rows.map(r => r.date);

let p = parse('chase-card'); check('Chase card: purchase negative, payment positive', p.preset === 'chase-card' && amounts(p).join() === '-6.45,500', p);
p = parse('chase-bank'); check('Chase checking', p.preset === 'chase-bank' && amounts(p).join() === '-42.1,2150', p);
p = parse('boa'); check('Bank of America (summary lines skipped)', amounts(p).join() === '-15.49,2150' && dates(p)[0] === '2026-01-14', p);
p = parse('wells'); check('Wells Fargo (no header row)', amounts(p).join() === '-23.45,2150' && /KROGER/.test(p.rows[0].description), p);
p = parse('capone'); check('Capital One card debit/credit columns', p.preset === 'capitalone-card' && amounts(p).join() === '-54.99,300', p);
p = parse('discover'); check('Discover: positive = purchase', p.preset === 'discover' && amounts(p).join() === '-61.2,200', p);
p = parse('amex'); check('Amex: positive = purchase', p.preset === 'amex' && amounts(p).join() === '-412.3,412.3', p);
p = parse('amexPlain', { bank: 'amex' }); check('Amex 3-column file flipped via bank hint', amounts(p).join() === '-18.4,18.4', p);
p = parse('citi'); check('Citi debit/credit', amounts(p).join() === '-88.1,88.1', p);
p = parse('bmoBank'); check('BMO bank account (preamble, YYYYMMDD dates)', p.preset === 'bmo-ca-bank' && amounts(p).join() === '-45.67,2150' && dates(p).join() === '2026-01-14,2026-01-15' && p.rows[0].description === 'TIM HORTONS #1234', p);
p = parse('bmoCard'); check('BMO Mastercard: positive = purchase', p.preset === 'bmo-ca-card' && amounts(p).join() === '-32.1,500' && dates(p)[0] === '2026-01-14', p);
p = parse('bmoUS'); check('BMO (US) CSV', amounts(p).join() === '-75,2150', p);
p = parse('rbc'); check('RBC Description 1 + 2 and CAD$', p.preset === 'rbc' && amounts(p).join() === '-54.2,2150' && p.rows[0].description === 'POS PURCHASE SOBEYS #123', p);
p = parse('td'); check('TD Canada Trust (no header, withdrawal/deposit)', amounts(p).join() === '-4.35,2150' && /TIM HORTONS/.test(p.rows[0].description), p);
p = parse('cibc'); check('CIBC (no header, ISO dates)', amounts(p).join() === '-54.2,2150', p);
p = parse('usbank'); check('US Bank', amounts(p).join() === '-31.4,2150' && /HY-VEE/.test(p.rows[0].description), p);

// ---------- Teller connector against a fake API ----------
function mockTeller() {
  const seen = [];
  const srv = http.createServer((req, res) => {
    const auth = Buffer.from((req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString();
    seen.push(req.method + ' ' + req.url);
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (auth === 'token_expired:') return send(404, { error: { code: 'enrollment.disconnected.user_action.mfa_required', message: 'MFA required' } });
    if (auth !== 'token_good:') return send(401, { error: { code: 'unauthorized', message: 'bad token' } });
    const u = new URL(req.url, 'http://x');
    if (req.method === 'DELETE') return send(204, null);
    if (u.pathname === '/accounts') return send(200, [
      { id: 'acc_chk', enrollment_id: 'enr_1', name: 'Total Checking', type: 'depository', subtype: 'checking', last_four: '7781', currency: 'USD', status: 'open', institution: { id: 'chase', name: 'Chase' }, links: { balances: 'x', transactions: 'x' } },
      { id: 'acc_cc', enrollment_id: 'enr_1', name: 'Sapphire Preferred', type: 'credit', subtype: 'credit_card', last_four: '4410', currency: 'USD', status: 'open', institution: { id: 'chase', name: 'Chase' }, links: { balances: 'x', transactions: 'x' } },
      { id: 'acc_old', enrollment_id: 'enr_1', name: 'Old Savings', type: 'depository', subtype: 'savings', last_four: '0001', currency: 'USD', status: 'closed', institution: { id: 'chase', name: 'Chase' }, links: {} }]);
    if (u.pathname === '/accounts/acc_chk/balances') return send(200, { account_id: 'acc_chk', available: '2310.55', ledger: '2400.10' });
    if (u.pathname === '/accounts/acc_cc/balances') return send(200, { account_id: 'acc_cc', available: '8765.43', ledger: '1234.57' });
    const d = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
    if (u.pathname === '/accounts/acc_chk/transactions') {
      // two pages: newest first
      const all = Array.from({ length: 300 }, (_, i) => ({ id: 'txn_c' + i, account_id: 'acc_chk', amount: i % 10 === 0 ? '2150.00' : '-12.34', date: d(i), description: i % 10 === 0 ? 'ACME PAYROLL' : 'WHOLEFDS MKT 10234', status: i === 1 ? 'pending' : 'posted', type: 'card_payment', details: { category: i % 10 === 0 ? 'income' : 'groceries', counterparty: { name: i % 10 === 0 ? 'ACME' : 'Whole Foods', type: 'organization' } } }));
      const from = u.searchParams.get('from_id'), count = Number(u.searchParams.get('count'));
      const start = from ? all.findIndex(t => t.id === from) + 1 : 0;
      return send(200, all.slice(start, start + count).filter(t => t.date >= u.searchParams.get('start_date')));
    }
    if (u.pathname === '/accounts/acc_cc/transactions') return send(200, [
      { id: 'txn_k1', amount: '86.20', date: d(2), description: 'SHELL OIL 1234', status: 'posted', type: 'card_payment', details: { category: 'fuel', counterparty: { name: 'Shell', type: 'organization' } } },
      { id: 'txn_k2', amount: '15.49', date: d(5), description: 'NETFLIX.COM', status: 'posted', type: 'card_payment', details: { category: 'entertainment', counterparty: { name: 'Netflix', type: 'organization' } } },
      { id: 'txn_k3', amount: '-500.00', date: d(8), description: 'AUTOMATIC PAYMENT - THANK YOU', status: 'posted', type: 'payment', details: { category: null, counterparty: { name: null, type: null } } }]);
    send(404, { error: { code: 'not_found', message: 'nope' } });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, seen, port: srv.address().port })));
}

(async () => {
  const mock = await mockTeller();
  process.env.PP_TELLER_BASE = `http://127.0.0.1:${mock.port}`;
  process.env.PP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-bank-'));
  const app = require('../server/index.js');
  const srv = app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-PP': '1', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  await call('POST', '/api/auth/setup', { password: 'correct horse' });

  check('Teller not configured yet', (await call('GET', '/api/teller/status')).body.configured === false);
  check('bad certificate rejected', (await call('PUT', '/api/teller/settings', { application_id: 'app_x', cert: 'nope', key: 'nope' })).status === 400);
  const st = (await call('PUT', '/api/teller/settings', { application_id: 'app_test123', env: 'development' })).body;
  check('Teller settings saved', st.configured && st.env === 'development' && st.application_id === 'app_test123' && !st.has_cert, st);
  check('bad token reports an error', (await call('POST', '/api/teller/enroll', { accessToken: 'token_bad', enrollment: { id: 'enr_x', institution: { name: 'Chase' } } })).status >= 400);
  const en = await call('POST', '/api/teller/enroll', { accessToken: 'token_good', enrollment: { id: 'enr_1', institution: { name: 'Chase' } } });
  check('enroll creates a connection', en.status === 200 && en.body.id, en.body);
  const acc = (await call('GET', '/api/accounts')).body;
  const chk = acc.accounts.find(a => a.name === 'Total Checking'), cc = acc.accounts.find(a => a.name === 'Sapphire Preferred');
  check('closed account skipped', !acc.accounts.find(a => a.name === 'Old Savings'));
  check('checking balance + mask', chk && chk.balance === 2400.1 && chk.mask === '7781' && chk.institution === 'Chase', chk);
  check('card owed + limit', cc && cc.type === 'credit' && cc.balance === 1234.57 && cc.credit_limit === 10000, cc);
  const tx = (await call('GET', `/api/transactions?account=${chk.id}&limit=500`)).body;
  const list = tx.transactions || tx.rows || tx;
  check('paged transactions all imported', list.length === 300, list.length);
  check('Teller categories mapped', list.some(t => t.category === 'Groceries') && list.some(t => t.amount === 2150), list.slice(0, 2));
  check('pending flagged', list.filter(t => t.pending).length === 1);
  const ctx = (await call('GET', `/api/transactions?account=${cc.id}`)).body; const cl = ctx.transactions || ctx.rows || ctx;
  check('card purchases normalised to money out', cl.find(t => /SHELL/.test(t.description)).amount === -86.2 && cl.find(t => /PAYMENT/.test(t.description)).amount === 500, cl.map(t => [t.description, t.amount]));
  const again = await call('POST', '/api/teller/enroll', { accessToken: 'token_good', enrollment: { id: 'enr_1', institution: { name: 'Chase' } } });
  check('re-linking the same bank reuses the connection', again.body.id === en.body.id && (await call('GET', '/api/accounts')).body.accounts.length === 2);
  check('enrollment id available for reconnect', (await call('GET', `/api/teller/enrollment/${en.body.id}`)).body.enrollmentId === 'enr_1');
  // expire the token -> needs reconnect
  const { db } = require('../server/db'); const { encrypt } = require('../server/security');
  db.prepare('UPDATE connections SET secret_enc=? WHERE id=?').run(encrypt({ access_token: 'token_expired', enrollment_id: 'enr_1' }), en.body.id);
  const s = (await call('POST', `/api/connections/${en.body.id}/sync`)).body;
  const conn = (await call('GET', '/api/accounts')).body.connections.find(c => c.id === en.body.id);
  check('disconnected bank asks to reconnect', !!s.error && conn.status === 'error' && /Reconnect/.test(conn.error), { s, conn });
  check('remove revokes at Teller', (await call('DELETE', `/api/connections/${en.body.id}`)).status === 200 && mock.seen.some(x => x.startsWith('DELETE /accounts')));

  console.log(`\n${ok} bank checks passed`);
  srv.close(); mock.srv.close(); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
