// Receipt / document attachments on transactions, stored as files in data\receipts.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, DATA_DIR } = require('./db');

const DIR = path.join(DATA_DIR, 'receipts');
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PER_TX = 10;
const bad = msg => Object.assign(new Error(msg), { status: 400 });

// identify the file by its first bytes, never by the name or the browser's claim
function sniff(buf) {
  const h = buf.subarray(0, 16);
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return ['image/jpeg', 'jpg'];
  if (h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ['image/png', 'png'];
  if (h.subarray(0, 4).toString('latin1') === 'GIF8') return ['image/gif', 'gif'];
  if (h.subarray(0, 4).toString('latin1') === 'RIFF' && h.subarray(8, 12).toString('latin1') === 'WEBP') return ['image/webp', 'webp'];
  if (h.subarray(0, 5).toString('latin1') === '%PDF-') return ['application/pdf', 'pdf'];
  if (h.subarray(4, 8).toString('latin1') === 'ftyp' && /^(heic|heix|mif1|msf1|hevc)$/.test(h.subarray(8, 12).toString('latin1'))) return ['image/heic', 'heic'];
  return null;
}

function add(txId, body) {
  if (!db.prepare('SELECT id FROM transactions WHERE id=?').get(txId)) throw bad('Transaction not found.');
  if (db.prepare('SELECT COUNT(*) n FROM attachments WHERE tx_id=?').get(txId).n >= MAX_PER_TX) throw bad(`Up to ${MAX_PER_TX} files per transaction.`);
  const b64 = String(body.data || '').replace(/^data:[^,]*,/, '');
  if (!b64) throw bad('No file received.');
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) throw bad('The file is empty.');
  if (buf.length > MAX_BYTES) throw bad('Files can be up to 10 MB.');
  const kind = sniff(buf);
  if (!kind) throw bad('Only photos (JPG, PNG, WEBP, GIF, HEIC) and PDFs can be attached.');
  fs.mkdirSync(DIR, { recursive: true });
  const file = `${txId}-${crypto.randomBytes(9).toString('hex')}.${kind[1]}`;
  fs.writeFileSync(path.join(DIR, file), buf);
  const filename = (String(body.filename || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim() || `receipt.${kind[1]}`).slice(0, 120);
  const id = Number(db.prepare('INSERT INTO attachments(tx_id,filename,mime,size,file,created) VALUES(?,?,?,?,?,?)').run(txId, filename, kind[0], buf.length, file, Date.now()).lastInsertRowid);
  return { id, filename, mime: kind[0], size: buf.length };
}

function pathOf(file) {
  if (!/^[\w.-]+$/.test(file || '')) return null;
  const p = path.join(DIR, file);
  return fs.existsSync(p) ? p : null;
}
function removeFile(file) { const p = pathOf(file); if (p) try { fs.unlinkSync(p); } catch {} }
function remove(id) {
  const a = db.prepare('SELECT file FROM attachments WHERE id=?').get(id);
  if (!a) throw bad('Not found');
  db.prepare('DELETE FROM attachments WHERE id=?').run(id);
  removeFile(a.file);
}

// delete files whose transaction is gone (accounts removed, demo data cleared)
function sweep() {
  if (!fs.existsSync(DIR)) return 0;
  const keep = new Set(db.prepare('SELECT file FROM attachments').all().map(r => r.file));
  let n = 0; for (const f of fs.readdirSync(DIR)) if (!keep.has(f)) { try { fs.unlinkSync(path.join(DIR, f)); n++; } catch {} }
  return n;
}

module.exports = { add, remove, removeFile, pathOf, sniff, sweep, DIR };
