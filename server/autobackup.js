// Automatic daily backups: the same JSON as Settings → "Full backup (JSON)", written to data/backups/auto-YYYY-MM-DD.json.
// The newest 14 are kept. Each one can be restored from Settings → Your data (owner only).
const fs = require('fs');
const path = require('path');
const { db, DATA_DIR } = require('./db');
const { today } = require('./util');

const TABLES = ['accounts', 'balance_history', 'transactions', 'categories', 'rules', 'budgets', 'recurring', 'goals', 'goal_events', 'credit_scores', 'negotiations', 'attachments', 'watchlists', 'ious', 'kids', 'kid_chores', 'kid_ledger', 'family_notes'];
const KEEP = 14, KEEP_PRE_RESTORE = 10;
const DIR = path.join(DATA_DIR, 'backups');
const NAME = /^auto-\d{4}-\d{2}-\d{2}\.json$/;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

function snapshot() {
  const has = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
  return { version: 1, exported: new Date().toISOString(), ...Object.fromEntries(TABLES.filter(t => has.has(t)).map(t => [t, db.prepare(`SELECT * FROM ${t}`).all()])) };
}

function list() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter(f => NAME.test(f)).sort().reverse().map(f => {
    const st = fs.statSync(path.join(DIR, f));
    return { name: f, date: f.slice(5, 15), size: st.size, saved: new Date(st.mtimeMs).toISOString() };
  });
}

// Writes today's backup (once a day unless force). Skips an empty database. Returns the file name or null.
function run(force = false) {
  const name = `auto-${today()}.json`, file = path.join(DIR, name);
  if (!force && fs.existsSync(file)) return null;
  const n = db.prepare('SELECT (SELECT COUNT(*) FROM accounts) + (SELECT COUNT(*) FROM transactions) n').get().n;
  if (!n && !force) return null;
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(snapshot()));
  fs.renameSync(file + '.tmp', file);
  prune();
  return name;
}

function prune() {
  for (const old of list().slice(KEEP)) fs.rmSync(path.join(DIR, old.name), { force: true });
  // copies saved before each restore (.db) — keep the newest few
  if (!fs.existsSync(DIR)) return;
  const pre = fs.readdirSync(DIR).filter(f => /^before-restore-.*\.db$/.test(f)).sort().reverse();
  for (const f of pre.slice(KEEP_PRE_RESTORE)) fs.rmSync(path.join(DIR, f), { force: true });
}

function file(name) {
  if (!NAME.test(String(name || ''))) throw bad('Unknown backup');
  const f = path.join(DIR, name);
  if (!fs.existsSync(f)) throw bad('That backup is no longer there.', 404);
  return f;
}
const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));

module.exports = { snapshot, list, run, file, read, KEEP, DIR };
