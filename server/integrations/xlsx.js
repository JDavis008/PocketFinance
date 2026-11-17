// Minimal .xlsx reader (first worksheet → array of rows of strings). No dependencies:
// an .xlsx file is a zip of XML parts, so this reads the zip directory, inflates the two parts it needs,
// and pulls cell values out of the XML.
const zlib = require('zlib');

function unzip(buf) {
  // find the End Of Central Directory record
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip / xlsx file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad zip directory');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    files[name] = () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + csize);
      return method === 0 ? data : zlib.inflateRawSync(data);
    };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const unxml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(d)).replace(/&amp;/g, '&');
const colIndex = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

function readXlsx(buf) {
  const files = unzip(buf);
  const shared = [];
  if (files['xl/sharedStrings.xml']) {
    const xml = files['xl/sharedStrings.xml']().toString('utf8');
    for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) || []) shared.push(unxml((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join('')));
  }
  const sheetName = Object.keys(files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  if (!sheetName) throw new Error('No worksheet found');
  const xml = files[sheetName]().toString('utf8');
  const rows = [];
  for (const row of xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []) {
    const out = [];
    for (const c of row.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
      const ref = (c.match(/ r="([A-Z]+\d+)"/) || [])[1];
      const type = (c.match(/ t="(\w+)"/) || [])[1];
      let v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (type === 'inlineStr') v = ((c.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1]);
      if (v == null) continue;
      v = type === 's' ? shared[Number(v)] : unxml(v);
      out[ref ? colIndex(ref) : out.length] = v;
    }
    rows.push(Array.from(out, x => (x == null ? '' : x)));
  }
  return rows;
}

module.exports = { readXlsx };
