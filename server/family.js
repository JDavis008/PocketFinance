// Family: kids' allowance + chores (save / spend / give jars) and the monthly family money check-in.
const { db, tx } = require('./db');
const { today, addDays, parseISO, isoDate, monthOf, prevMonth, monthStart, monthEnd, round2 } = require('./util');

db.exec(`CREATE TABLE IF NOT EXISTS kids (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, emoji TEXT DEFAULT '🧒', color TEXT DEFAULT '#6d4aff',
  allowance REAL DEFAULT 0, pay_day INTEGER DEFAULT 6, last_paid TEXT,
  save_pct INTEGER DEFAULT 20, give_pct INTEGER DEFAULT 10,
  goal_name TEXT, goal_amount REAL, created INTEGER
);
CREATE TABLE IF NOT EXISTS kid_chores (
  id INTEGER PRIMARY KEY, kid_id INTEGER NOT NULL REFERENCES kids(id) ON DELETE CASCADE,
  name TEXT NOT NULL, reward REAL DEFAULT 0, freq TEXT DEFAULT 'weekly', active INTEGER DEFAULT 1, created INTEGER
);
CREATE TABLE IF NOT EXISTS kid_ledger (
  id INTEGER PRIMARY KEY, kid_id INTEGER NOT NULL REFERENCES kids(id) ON DELETE CASCADE,
  date TEXT NOT NULL, amount REAL NOT NULL, jar TEXT DEFAULT 'spend', kind TEXT DEFAULT 'deposit',
  note TEXT, chore_id INTEGER, created INTEGER
);
CREATE INDEX IF NOT EXISTS kid_ledger_kid ON kid_ledger(kid_id, date);
CREATE TABLE IF NOT EXISTS family_notes (month TEXT PRIMARY KEY, notes TEXT, updated INTEGER);`);

const bad = msg => Object.assign(new Error(msg), { status: 400 });
const clean = (s, n = 60) => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, n);
const JARS = ['spend', 'save', 'give'];
const FREQS = ['daily', 'weekly', 'once'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pct = v => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
const money = v => round2(Math.abs(Number(v) || 0));
const weekStart = d => addDays(d, -parseISO(d).getDay()); // weeks run Sunday to Saturday

/** Split an amount into the kid's jars; the cents left over go to Spend. */
function split(kid, amount) {
  const save = round2(amount * pct(kid.save_pct) / 100), give = round2(amount * pct(kid.give_pct) / 100);
  return { save, give, spend: round2(amount - save - give) };
}

const ins = () => db.prepare('INSERT INTO kid_ledger(kid_id,date,amount,jar,kind,note,chore_id,created) VALUES(?,?,?,?,?,?,?,?)');
function credit(kid, date, amount, kind, note, choreId = null) {
  const s = ins(), parts = split(kid, amount);
  for (const jar of JARS) if (parts[jar]) s.run(kid.id, date, parts[jar], jar, kind, note, choreId, Date.now());
}

/** Pay any allowance that came due since the last payday (at most 26 weeks back). */
function payDue(now = today()) {
  let paid = 0;
  const kids = db.prepare('SELECT * FROM kids WHERE allowance > 0').all();
  tx(() => {
    for (const k of kids) {
      let from = k.last_paid || now;
      if (from > now) continue;
      // the first payday after `from`
      let d = addDays(from, ((k.pay_day - parseISO(from).getDay() + 7) % 7) || 7);
      const floor = addDays(now, -26 * 7);
      let last = null;
      for (; d <= now; d = addDays(d, 7)) {
        if (d < floor) continue;
        credit(k, d, k.allowance, 'allowance', `Weekly allowance`);
        last = d; paid++;
      }
      if (last) db.prepare('UPDATE kids SET last_paid=? WHERE id=?').run(last, k.id);
      else if (!k.last_paid) db.prepare('UPDATE kids SET last_paid=? WHERE id=?').run(now, k.id);
    }
  });
  return paid;
}

function nextPayday(k, now = today()) {
  const base = k.last_paid && k.last_paid > now ? k.last_paid : now;
  return addDays(base, ((k.pay_day - parseISO(base).getDay() + 7) % 7) || 7);
}

function list() {
  payDue();
  const t = today(), wk = weekStart(t);
  const kids = db.prepare('SELECT * FROM kids ORDER BY id').all();
  return {
    days: DAYS,
    kids: kids.map(k => {
      const jars = Object.fromEntries(JARS.map(j => [j, 0]));
      for (const r of db.prepare('SELECT jar, ROUND(SUM(amount),2) v FROM kid_ledger WHERE kid_id=? GROUP BY jar').all(k.id)) if (jars[r.jar] != null) jars[r.jar] = round2(r.v);
      const chores = db.prepare('SELECT * FROM kid_chores WHERE kid_id=? AND active=1 ORDER BY id').all(k.id).map(c => {
        const since = c.freq === 'daily' ? t : c.freq === 'weekly' ? wk : '0000-00-00';
        const done = db.prepare('SELECT id, date FROM kid_ledger WHERE chore_id=? AND date>=? ORDER BY id DESC').all(c.id, since);
        const doneIds = [...new Set(done.map(x => x.date))];
        return { ...c, done: done.length > 0, entry_ids: done.map(x => x.id), done_dates: doneIds };
      });
      const earnedWeek = db.prepare("SELECT ROUND(COALESCE(SUM(amount),0),2) v FROM kid_ledger WHERE kid_id=? AND kind='chore' AND date>=?").get(k.id, wk).v;
      return {
        ...k, jars, total: round2(jars.spend + jars.save + jars.give), chores, earned_week: earnedWeek,
        next_payday: k.allowance > 0 ? nextPayday(k) : null,
        recent: db.prepare('SELECT * FROM kid_ledger WHERE kid_id=? ORDER BY date DESC, id DESC LIMIT 25').all(k.id),
      };
    }),
  };
}

function addKid(b) {
  const name = clean(b.name, 40); if (!name) throw bad('Add a name.');
  if (pct(b.save_pct) + pct(b.give_pct) > 100) throw bad('Save + give can’t be more than 100%.');
  const pay = Number.isInteger(Number(b.pay_day)) ? Math.max(0, Math.min(6, Number(b.pay_day))) : 6;
  const id = Number(db.prepare('INSERT INTO kids(name,emoji,color,allowance,pay_day,last_paid,save_pct,give_pct,goal_name,goal_amount,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(name, clean(b.emoji, 8) || '🧒', /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#6d4aff', money(b.allowance), pay, today(),
      pct(b.save_pct ?? 20), pct(b.give_pct ?? 10), clean(b.goal_name, 60) || null, b.goal_amount ? money(b.goal_amount) : null, Date.now()).lastInsertRowid);
  if (b.start_balance && Number(b.start_balance) > 0) credit({ id, save_pct: pct(b.save_pct ?? 20), give_pct: pct(b.give_pct ?? 10) }, today(), money(b.start_balance), 'deposit', 'Starting balance');
  return { id };
}

function updateKid(id, b) {
  const k = db.prepare('SELECT * FROM kids WHERE id=?').get(id); if (!k) throw bad('Not found');
  const save = b.save_pct != null ? pct(b.save_pct) : k.save_pct, give = b.give_pct != null ? pct(b.give_pct) : k.give_pct;
  if (save + give > 100) throw bad('Save + give can’t be more than 100%.');
  const pay = b.pay_day != null && Number.isInteger(Number(b.pay_day)) ? Math.max(0, Math.min(6, Number(b.pay_day))) : k.pay_day;
  // turning an allowance on (or changing the day) starts counting from today, never back-pays
  const restart = (b.allowance != null && !(k.allowance > 0) && money(b.allowance) > 0) || pay !== k.pay_day;
  db.prepare('UPDATE kids SET name=?, emoji=?, color=?, allowance=?, pay_day=?, save_pct=?, give_pct=?, goal_name=?, goal_amount=?, last_paid=? WHERE id=?').run(
    b.name != null ? (clean(b.name, 40) || k.name) : k.name, b.emoji != null ? (clean(b.emoji, 8) || k.emoji) : k.emoji,
    /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : k.color, b.allowance != null ? money(b.allowance) : k.allowance, pay, save, give,
    b.goal_name !== undefined ? (clean(b.goal_name, 60) || null) : k.goal_name,
    b.goal_amount !== undefined ? (Number(b.goal_amount) > 0 ? money(b.goal_amount) : null) : k.goal_amount,
    restart ? today() : k.last_paid, id);
  return { ok: true };
}

const removeKid = id => { db.prepare('DELETE FROM kid_ledger WHERE kid_id=?').run(id); db.prepare('DELETE FROM kid_chores WHERE kid_id=?').run(id); db.prepare('DELETE FROM kids WHERE id=?').run(id); return { ok: true }; };

/** Money in or out of one jar ("Grandma's birthday card", "Bought a toy"), or a move between jars. */
function addEntry(kidId, b) {
  const k = db.prepare('SELECT * FROM kids WHERE id=?').get(kidId); if (!k) throw bad('Not found');
  const amount = money(b.amount); if (!(amount > 0)) throw bad('Enter an amount above $0.');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : today(), note = clean(b.note, 80) || null;
  const jarOf = j => (JARS.includes(j) ? j : 'spend');
  const bal = j => db.prepare('SELECT COALESCE(SUM(amount),0) v FROM kid_ledger WHERE kid_id=? AND jar=?').get(kidId, j).v;
  if (b.type === 'move') {
    const from = jarOf(b.from), to = jarOf(b.to); if (from === to) throw bad('Pick two different jars.');
    if (bal(from) + 1e-9 < amount) throw bad(`There's only $${bal(from).toFixed(2)} in ${from[0].toUpperCase() + from.slice(1)}.`);
    tx(() => { const s = ins(); s.run(kidId, date, -amount, from, 'move', note || `To ${to}`, null, Date.now()); s.run(kidId, date, amount, to, 'move', note || `From ${from}`, null, Date.now()); });
  } else if (b.type === 'spend') {
    const jar = jarOf(b.jar); if (bal(jar) + 1e-9 < amount) throw bad(`There's only $${bal(jar).toFixed(2)} in ${jar[0].toUpperCase() + jar.slice(1)}.`);
    ins().run(kidId, date, -amount, jar, jar === 'give' ? 'give' : 'spend', note, null, Date.now());
  } else if (b.jar && JARS.includes(b.jar)) {
    ins().run(kidId, date, amount, b.jar, 'deposit', note, null, Date.now());
  } else {
    tx(() => credit(k, date, amount, 'deposit', note)); // split like allowance
  }
  return { ok: true };
}

const removeEntry = id => { db.prepare('DELETE FROM kid_ledger WHERE id=?').run(id); return { ok: true }; };

function addChore(kidId, b) {
  if (!db.prepare('SELECT id FROM kids WHERE id=?').get(kidId)) throw bad('Not found');
  const name = clean(b.name, 60); if (!name) throw bad('Name the chore.');
  const id = Number(db.prepare('INSERT INTO kid_chores(kid_id,name,reward,freq,active,created) VALUES(?,?,?,?,1,?)')
    .run(kidId, name, money(b.reward), FREQS.includes(b.freq) ? b.freq : 'weekly', Date.now()).lastInsertRowid);
  return { id };
}
function updateChore(id, b) {
  const c = db.prepare('SELECT * FROM kid_chores WHERE id=?').get(id); if (!c) throw bad('Not found');
  db.prepare('UPDATE kid_chores SET name=?, reward=?, freq=?, active=? WHERE id=?').run(b.name != null ? (clean(b.name, 60) || c.name) : c.name,
    b.reward != null ? money(b.reward) : c.reward, FREQS.includes(b.freq) ? b.freq : c.freq, b.active != null ? (b.active ? 1 : 0) : c.active, id);
  return { ok: true };
}
const removeChore = id => { db.prepare('UPDATE kid_chores SET active=0 WHERE id=?').run(id); return { ok: true }; };

/** Mark a chore done today: pays its reward into the jars (once per day / week, or once ever). */
function choreDone(id) {
  const c = db.prepare('SELECT * FROM kid_chores WHERE id=? AND active=1').get(id); if (!c) throw bad('Not found');
  const k = db.prepare('SELECT * FROM kids WHERE id=?').get(c.kid_id);
  const t = today(), since = c.freq === 'daily' ? t : c.freq === 'weekly' ? weekStart(t) : '0000-00-00';
  if (db.prepare('SELECT id FROM kid_ledger WHERE chore_id=? AND date>=?').get(id, since)) throw bad(c.freq === 'daily' ? 'Already done today.' : c.freq === 'weekly' ? 'Already done this week.' : 'Already done.');
  tx(() => {
    if (c.reward > 0) credit(k, t, c.reward, 'chore', c.name, id);
    else ins().run(k.id, t, 0, 'spend', 'chore', c.name, id, Date.now()); // unpaid chore: still record it
    if (c.freq === 'once') db.prepare('UPDATE kid_chores SET active=0 WHERE id=?').run(id);
  });
  return { ok: true, reward: c.reward };
}
function choreUndo(id) {
  const c = db.prepare('SELECT * FROM kid_chores WHERE id=?').get(id); if (!c) throw bad('Not found');
  const t = today(), since = c.freq === 'daily' ? t : c.freq === 'weekly' ? weekStart(t) : '0000-00-00';
  const last = db.prepare('SELECT date FROM kid_ledger WHERE chore_id=? AND date>=? ORDER BY id DESC LIMIT 1').get(id, since);
  if (!last) return { ok: true };
  db.prepare('DELETE FROM kid_ledger WHERE chore_id=? AND date=?').run(id, last.date);
  if (c.freq === 'once') db.prepare('UPDATE kid_chores SET active=1 WHERE id=?').run(id);
  return { ok: true };
}

// ---------- monthly family money check-in ----------
function checkin(month, { insights, recurring }) {
  const m = /^\d{4}-\d{2}$/.test(month || '') ? month : monthOf(today());
  const r = insights.report(m), b = insights.budgets(m);
  const t = today(), soon = recurring.upcoming(t, addDays(t, 14)).filter(x => x.kind !== 'income');
  const goals = db.prepare('SELECT g.*, a.balance account_balance FROM goals g LEFT JOIN accounts a ON a.id=g.account_id ORDER BY g.id').all()
    .map(g => { const saved = g.account_id ? Math.max(0, g.account_balance || 0) : g.saved; return { name: g.name, icon: g.icon, target: g.target, saved: round2(saved), pct: g.target > 0 ? Math.min(1, saved / g.target) : 0, target_date: g.target_date }; });
  const kids = list().kids.map(k => ({ name: k.name, emoji: k.emoji, total: k.total, save: k.jars.save, chores_done: k.chores.filter(c => c.done).length, chores: k.chores.length }));
  const prevCat = Object.fromEntries((r.prevCategories || []).map(c => [c.name ?? c.category, c.total]));
  const cats = (r.categories || []).slice(0, 6).map(c => { const name = c.name ?? c.category; const prev = prevCat[name] || 0; return { name, icon: c.icon, color: c.color, total: c.total, prev, change: round2(c.total - prev) }; });
  const over = b.list.filter(x => x.limit > 0 && x.spent > x.limit).map(x => ({ category: x.category, spent: x.spent, limit: x.limit, over: round2(x.spent - x.limit) }));
  const iou = db.prepare("SELECT ROUND(COALESCE(SUM(CASE WHEN direction='owed_me' THEN amount END),0),2) owed_me, ROUND(COALESCE(SUM(CASE WHEN direction='i_owe' THEN amount END),0),2) i_owe FROM ious WHERE settled_at IS NULL").get();

  const points = [];
  const tt = r.totals, pv = r.prev;
  if (tt.income || tt.spending) points.push(tt.net >= 0 ? `We kept $${tt.net.toFixed(0)} of what came in (${tt.income ? Math.round(tt.net / tt.income * 100) : 0}% saved).` : `We spent $${(-tt.net).toFixed(0)} more than came in.`);
  if (pv.spending && tt.spending) { const d = tt.spending - pv.spending; if (Math.abs(d) >= 25) points.push(`Spending is ${d > 0 ? 'up' : 'down'} $${Math.abs(d).toFixed(0)} from ${new Date(prevMonth(m) + '-02').toLocaleString('en-US', { month: 'long' })}.`); }
  const jump = [...cats].sort((a, b2) => b2.change - a.change)[0];
  if (jump && jump.change >= 40) points.push(`${jump.name} went up the most: $${jump.total.toFixed(0)} (was $${jump.prev.toFixed(0)}).`);
  over.slice(0, 3).forEach(o => points.push(`${o.category} is over budget by $${o.over.toFixed(0)}. Raise the budget or cut back?`));
  if (soon.length) points.push(`${soon.length} bill${soon.length === 1 ? '' : 's'} due in the next 2 weeks: $${soon.reduce((a, x) => a + x.amount, 0).toFixed(0)} total.`);
  goals.filter(g => g.pct < 1).slice(0, 3).forEach(g => points.push(`${g.icon || '🎯'} ${g.name}: ${Math.round(g.pct * 100)}% there ($${g.saved.toFixed(0)} of $${g.target.toFixed(0)}).`));
  kids.forEach(k => points.push(`${k.emoji} ${k.name} has $${k.total.toFixed(2)} ($${k.save.toFixed(2)} saved), ${k.chores_done}/${k.chores} chores done.`));
  if (iou.owed_me > 0) points.push(`People owe us $${iou.owed_me.toFixed(0)}. Send reminders?`);

  const note = db.prepare('SELECT notes, updated FROM family_notes WHERE month=?').get(m);
  return { month: m, current: m === monthOf(t), totals: tt, prev: pv, categories: cats, over, budgets: { total: b.total, spent: b.spent, count: b.list.length, on_track: b.list.filter(x => x.spent <= x.limit).length },
    bills: soon.slice(0, 10), goals, kids, ious: iou, points, notes: note ? note.notes : '', notes_updated: note ? note.updated : null,
    range: { from: monthStart(m), to: monthEnd(m) } };
}
function saveNotes(month, notes) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw bad('Bad month');
  db.prepare('INSERT INTO family_notes(month,notes,updated) VALUES(?,?,?) ON CONFLICT(month) DO UPDATE SET notes=excluded.notes, updated=excluded.updated')
    .run(month, String(notes ?? '').slice(0, 5000), Date.now());
  return { ok: true };
}

module.exports = { list, payDue, addKid, updateKid, removeKid, addEntry, removeEntry, addChore, updateChore, removeChore, choreDone, choreUndo, checkin, saveNotes, weekStart, isoDate };
