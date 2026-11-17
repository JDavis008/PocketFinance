// Password auth, sessions, and encryption of bank tokens at rest.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, getSetting, setSetting, DATA_DIR } = require('./db');

// ---- secret encryption (AES-256-GCM, key file kept next to the database) ----
const KEY_FILE = path.join(DATA_DIR, 'secret.key');
if (!fs.existsSync(KEY_FILE)) fs.writeFileSync(KEY_FILE, crypto.randomBytes(32), { mode: 0o600 });
const KEY = fs.readFileSync(KEY_FILE);

function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function decrypt(str) {
  if (!str) return null;
  const b = Buffer.from(str, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
}

// ---- password ----
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
function checkPassword(pw, stored) {
  if (!stored) return false;
  const [s, h] = stored.split(':');
  const hash = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(hash, Buffer.from(h, 'hex'));
}
const isSetUp = () => !!getSetting('auth_hash');
function setPassword(pw) { setSetting('auth_hash', hashPassword(pw)); }

// ---- sessions ----
// Sessions last 90 days and renew themselves while used, so you stay signed in.
const SESSION_DAYS = 90;
const COOKIE = 'pp_sid';
function createSession(res, memberId = null) {
  const id = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions(id,created,expires,member_id) VALUES(?,?,?,?)').run(id, now, now + SESSION_DAYS * 864e5, memberId);
  res.setHeader('Set-Cookie', `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
}
function readCookie(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  return m ? m[1] : null;
}
// Who is signed in: the owner, or a household member (full or view-only access).
function sessionUser(req) {
  const id = readCookie(req);
  if (!id) return null;
  const s = db.prepare('SELECT s.expires, s.member_id, m.name, m.role FROM sessions s LEFT JOIN members m ON m.id=s.member_id WHERE s.id=?').get(id);
  if (!s || s.expires <= Date.now()) return null;
  if (s.member_id == null) return { role: 'owner', name: getSetting('owner_name', '') || 'Owner', memberId: null, expires: s.expires };
  if (!s.role) return null; // member was removed
  return { role: s.role === 'full' ? 'full' : 'view', name: s.name, memberId: s.member_id, expires: s.expires };
}
const sessionValid = req => !!sessionUser(req);
// push the expiry out again (at most once a day per session)
function renewSession(req, res, user) {
  if (user.expires - Date.now() > (SESSION_DAYS - 1) * 864e5) return;
  const id = readCookie(req); if (!id) return;
  db.prepare('UPDATE sessions SET expires=? WHERE id=?').run(Date.now() + SESSION_DAYS * 864e5, id);
  res.setHeader('Set-Cookie', `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
}

// ---- remembered phones: the PocketFinance app keeps a device key and signs itself in ----
db.exec(`CREATE TABLE IF NOT EXISTS devices (id INTEGER PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, member_id INTEGER, name TEXT, created INTEGER, last_used INTEGER)`);
const sha256 = t => crypto.createHash('sha256').update(String(t)).digest('hex');
// random id for this server, so the app can keep one key per server whichever address (Wi-Fi or Tailscale) it uses
function installId() {
  let id = getSetting('install_id');
  if (!id) { id = crypto.randomBytes(12).toString('hex'); setSetting('install_id', id); }
  return id;
}
function rememberDevice(user, name) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO devices(token_hash,member_id,name,created,last_used) VALUES(?,?,?,?,?)')
    .run(sha256(token), user.memberId ?? null, String(name || 'Phone').trim().slice(0, 40) || 'Phone', Date.now(), Date.now());
  return { token, server: installId() };
}
function deviceLogin(res, token) {
  if (!/^[a-f0-9]{64}$/.test(String(token || ''))) return false;
  const d = db.prepare('SELECT d.id, d.member_id, m.id mid FROM devices d LEFT JOIN members m ON m.id=d.member_id WHERE d.token_hash=?').get(sha256(token));
  if (!d) return false;
  if (d.member_id != null && d.mid == null) { db.prepare('DELETE FROM devices WHERE id=?').run(d.id); return false; } // member was removed
  db.prepare('UPDATE devices SET last_used=? WHERE id=?').run(Date.now(), d.id);
  createSession(res, d.member_id);
  return true;
}
const forgetDeviceToken = token => { if (token) db.prepare('DELETE FROM devices WHERE token_hash=?').run(sha256(token)); };
const listDevices = () => db.prepare('SELECT d.id, d.name, d.created, d.last_used, d.member_id, m.name member FROM devices d LEFT JOIN members m ON m.id=d.member_id ORDER BY d.last_used DESC').all();
const removeDevice = id => { db.prepare('DELETE FROM devices WHERE id=?').run(id); };

// ---- household members ----
const MAX_MEMBERS = 5;
/** Owner password first, then each member. Returns {memberId} or null. */
function checkLogin(pw) {
  if (checkPassword(pw, getSetting('auth_hash'))) return { memberId: null };
  for (const m of db.prepare('SELECT id, hash FROM members').all()) if (checkPassword(pw, m.hash)) {
    db.prepare('UPDATE members SET last_login=? WHERE id=?').run(Date.now(), m.id); return { memberId: m.id };
  }
  return null;
}
const listMembers = () => db.prepare('SELECT * FROM members ORDER BY id').all().map(({ hash, ...m }) => m);
function passwordInUse(pw, exceptId) {
  if (checkPassword(pw, getSetting('auth_hash'))) return true;
  return db.prepare('SELECT id, hash FROM members').all().some(m => m.id !== exceptId && checkPassword(pw, m.hash));
}
function addMember({ name, password, role }) {
  const bad = msg => Object.assign(new Error(msg), { status: 400 });
  name = String(name || '').trim().slice(0, 40);
  password = String(password || '');
  if (!name) throw bad('Give them a name.');
  if (password.length < 8) throw bad('Their password needs at least 8 characters.');
  if (db.prepare('SELECT COUNT(*) n FROM members').get().n >= MAX_MEMBERS) throw bad(`Up to ${MAX_MEMBERS} household members.`);
  // everyone signs in with just a password, so each one must be different
  if (passwordInUse(password)) throw bad('That password is already used by someone in this household. Pick a different one.');
  return { id: Number(db.prepare('INSERT INTO members(name,role,hash,created) VALUES(?,?,?,?)').run(name, role === 'full' ? 'full' : 'view', hashPassword(password), Date.now()).lastInsertRowid) };
}
function updateMember(id, { name, role, password }) {
  const bad = msg => Object.assign(new Error(msg), { status: 400 });
  const m = db.prepare('SELECT * FROM members WHERE id=?').get(id); if (!m) throw bad('Not found');
  let hash = m.hash;
  if (password) { if (String(password).length < 8) throw bad('At least 8 characters.'); if (passwordInUse(String(password), m.id)) throw bad('That password is already in use.'); hash = hashPassword(String(password)); }
  db.prepare('UPDATE members SET name=?, role=?, hash=? WHERE id=?').run(String(name ?? m.name).trim().slice(0, 40) || m.name, role ? (role === 'full' ? 'full' : 'view') : m.role, hash, m.id);
  if (password || (role && role !== m.role)) { db.prepare('DELETE FROM sessions WHERE member_id=?').run(m.id); db.prepare('DELETE FROM devices WHERE member_id=?').run(m.id); } // sign them out everywhere
}
function removeMember(id) {
  db.prepare('DELETE FROM sessions WHERE member_id=?').run(id);
  db.prepare('DELETE FROM devices WHERE member_id=?').run(id);
  db.prepare('DELETE FROM members WHERE id=?').run(id);
}
function destroySession(req, res) {
  const id = readCookie(req);
  if (id) db.prepare('DELETE FROM sessions WHERE id=?').run(id);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}
// new owner password: everyone (and every remembered phone) signs in again
function destroyAllSessions() { db.prepare('DELETE FROM sessions').run(); db.prepare('DELETE FROM devices').run(); }

// simple login throttle
const fails = new Map();
function throttled(ip) {
  const f = fails.get(ip);
  return f && f.count >= 5 && Date.now() - f.last < 5 * 60e3;
}
function noteFail(ip) {
  const f = fails.get(ip) || { count: 0, last: 0 };
  if (Date.now() - f.last > 5 * 60e3) f.count = 0;
  f.count++; f.last = Date.now(); fails.set(ip, f);
}
const clearFails = ip => fails.delete(ip);

// POSTs that only read or ask something, allowed for view-only members
const VIEW_POST_OK = new Set(['/api/auth/logout', '/api/auth/device', '/api/ai/ask', '/api/ai/insights', '/api/plans/retire/preview', '/api/rules/test']);
function requireAuth(req, res, next) {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  // Mutating requests must carry a custom header (blocks cross-site form posts).
  if (req.method !== 'GET' && req.headers['x-pp'] !== '1') return res.status(403).json({ error: 'Missing request header' });
  req.user = user;
  renewSession(req, res, user);
  if (user.role === 'view' && req.method !== 'GET' && !VIEW_POST_OK.has(req.originalUrl.split('?')[0])) return res.status(403).json({ error: 'You have view-only access. Ask the owner if you need to make changes.', code: 'VIEW_ONLY' });
  next();
}
// owner-only routes: household members, passwords, bank/API keys, network access
function ownerOnly(req, res, next) {
  if (!req.user || req.user.role !== 'owner') return res.status(403).json({ error: 'Only the owner can do this.', code: 'OWNER_ONLY' });
  next();
}

// Token for the read-only calendar feed (bills .ics), so calendar apps can subscribe.
function calendarToken() {
  let t = getSetting('calendar_token');
  if (!t) { t = crypto.randomBytes(18).toString('hex'); setSetting('calendar_token', t); }
  return t;
}

module.exports = {
  encrypt, decrypt, isSetUp, setPassword, checkPassword, createSession, sessionValid,
  passwordInUse, destroySession, destroyAllSessions, installId, rememberDevice, deviceLogin, forgetDeviceToken, listDevices, removeDevice, throttled, noteFail, clearFails, requireAuth, ownerOnly, calendarToken,
  sessionUser, checkLogin, listMembers, addMember, updateMember, removeMember,
};
