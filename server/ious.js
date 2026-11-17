// Shared expenses and IOUs (Splitwise-style): who owes you, who you owe, settle up.
const { db } = require('./db');
const { today, round2 } = require('./util');

db.exec(`CREATE TABLE IF NOT EXISTS ious (
  id INTEGER PRIMARY KEY, tx_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  person TEXT NOT NULL, amount REAL NOT NULL, direction TEXT DEFAULT 'owed_me', note TEXT,
  date TEXT, created INTEGER, settled_at TEXT
);
CREATE INDEX IF NOT EXISTS iou_person ON ious(person);`);

const bad = msg => Object.assign(new Error(msg), { status: 400 });
const clean = s => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
const dir = d => (d === 'i_owe' ? 'i_owe' : 'owed_me');

function list() {
  const rows = db.prepare(`SELECT i.*, t.merchant, t.amount tx_amount, t.date tx_date FROM ious i LEFT JOIN transactions t ON t.id=i.tx_id
    ORDER BY i.settled_at IS NOT NULL, COALESCE(i.date, '') DESC, i.id DESC`).all();
  const open = rows.filter(r => !r.settled_at), settled = rows.filter(r => r.settled_at).slice(0, 60);
  const people = {};
  for (const r of open) {
    const p = (people[r.person.toLowerCase()] ||= { person: r.person, owed_me: 0, i_owe: 0, count: 0 });
    p[r.direction] += r.amount; p.count++;
  }
  const ppl = Object.values(people).map(p => ({ ...p, owed_me: round2(p.owed_me), i_owe: round2(p.i_owe), net: round2(p.owed_me - p.i_owe) }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  const names = db.prepare('SELECT person, COUNT(*) n FROM ious GROUP BY lower(person) ORDER BY n DESC LIMIT 30').all().map(r => r.person);
  return {
    open, settled, people: ppl, names,
    owed_me: round2(open.filter(r => r.direction === 'owed_me').reduce((a, r) => a + r.amount, 0)),
    i_owe: round2(open.filter(r => r.direction === 'i_owe').reduce((a, r) => a + r.amount, 0)),
  };
}

function add(b) {
  const person = clean(b.person), amount = round2(Math.abs(Number(b.amount)));
  if (!person) throw bad('Who is it with?');
  if (!(amount > 0)) throw bad('Enter an amount above $0.');
  let txId = b.tx_id ? Number(b.tx_id) : null, date = b.date || today();
  if (txId) { const t = db.prepare('SELECT id, date FROM transactions WHERE id=?').get(txId); if (!t) throw bad('Transaction not found'); date = b.date || t.date; }
  const id = Number(db.prepare('INSERT INTO ious(tx_id,person,amount,direction,note,date,created) VALUES(?,?,?,?,?,?,?)')
    .run(txId, person, amount, dir(b.direction), clean(b.note).slice(0, 120) || null, date, Date.now()).lastInsertRowid);
  return { id };
}

function update(id, b) {
  const r = db.prepare('SELECT * FROM ious WHERE id=?').get(id); if (!r) throw bad('Not found');
  const settled = b.settled === undefined ? r.settled_at : (b.settled ? (r.settled_at || today()) : null);
  db.prepare('UPDATE ious SET person=?, amount=?, direction=?, note=?, settled_at=? WHERE id=?').run(
    b.person != null ? (clean(b.person) || r.person) : r.person,
    b.amount != null && Number(b.amount) > 0 ? round2(Math.abs(Number(b.amount))) : r.amount,
    b.direction ? dir(b.direction) : r.direction, b.note != null ? (clean(b.note) || null) : r.note, settled, id);
  return { ok: true };
}

const remove = id => { db.prepare('DELETE FROM ious WHERE id=?').run(id); return { ok: true }; };

// settle everything open with one person
function settlePerson(person) {
  const n = db.prepare('UPDATE ious SET settled_at=? WHERE settled_at IS NULL AND lower(person)=lower(?)').run(today(), clean(person)).changes;
  return { settled: Number(n) };
}

const forTx = txId => db.prepare('SELECT * FROM ious WHERE tx_id=? ORDER BY id').all(txId);

module.exports = { list, add, update, remove, settlePerson, forTx };
