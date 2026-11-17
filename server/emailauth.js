// Email sign-in codes and "Forgot password": a 6-digit code is emailed to the owner's or a member's address.
// Mail goes out through the owner's own email account (SMTP, e.g. Gmail with an app password), set in Settings → Email.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, getSetting, setSetting } = require('./db');
const sec = require('./security');

const CODE_MINUTES = 15, MAX_TRIES = 5, MAX_CODES_PER_HOUR = 5;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const normEmail = e => String(e || '').trim().toLowerCase().slice(0, 120);
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');

db.exec(`CREATE TABLE IF NOT EXISTS auth_codes (id INTEGER PRIMARY KEY, email TEXT, member_id INTEGER, code_hash TEXT, purpose TEXT, expires INTEGER, tries INTEGER DEFAULT 0, created INTEGER)`);
if (!db.prepare('PRAGMA table_info(members)').all().some(c => c.name === 'email')) db.exec('ALTER TABLE members ADD COLUMN email TEXT');

// ---- whose address is it ----
const ownerEmail = () => normEmail(getSetting('owner_email', ''));
function findByEmail(email) {
  email = normEmail(email);
  if (!email) return null;
  if (email === ownerEmail()) return { memberId: null, name: getSetting('owner_name', '') || 'Owner' };
  const m = db.prepare('SELECT id, name FROM members WHERE lower(email)=?').get(email);
  return m ? { memberId: m.id, name: m.name } : null;
}
function emailTaken(email, exceptMemberId) {
  if (!email) return false;
  if (email === ownerEmail() && exceptMemberId !== null) return true;
  return db.prepare('SELECT id FROM members WHERE lower(email)=?').all(email).some(m => m.id !== exceptMemberId);
}
function setOwnerEmail(email) {
  email = normEmail(email);
  if (email && !validEmail(email)) throw bad("That doesn't look like an email address.");
  if (emailTaken(email, null)) throw bad('A household member already uses that email.');
  setSetting('owner_email', email);
}
function setMemberEmail(id, email) {
  email = normEmail(email);
  if (email && !validEmail(email)) throw bad("That doesn't look like an email address.");
  if (emailTaken(email, id)) throw bad('Someone else in this household already uses that email.');
  db.prepare('UPDATE members SET email=? WHERE id=?').run(email || null, id);
}

// ---- sending mail ----
function smtpCfg() {
  const c = getSetting('smtp') || {};
  return { host: c.host || '', port: Number(c.port) || 465, user: c.user || '', from: c.from || c.user || '', pass: c.pass ? sec.decrypt(c.pass) : '' };
}
const configured = () => !!process.env.PP_MAIL_OUTBOX || (() => { const c = smtpCfg(); return !!(c.host && c.user && c.pass); })();
function saveSmtp(b) {
  const old = getSetting('smtp') || {};
  const host = String(b.host || '').trim(), user = String(b.user || '').trim();
  const port = Number(b.port) || 465;
  if (host && !/^[a-z0-9.-]+$/i.test(host)) throw bad('Enter the mail server name, like smtp.gmail.com.');
  if (user && !validEmail(normEmail(user)) && !/^[\w.@+-]+$/.test(user)) throw bad('Enter the email account name.');
  setSetting('smtp', {
    host, port, user, from: String(b.from || '').trim(),
    pass: b.pass ? sec.encrypt(String(b.pass).replace(/\s+/g, '')) : (b.clear ? '' : old.pass || ''), // Gmail shows app passwords with spaces
  });
}
const smtpStatus = () => { const c = smtpCfg(); return { host: c.host, port: c.port, user: c.user, from: c.from, has_password: !!c.pass, configured: configured(), owner_email: ownerEmail() }; };

async function sendMail(to, subject, text) {
  if (process.env.PP_MAIL_OUTBOX) { // tests: write the message to a folder instead of sending it
    fs.mkdirSync(process.env.PP_MAIL_OUTBOX, { recursive: true });
    fs.writeFileSync(path.join(process.env.PP_MAIL_OUTBOX, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}.json`), JSON.stringify({ to, subject, text }));
    return;
  }
  const c = smtpCfg();
  if (!c.host || !c.user || !c.pass) throw bad("Email isn't set up on this PocketFinance yet. The owner can set it up in Settings → Email.");
  const nodemailer = require('nodemailer');
  const t = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.port === 465, auth: { user: c.user, pass: c.pass }, connectionTimeout: 15000, greetingTimeout: 15000 });
  try { await t.sendMail({ from: `PocketFinance <${c.from || c.user}>`, to, subject, text }); }
  catch (e) { throw bad(/auth|535|534/i.test(e.message) ? 'The email account rejected the sign-in. For Gmail, use an app password (myaccount.google.com/apppasswords), not your normal password.' : `Couldn't send the email: ${e.message}`); }
}

// ---- codes ----
const recent = new Map(); // email -> [timestamps], limits codes per hour
async function requestCode(emailIn, purpose) {
  const email = normEmail(emailIn);
  if (!validEmail(email)) throw bad('Enter the email address on your PocketFinance account.');
  if (!configured()) throw bad("Email isn't set up on this PocketFinance yet. The owner can set it up in Settings → Email, or reset the password on the PC (npm run reset-password).");
  const times = (recent.get(email) || []).filter(t => Date.now() - t < 3600e3);
  if (times.length >= MAX_CODES_PER_HOUR) throw bad('Too many codes. Wait a while and try again.');
  times.push(Date.now()); recent.set(email, times);
  const who = findByEmail(email);
  if (!who) return { sent: true }; // same answer either way, so nobody can test which addresses exist
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  db.prepare('DELETE FROM auth_codes WHERE email=?').run(email);
  db.prepare('INSERT INTO auth_codes(email,member_id,code_hash,purpose,expires,created) VALUES(?,?,?,?,?,?)')
    .run(email, who.memberId, sha(email + ':' + code), purpose === 'reset' ? 'reset' : 'login', Date.now() + CODE_MINUTES * 60e3, Date.now());
  const what = purpose === 'reset' ? 'reset your PocketFinance password' : 'sign in to PocketFinance';
  await sendMail(email, `${code} is your PocketFinance code`,
    `Hi ${who.name},\n\nUse this code to ${what}:\n\n    ${code}\n\nIt works for ${CODE_MINUTES} minutes. If you didn't ask for it, ignore this email; your password hasn't changed.\n\n— PocketFinance`);
  return { sent: true };
}

// Checks the code; with newPassword also sets a new password. Signs in on success.
function useCode(res, emailIn, codeIn, newPassword) {
  const email = normEmail(emailIn), code = String(codeIn || '').replace(/\D/g, '');
  const row = db.prepare('SELECT * FROM auth_codes WHERE email=? ORDER BY id DESC').get(email);
  const wrong = () => bad('That code is wrong or has expired. Ask for a new one.', 401);
  if (!row || row.expires < Date.now() || row.tries >= MAX_TRIES) throw wrong();
  if (sha(email + ':' + code) !== row.code_hash) { db.prepare('UPDATE auth_codes SET tries=tries+1 WHERE id=?').run(row.id); throw wrong(); }
  const who = findByEmail(email);
  if (!who || who.memberId !== row.member_id) { db.prepare('DELETE FROM auth_codes WHERE id=?').run(row.id); throw wrong(); }
  if (newPassword != null) {
    const pw = String(newPassword);
    if (pw.length < 8) throw bad('Use at least 8 characters.');
    if (who.memberId === null) {
      if (sec.passwordInUse(pw)) throw bad('That password is already used by someone in this household. Pick a different one.');
      sec.setPassword(pw); sec.destroyAllSessions();
    }
    else sec.updateMember(who.memberId, { password: pw });
  }
  db.prepare('DELETE FROM auth_codes WHERE email=?').run(email);
  sec.createSession(res, who.memberId);
  return { ok: true, reset: newPassword != null };
}

module.exports = { requestCode, useCode, sendMail, saveSmtp, smtpStatus, configured, setOwnerEmail, setMemberEmail, ownerEmail, normEmail };
