// Family: kids' allowance, chores, jars, money check-in, backup/restore, demo: node test/family.js
const os = require('os'), fs = require('fs'), path = require('path'), assert = require('assert');
process.env.PP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-family-'));
const app = require('../server/index.js');
const { db } = require('../server/db');
const { today, addDays, parseISO } = require('../server/util');

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
  const kids = async () => (await call('GET', '/api/kids')).body.kids;

  await call('POST', '/api/auth/setup', { password: 'owner-pass-1' });
  check('no kids at first', (await kids()).length === 0);

  // ---- add a kid: allowance starts today, nothing back-paid
  check('name required', (await call('POST', '/api/kids', { allowance: 5 })).status === 400);
  check('save + give over 100% rejected', (await call('POST', '/api/kids', { name: 'A', save_pct: 70, give_pct: 40 })).status === 400);
  const id = (await call('POST', '/api/kids', { name: '  Ava ', emoji: '🦄', allowance: 10, pay_day: 6, save_pct: 30, give_pct: 10, goal_name: 'Bike', goal_amount: 120, start_balance: 20 })).body.id;
  let k = (await kids()).find(x => x.id === id);
  check('kid added with trimmed name', k && k.name === 'Ava' && k.emoji === '🦄', k);
  check('starting balance split 60/30/10', k.jars.spend === 12 && k.jars.save === 6 && k.jars.give === 2, k.jars);
  check('no allowance back-paid', k.recent.every(r => r.kind !== 'allowance'));
  check('next payday is a Saturday after today', parseISO(k.next_payday).getDay() === 6 && k.next_payday > today(), k.next_payday);

  // ---- allowance catch-up: pretend the last payday was 3 weeks ago
  const lastSat = addDays(today(), -((parseISO(today()).getDay() + 1) % 7)); // most recent Saturday (today if Saturday)
  db.prepare('UPDATE kids SET last_paid=? WHERE id=?').run(addDays(lastSat, -21), id);
  k = (await kids()).find(x => x.id === id);
  const paid = k.recent.filter(r => r.kind === 'allowance');
  check('3 missed paydays paid', new Set(paid.map(r => r.date)).size === 3, paid.map(r => r.date));
  check('allowance split into jars', k.total === 20 + 30, k.total);
  check('last_paid moved to latest payday', k.last_paid === lastSat, k.last_paid);
  k = (await kids()).find(x => x.id === id);
  check('paying is idempotent', k.total === 50, k.total);
  db.prepare('UPDATE kids SET last_paid=? WHERE id=?').run(addDays(today(), -400), id);
  k = (await kids()).find(x => x.id === id);
  check('catch-up capped at 26 weeks', new Set(k.recent.filter(r => r.kind === 'allowance').map(r => r.date)).size >= 1 && k.total <= 50 + 26 * 10 + 0.001, k.total);
  const total0 = k.total;

  // ---- chores
  const daily = (await call('POST', `/api/kids/${id}/chores`, { name: 'Make bed', reward: 0.5, freq: 'daily' })).body.id;
  const once = (await call('POST', `/api/kids/${id}/chores`, { name: 'Wash car', reward: 5, freq: 'once' })).body.id;
  const unpaid = (await call('POST', `/api/kids/${id}/chores`, { name: 'Homework', reward: 0, freq: 'weekly' })).body.id;
  check('chore name required', (await call('POST', `/api/kids/${id}/chores`, { reward: 1 })).status === 400);
  check('chore done pays', (await call('POST', `/api/chores/${daily}/done`)).body.reward === 0.5);
  check('daily chore only once a day', (await call('POST', `/api/chores/${daily}/done`)).status === 400);
  k = (await kids()).find(x => x.id === id);
  check('balance went up 0.50', Math.abs(k.total - (total0 + 0.5)) < 1e-9, k.total);
  check('chore shows done', k.chores.find(c => c.id === daily).done === true);
  check('earned this week', k.earned_week === 0.5, k.earned_week);
  await call('POST', `/api/chores/${daily}/undo`);
  k = (await kids()).find(x => x.id === id);
  check('undo takes the money back', Math.abs(k.total - total0) < 1e-9 && !k.chores.find(c => c.id === daily).done, k.total);
  await call('POST', `/api/chores/${once}/done`);
  k = (await kids()).find(x => x.id === id);
  check('one-time chore disappears after done', !k.chores.some(c => c.id === once));
  await call('POST', `/api/chores/${unpaid}/done`);
  k = (await kids()).find(x => x.id === id);
  check('unpaid chore still marked done', k.chores.find(c => c.id === unpaid).done === true);
  check('edit chore', (await call('PATCH', `/api/chores/${daily}`, { reward: 1, freq: 'weekly' })).status === 200 && (await kids()).find(x => x.id === id).chores.find(c => c.id === daily).freq === 'weekly');
  await call('DELETE', `/api/chores/${unpaid}`);
  check('deleted chore hidden, money kept', !(await kids()).find(x => x.id === id).chores.some(c => c.id === unpaid));

  // ---- money in / out / move
  const before = (await kids()).find(x => x.id === id).jars;
  check('cannot overspend a jar', (await call('POST', `/api/kids/${id}/ledger`, { type: 'spend', jar: 'give', amount: 9999 })).status === 400);
  check('spend', (await call('POST', `/api/kids/${id}/ledger`, { type: 'spend', jar: 'spend', amount: 3, note: 'Book fair' })).status === 200);
  check('move', (await call('POST', `/api/kids/${id}/ledger`, { type: 'move', from: 'spend', to: 'save', amount: 2 })).status === 200);
  check('same-jar move rejected', (await call('POST', `/api/kids/${id}/ledger`, { type: 'move', from: 'save', to: 'save', amount: 1 })).status === 400);
  check('deposit into one jar', (await call('POST', `/api/kids/${id}/ledger`, { jar: 'give', amount: 4, note: 'Grandma' })).status === 200);
  check('zero amount rejected', (await call('POST', `/api/kids/${id}/ledger`, { amount: 0 })).status === 400);
  k = (await kids()).find(x => x.id === id);
  check('jars add up', Math.abs(k.jars.spend - (before.spend - 5)) < 1e-9 && Math.abs(k.jars.save - (before.save + 2)) < 1e-9 && Math.abs(k.jars.give - (before.give + 4)) < 1e-9, [before, k.jars]);
  const entry = k.recent.find(r => r.note === 'Grandma');
  await call('DELETE', `/api/kids/ledger/${entry.id}`);
  check('delete an entry', Math.abs((await kids()).find(x => x.id === id).jars.give - before.give) < 1e-9);

  // ---- edit: turning allowance on later never back-pays; changing payday restarts the count
  const id2 = (await call('POST', '/api/kids', { name: 'Ben', allowance: 0 })).body.id;
  db.prepare('UPDATE kids SET last_paid=? WHERE id=?').run(addDays(today(), -60), id2);
  await call('PATCH', `/api/kids/${id2}`, { allowance: 8 });
  check('allowance switched on later: no back pay', (await kids()).find(x => x.id === id2).total === 0);
  check('edit rejects >100%', (await call('PATCH', `/api/kids/${id2}`, { save_pct: 90, give_pct: 20 })).status === 400);

  // ---- view-only members can look but not change
  await call('POST', '/api/members', { name: 'Grandpa', password: 'grandpa-view', role: 'view' });
  const viewer = client(); await viewer('POST', '/api/auth/login', { password: 'grandpa-view' });
  check('view-only sees kids', (await viewer('GET', '/api/kids')).status === 200);
  check('view-only cannot mark chores', (await viewer('POST', `/api/chores/${daily}/done`)).status === 403);

  // ---- check-in
  await call('POST', '/api/demo/load');
  const ci = (await call('GET', '/api/family/checkin')).body;
  check('check-in has talking points', Array.isArray(ci.points) && ci.points.length >= 4, ci.points);
  check('check-in mentions kids', ci.kids.length >= 3 && ci.points.some(p => p.includes('Ava')), ci.kids);
  check('check-in for a past month', (await call('GET', '/api/family/checkin?month=2026-01')).body.month === '2026-01');
  check('bad month falls back to this month', (await call('GET', '/api/family/checkin?month=nope')).body.current === true);
  check('save notes', (await call('PUT', '/api/family/notes/2026-01', { notes: 'Cap dining at $250' })).status === 200);
  check('notes come back', (await call('GET', '/api/family/checkin?month=2026-01')).body.notes === 'Cap dining at $250');
  check('bad notes month rejected', (await call('PUT', '/api/family/notes/xx', { notes: 'x' })).status === 400);

  // ---- demo kids, backup, restore
  check('demo adds 2 kids', (await kids()).filter(x => ['Emma', 'Leo'].includes(x.name)).length === 2);
  const backup = (await call('GET', '/api/export/backup.json')).body;
  check('backup includes kids + ledger + notes', backup.kids.length === 4 && backup.kid_ledger.length > 10 && backup.family_notes.length === 1, [backup.kids.length, backup.family_notes.length]);
  await call('DELETE', `/api/kids/${id}`);
  check('remove kid', !(await kids()).some(x => x.id === id));
  const r = await call('POST', '/api/restore', backup);
  check('restore brings the kid back', r.status === 200 && (await kids()).some(x => x.id === id && x.name === 'Ava'), r.body);
  const old = { ...backup }; delete old.kids; delete old.kid_chores; delete old.kid_ledger; delete old.family_notes;
  await call('POST', '/api/restore', old);
  check('older backup without kids keeps the kids', (await kids()).length === 4);
  await call('POST', '/api/demo/clear');
  const left = await kids();
  check('demo clear removes only demo kids', left.length === 2 && left.every(x => ['Ava', 'Ben'].includes(x.name)), left.map(x => x.name));

  srv.close();
  console.log(`\n${ok} family checks passed`);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
