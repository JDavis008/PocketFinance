// Restore a "Full backup (JSON)" from Settings → Your data. Saves a copy of the current database first.
const fs = require('fs');
const path = require('path');
const { db, tx, DATA_DIR } = require('./db');
const attachments = require('./attachments');

// parents before children; every table the backup export writes
const TABLES = ['categories', 'accounts', 'balance_history', 'transactions', 'attachments', 'rules', 'budgets', 'recurring', 'goals', 'goal_events', 'credit_scores', 'negotiations', 'watchlists', 'ious', 'kids', 'kid_chores', 'kid_ledger', 'family_notes'];
// Added after the first backups: only replaced when the backup file has them, so an older backup keeps the kids' jars.
const OPTIONAL = new Set(['kids', 'kid_chores', 'kid_ledger', 'family_notes']);
require('./family'); // creates the family tables
const bad = msg => Object.assign(new Error(msg), { status: 400 });
const cols = t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);

function snapshotDb() {
  const dir = path.join(DATA_DIR, 'backups'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

function restore(b) {
  if (!b || typeof b !== 'object' || b.version !== 1 || !Array.isArray(b.accounts) || !Array.isArray(b.transactions)) throw bad("That isn't a PocketFinance backup file.");
  const saved = snapshotDb();
  const conns = new Set(db.prepare('SELECT id FROM connections').all().map(r => r.id));
  const counts = {};
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    tx(() => {
      for (const t of [...TABLES].reverse()) if (!OPTIONAL.has(t) || Array.isArray(b[t])) db.prepare(`DELETE FROM ${t}`).run();
      for (const t of TABLES) {
        const rows = Array.isArray(b[t]) ? b[t] : null;
        if (!rows) continue;
        const have = new Set(cols(t));
        let n = 0;
        for (const raw of rows) {
          if (!raw || typeof raw !== 'object') continue;
          const r = { ...raw };
          if (t === 'accounts' && r.connection_id != null && !conns.has(r.connection_id)) r.connection_id = null; // bank link not on this PC
          if (t === 'attachments' && !(r.file && fs.existsSync(path.join(attachments.DIR, path.basename(String(r.file)))))) continue; // receipt files aren't in the JSON
          const keys = Object.keys(r).filter(k => have.has(k));
          if (!keys.length) continue;
          db.prepare(`INSERT OR REPLACE INTO ${t}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`)
            .run(...keys.map(k => (r[k] !== null && typeof r[k] === 'object' ? JSON.stringify(r[k]) : r[k])));
          n++;
        }
        counts[t] = n;
      }
      // bank connections still on this PC fetch their full history again on the next sync
      db.prepare("UPDATE connections SET cursor=NULL WHERE provider IN ('plaid','teller','simplefin')").run();
    });
  } finally { db.exec('PRAGMA foreign_keys = ON'); }
  return { counts, saved_copy: path.basename(saved) };
}

module.exports = { restore };
