// Staying signed in, phones that sign in automatically, email codes and "Forgot password": node test/login.js
const os = require('os'), fs = require('fs'), path = require('path'), assert = require('assert');
process.env.PP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-login-'));
const OUTBOX = path.join(process.env.PP_DATA, 'outbox');
const app = require('../server/index.js');
const { db } = require('../server/db');

(async () => {
  const srv = app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const client = () => {
    let cookie = '';
    const c = async (method, url, body) => {
      const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-PP': '1', cookie }, body: body ? JSON.stringify(body) : undefined });
      const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
      const ct = r.headers.get('content-type') || '';
      return { status: r.status, setCookie: sc, body: ct.includes('json') ? await r.json() : await r.text() };
    };
    c.cookie = () => cookie;
    return c;
  };
  const call = client();
  let ok = 0; const check = (name, cond, extra) => { assert.ok(cond, name + (extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 400) : '')); ok++; console.log('  ✓', name); };
  const mails = () => fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX).sort().map(f => JSON.parse(fs.readFileSync(path.join(OUTBOX, f), 'utf8'))) : [];
  const lastCode = to => { const m = mails().filter(x => x.to === to).pop(); return m && (m.text.match(/\b(\d{6})\b/) || [])[1]; };

  await call('POST', '/api/auth/setup', { password: 'owner-pass-1', email: 'Owner@Example.com' });

  // ---- sessions last 90 days and renew themselves
  check('session cookie lasts 90 days', /Max-Age=7776000/.test((await client()('POST', '/api/auth/login', { password: 'owner-pass-1' })).setCookie || ''));
  const sid = call.cookie().split('=')[1];
  db.prepare('UPDATE sessions SET expires=? WHERE id=?').run(Date.now() + 5 * 864e5, sid);
  const used = await call('GET', '/api/accounts');
  const exp = db.prepare('SELECT expires FROM sessions WHERE id=?').get(sid).expires;
  check('using the app renews the session', used.status === 200 && exp > Date.now() + 89 * 864e5 && /Max-Age=7776000/.test(used.setCookie || ''));

  // ---- the phone app's device key
  const phone = client();
  await phone('POST', '/api/auth/login', { password: 'owner-pass-1' });
  const dev = (await phone('POST', '/api/auth/device', { name: 'Galaxy S24 Ultra' })).body;
  const hello = await (await fetch(base + '/api/hello')).json();
  check('device key issued for this server', /^[a-f0-9]{64}$/.test(dev.token) && dev.server === hello.id && /^[a-f0-9]{24}$/.test(hello.id), dev);
  check('key is not stored in plain text', !db.prepare('SELECT token_hash FROM devices').all().some(r => r.token_hash === dev.token));
  const fresh = client(); // e.g. the same phone reaching the PC by another address: no cookie yet
  check('no cookie = not signed in', (await fresh('GET', '/api/accounts')).status === 401);
  check('device key signs in', (await fresh('POST', '/api/auth/device-login', { token: dev.token })).status === 200 && (await fresh('GET', '/api/accounts')).status === 200);
  check('wrong key refused', (await client()('POST', '/api/auth/device-login', { token: 'a'.repeat(64) })).status === 401);
  check('owner sees remembered phones', (await call('GET', '/api/devices')).body.devices.some(d => d.name === 'Galaxy S24 Ultra'));
  await fresh('POST', '/api/auth/logout', { device_token: dev.token });
  check('signing out forgets the key', (await client()('POST', '/api/auth/device-login', { token: dev.token })).status === 401);
  const dev2 = (await phone('POST', '/api/auth/device', { name: 'Phone 2' })).body;
  const d2 = (await call('GET', '/api/devices')).body.devices.find(d => d.name === 'Phone 2');
  await call('DELETE', `/api/devices/${d2.id}`);
  check('owner can remove a phone', (await client()('POST', '/api/auth/device-login', { token: dev2.token })).status === 401);

  // ---- email settings
  let st = (await call('GET', '/api/settings/email')).body;
  check('setup saved the owner email (lowercased)', st.owner_email === 'owner@example.com');
  const noMail = await client()('POST', '/api/auth/email-code', { email: 'owner@example.com', purpose: 'reset' });
  check('codes need email set up first', noMail.status === 400 && /set it up/i.test(noMail.body.error), noMail.body);
  st = (await call('PUT', '/api/settings/email', { smtp: { host: 'smtp.gmail.com', port: 465, user: 'me@gmail.com', pass: 'abcd efgh ijkl mnop' } })).body;
  check('mail account saved, password never sent back', st.configured && st.has_password && !('pass' in st) && st.host === 'smtp.gmail.com');
  check('mail password encrypted at rest', !JSON.stringify(db.prepare("SELECT value FROM settings WHERE key='smtp'").get()).includes('abcdefghijklmnop'));
  check('bad server name rejected', (await call('PUT', '/api/settings/email', { smtp: { host: 'smtp gmail', user: 'me@gmail.com' } })).status === 400);
  process.env.PP_MAIL_OUTBOX = OUTBOX; // from here on, mail is written to a folder instead of sent

  // ---- forgot password
  const anon = client();
  const req1 = await anon('POST', '/api/auth/email-code', { email: ' OWNER@example.com ', purpose: 'reset' });
  const code = lastCode('owner@example.com');
  check('code emailed', req1.status === 200 && /^\d{6}$/.test(code), mails());
  check('unknown email gets the same answer, no email', (await anon('POST', '/api/auth/email-code', { email: 'nobody@example.com' })).body.sent === true && !mails().some(m => m.to === 'nobody@example.com'));
  const wrongCode = code === '000000' ? '111111' : '000000';
  check('wrong code refused', (await anon('POST', '/api/auth/email-login', { email: 'owner@example.com', code: wrongCode, password: 'brand-new-pass' })).status === 401);
  check('short new password refused', (await anon('POST', '/api/auth/email-login', { email: 'owner@example.com', code, password: 'short' })).status === 400);
  const reset = await anon('POST', '/api/auth/email-login', { email: 'owner@example.com', code, password: 'brand-new-pass' });
  check('reset with the code signs you in', reset.status === 200 && reset.body.reset && (await anon('GET', '/api/accounts')).status === 200);
  check('old password no longer works', (await client()('POST', '/api/auth/login', { password: 'owner-pass-1' })).status === 401);
  check('new password works', (await client()('POST', '/api/auth/login', { password: 'brand-new-pass' })).status === 200);
  check('other sessions signed out after a reset', (await call('GET', '/api/accounts')).status === 401);
  check('code works only once', (await client()('POST', '/api/auth/email-login', { email: 'owner@example.com', code })).status === 401);

  // ---- email sign-in code (no password change)
  const owner = client();
  await owner('POST', '/api/auth/email-code', { email: 'owner@example.com', purpose: 'login' });
  check('sign in with an emailed code', (await owner('POST', '/api/auth/email-login', { email: 'owner@example.com', code: lastCode('owner@example.com') })).status === 200 && (await owner('GET', '/api/accounts')).status === 200);

  // ---- too many wrong tries burns the code
  await anon('POST', '/api/auth/email-code', { email: 'owner@example.com', purpose: 'login' });
  const good = lastCode('owner@example.com');
  for (let i = 0; i < 4; i++) await client()('POST', '/api/auth/email-login', { email: 'owner@example.com', code: good === '123456' ? '654321' : '123456' });
  // (the IP throttle kicks in after 5 failures, so use a different route to the server for the last try)
  db.prepare('UPDATE auth_codes SET tries=5').run();
  check('code dead after 5 wrong tries', (await client()('POST', '/api/auth/email-login', { email: 'owner@example.com', code: good })).status !== 200);
  await new Promise(r => setTimeout(r, 10));

  // ---- household member with an email
  const add = await owner('POST', '/api/members', { name: 'Sam', password: 'sam-pass-123', role: 'full', email: 'sam@example.com' });
  check('member added with email', add.status === 200 && (await owner('GET', '/api/members')).body.members.find(m => m.name === 'Sam').email === 'sam@example.com');
  check('member list never includes password hashes', !JSON.stringify((await owner('GET', '/api/members')).body).includes('scrypt') && !('hash' in (await owner('GET', '/api/members')).body.members[0]));
  check('emails must be unique', (await owner('POST', '/api/members', { name: 'X', password: 'x-pass-1234', email: 'owner@example.com' })).status === 400 && !(await owner('GET', '/api/members')).body.members.some(m => m.name === 'X'));
  check('change a member email', (await owner('PATCH', `/api/members/${add.body.id}`, { email: 'sam2@example.com' })).status === 200);

  srv.close();
  console.log(`\n${ok} sign-in checks passed`);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
