// SQLite storage (built-in node:sqlite, no native modules).
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.PP_DATA || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'pocketpilot.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, created INTEGER, expires INTEGER);
CREATE TABLE IF NOT EXISTS connections (
  id INTEGER PRIMARY KEY, provider TEXT NOT NULL, name TEXT, institution TEXT,
  secret_enc TEXT, cursor TEXT, status TEXT DEFAULT 'ok', error TEXT,
  last_sync INTEGER, created INTEGER, meta TEXT
);
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY, connection_id INTEGER REFERENCES connections(id) ON DELETE CASCADE,
  external_id TEXT, name TEXT, official_name TEXT, mask TEXT, type TEXT, subtype TEXT,
  currency TEXT DEFAULT 'USD', balance REAL DEFAULT 0, available REAL, credit_limit REAL,
  institution TEXT, hidden INTEGER DEFAULT 0, include_net_worth INTEGER DEFAULT 1,
  manual INTEGER DEFAULT 0, updated INTEGER, meta TEXT,
  UNIQUE(connection_id, external_id)
);
CREATE TABLE IF NOT EXISTS balance_history (
  account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE, date TEXT, balance REAL,
  PRIMARY KEY(account_id, date)
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY, account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  external_id TEXT, date TEXT, amount REAL, description TEXT, merchant TEXT, merchant_key TEXT,
  category TEXT, pending INTEGER DEFAULT 0, notes TEXT, excluded INTEGER DEFAULT 0,
  user_category INTEGER DEFAULT 0, recurring_id INTEGER, provider_category TEXT, logo TEXT,
  tax_deductible INTEGER DEFAULT 0, created INTEGER,
  UNIQUE(account_id, external_id)
);
CREATE INDEX IF NOT EXISTS tx_date ON transactions(date);
CREATE INDEX IF NOT EXISTS tx_mk ON transactions(merchant_key);
CREATE TABLE IF NOT EXISTS categories (
  name TEXT PRIMARY KEY, grp TEXT, icon TEXT, color TEXT, kind TEXT DEFAULT 'expense'
);
CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY, match_field TEXT DEFAULT 'merchant', match_type TEXT DEFAULT 'contains',
  pattern TEXT, set_category TEXT, set_merchant TEXT, set_excluded INTEGER, created INTEGER
);
CREATE TABLE IF NOT EXISTS budgets (category TEXT PRIMARY KEY, amount REAL, rollover INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS recurring (
  id INTEGER PRIMARY KEY, key TEXT UNIQUE, name TEXT, custom_name TEXT, merchant_key TEXT,
  category TEXT, amount REAL, prev_amount REAL, cadence TEXT, last_date TEXT, next_date TEXT,
  account_id INTEGER, status TEXT DEFAULT 'active', kind TEXT, auto INTEGER DEFAULT 1,
  occurrences INTEGER, cancelled_at TEXT, cancel_url TEXT, notes TEXT, created INTEGER, updated INTEGER
);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY, name TEXT, target REAL, saved REAL DEFAULT 0, target_date TEXT,
  account_id INTEGER, color TEXT, icon TEXT, created INTEGER
);
CREATE TABLE IF NOT EXISTS goal_events (id INTEGER PRIMARY KEY, goal_id INTEGER REFERENCES goals(id) ON DELETE CASCADE, date TEXT, amount REAL, note TEXT);
CREATE TABLE IF NOT EXISTS credit_scores (id INTEGER PRIMARY KEY, date TEXT, score INTEGER, bureau TEXT, notes TEXT);
CREATE TABLE IF NOT EXISTS negotiations (
  id INTEGER PRIMARY KEY, recurring_id INTEGER, provider TEXT, before_amount REAL, after_amount REAL,
  months INTEGER DEFAULT 12, date TEXT, status TEXT DEFAULT 'planned', notes TEXT
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY, created INTEGER, type TEXT, title TEXT, body TEXT, read INTEGER DEFAULT 0, key TEXT UNIQUE, link TEXT
);
`);

// ---- migrations (columns added after the first release) ----
const cols = t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
if (!cols('transactions').includes('tags')) db.exec('ALTER TABLE transactions ADD COLUMN tags TEXT');
if (!cols('transactions').includes('reviewed')) {
  // everything already in the database counts as reviewed; only new arrivals land in the inbox
  db.exec('ALTER TABLE transactions ADD COLUMN reviewed INTEGER DEFAULT 0; UPDATE transactions SET reviewed=1;');
}
db.exec(`
CREATE INDEX IF NOT EXISTS tx_reviewed ON transactions(reviewed);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY, tx_id INTEGER REFERENCES transactions(id) ON DELETE CASCADE,
  filename TEXT, mime TEXT, size INTEGER, file TEXT, created INTEGER
);
CREATE INDEX IF NOT EXISTS att_tx ON attachments(tx_id);
CREATE TABLE IF NOT EXISTS watchlists (
  id INTEGER PRIMARY KEY, name TEXT, kind TEXT, value TEXT, monthly_limit REAL, created INTEGER
);
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY, name TEXT, role TEXT DEFAULT 'view', hash TEXT, created INTEGER, last_login INTEGER
);
`);
if (!cols('rules').includes('set_tags')) db.exec('ALTER TABLE rules ADD COLUMN set_tags TEXT');
if (!cols('sessions').includes('member_id')) db.exec('ALTER TABLE sessions ADD COLUMN member_id INTEGER');
for (const c of ['cancel_state', 'cancel_method', 'cancel_ref', 'reviewed_at']) if (!cols('recurring').includes(c)) db.exec(`ALTER TABLE recurring ADD COLUMN ${c} TEXT`);

const getSetting = (key, fallback = null) => {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  if (!r) return fallback;
  try { return JSON.parse(r.value); } catch { return fallback; }
};
const setSetting = (key, value) =>
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

const DEFAULT_CATEGORIES = [
  ['Paycheck', 'Income', '💼', '#16a34a', 'income'],
  ['Other Income', 'Income', '💵', '#22c55e', 'income'],
  ['Interest & Dividends', 'Income', '📈', '#10b981', 'income'],
  ['Refunds', 'Income', '↩️', '#34d399', 'income'],
  ['Transfer', 'Transfers', '🔁', '#94a3b8', 'transfer'],
  ['Credit Card Payment', 'Transfers', '💳', '#64748b', 'transfer'],
  ['Savings & Investing', 'Transfers', '🏦', '#475569', 'transfer'],
  ['Housing', 'Home', '🏠', '#6366f1', 'expense'],
  ['Bills & Utilities', 'Home', '💡', '#8b5cf6', 'expense'],
  ['Home & Garden', 'Home', '🪴', '#a78bfa', 'expense'],
  ['Groceries', 'Food', '🛒', '#f59e0b', 'expense'],
  ['Dining & Drinks', 'Food', '🍔', '#f97316', 'expense'],
  ['Auto & Transport', 'Transport', '🚗', '#0ea5e9', 'expense'],
  ['Gas', 'Transport', '⛽', '#0284c7', 'expense'],
  ['Shopping', 'Lifestyle', '🛍️', '#ec4899', 'expense'],
  ['Subscriptions', 'Lifestyle', '🔄', '#d946ef', 'expense'],
  ['Entertainment', 'Lifestyle', '🎬', '#e11d48', 'expense'],
  ['Travel', 'Lifestyle', '✈️', '#06b6d4', 'expense'],
  ['Personal Care', 'Lifestyle', '💇', '#f472b6', 'expense'],
  ['Health & Wellness', 'Health', '🩺', '#14b8a6', 'expense'],
  ['Insurance', 'Health', '🛡️', '#0d9488', 'expense'],
  ['Kids', 'Family', '🧸', '#fb923c', 'expense'],
  ['Pets', 'Family', '🐾', '#a16207', 'expense'],
  ['Education', 'Family', '🎓', '#2563eb', 'expense'],
  ['Gifts & Donations', 'Family', '🎁', '#dc2626', 'expense'],
  ['Loan Payment', 'Debt', '🏛️', '#7c3aed', 'expense'],
  ['Fees & Charges', 'Other', '⚠️', '#b91c1c', 'expense'],
  ['Taxes', 'Other', '🧾', '#78716c', 'expense'],
  ['Business', 'Other', '💼', '#57534e', 'expense'],
  ['Cash & ATM', 'Other', '🏧', '#65a30d', 'expense'],
  ['Uncategorized', 'Other', '❔', '#9ca3af', 'expense'],
];
if (!db.prepare('SELECT COUNT(*) n FROM categories').get().n) {
  const ins = db.prepare('INSERT INTO categories(name,grp,icon,color,kind) VALUES(?,?,?,?,?)');
  tx(() => DEFAULT_CATEGORIES.forEach(c => ins.run(...c)));
}

module.exports = { db, tx, getSetting, setSetting, DATA_DIR };
