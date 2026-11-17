// Home values against a fake FHFA spreadsheet and a fake RentCast API: node test/homes.js
const os = require('os'), fs = require('fs'), path = require('path'), assert = require('assert'), http = require('http'), zlib = require('zlib');
process.env.PP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-homes-'));

// ---- build a small .xlsx like FHFA's (title rows, header, then ZIP3 / year / quarter / index rows)
function zip(files) {
  const locals = [], centrals = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text), data = zlib.deflateRawSync(raw), nb = Buffer.from(name), crc = zlib.crc32(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nb, data); centrals.push(ch, nb); off += 30 + nb.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
const strings = ['FHFA HPI® for Three-Digit ZIP Codes', 'Three-Digit ZIP Code', 'Year', 'Quarter', 'Index (NSA)', 'Index Type', 'Native 3-Digit ZIP index'];
const row = (r, cells) => `<row r="${r}">${cells.map((c, i) => { const ref = String.fromCharCode(65 + i) + r; return typeof c === 'number' ? `<c r="${ref}"><v>${c}</v></c>` : `<c r="${ref}" t="s"><v>${strings.indexOf(c)}</v></c>`; }).join('')}</row>`;
const rows = [row(1, [strings[0]]), row(2, ['Three-Digit ZIP Code', 'Year', 'Quarter', 'Index (NSA)', 'Index Type'])];
let r = 3;
for (let y = 2015; y <= 2026; y++) for (let q = 1; q <= 4; q++) {
  if (y === 2026 && q > 2) break;
  rows.push(row(r++, [606, y, q, +(200 * Math.pow(1.015, (y - 2015) * 4 + q - 1)).toFixed(2), 'Native 3-Digit ZIP index'])); // +1.5% a quarter
  rows.push(row(r++, [10, y, q, 150, 'Native 3-Digit ZIP index'])); // ZIP 010xx: flat (tests the leading zero)
}
const xlsx = zip({
  '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
  'xl/sharedStrings.xml': `<sst>${strings.map(s => `<si><t>${s.replace(/&/g, '&amp;')}</t></si>`).join('')}</sst>`,
  'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows.join('')}</sheetData></worksheet>`,
});

let fhfaHits = 0, rcHits = 0, rcMode = 'ok';
const mock = http.createServer((req, res) => {
  if (req.url.startsWith('/fhfa.xlsx')) { fhfaHits++; res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }); return res.end(xlsx); }
  if (req.url.startsWith('/v1/avm/value')) {
    rcHits++;
    if (req.headers['x-api-key'] !== 'rc_test_key_1234567890') { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"message":"bad key"}'); }
    if (rcMode === 'limit') { res.writeHead(429, { 'Content-Type': 'application/json' }); return res.end('{"message":"limit"}'); }
    const q = new URL(req.url, 'http://x').searchParams;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ price: 512345, priceRangeLow: 480000, priceRangeHigh: 545000, comparables: [{}, {}, {}], address: q.get('address'), beds: q.get('bedrooms') }));
  }
  res.writeHead(404); res.end();
});

(async () => {
  await new Promise(ok => mock.listen(0, '127.0.0.1', ok));
  const mb = `http://127.0.0.1:${mock.address().port}`;
  process.env.PP_FHFA_URL = mb + '/fhfa.xlsx'; process.env.PP_RENTCAST_BASE = mb;
  const app = require('../server/index.js');
  const { readXlsx } = require('../server/integrations/xlsx');
  const homes = require('../server/integrations/homes');
  const srv = app.listen(0, '127.0.0.1'); await new Promise(ok => srv.once('listening', ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-PP': '1', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  let ok = 0; const check = (name, cond, extra) => { assert.ok(cond, name + (extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 400) : '')); ok++; console.log('  ✓', name); };

  // xlsx reader
  const parsed = readXlsx(xlsx);
  check('xlsx reader reads strings + numbers', parsed[1][0] === 'Three-Digit ZIP Code' && parsed[2][0] === '606' && parsed[2][1] === '2015');
  check('quarter helper', homes.quarterOf('2015-06-30') === '2015Q2' && homes.quarterOf('2020-12-01') === '2020Q4');

  await call('POST', '/api/auth/setup', { password: 'correct horse' });

  // ---- price index valuation
  let r = (await call('POST', '/api/homes', { name: 'Chicago condo', address: '1 W Elm St, Chicago, IL 60614', base_value: 400000, base_date: '2015-02-10' })).body;
  check('home created + valued', r.id && r.valued && r.valued.method === 'index', r);
  // 2015Q1 -> 2026Q2 is 45 quarters at +1.5%
  const expect = Math.round(400000 * Math.pow(1.015, 45) / 100) * 100;
  check('index math', Math.abs(r.valued.value - expect) <= 200, [r.valued.value, expect]);
  check('downloaded index once', fhfaHits === 1);
  check('index cached to disk', fs.existsSync(homes.HPI_FILE));
  const home = r.id;
  let list = (await call('GET', '/api/homes')).body.homes;
  let h = list.find(x => x.id === home);
  check('zip pulled from address', h.home.zip === '60614', h.home);
  check('area 1-year change', Math.abs(h.home.area_change_1y - (Math.pow(1.015, 4) - 1) * 100) < 0.1, h.home.area_change_1y);
  check('gain since purchase', h.gain === h.value - 400000);
  check('counts in net worth', (await call('GET', '/api/networth')).body.summary.property >= h.value);
  r = (await call('POST', '/api/homes', { name: 'Cape house', zip: '01002', base_value: 300000, base_date: '2018-07-01' })).body;
  check('leading-zero ZIP area works', r.valued && r.valued.value === 300000, r);
  check('bad ZIP is a clear error', /No price index/.test((await call('POST', '/api/homes', { name: 'X', zip: '99999', base_value: 1, base_date: '2020-01-01' })).body.error || ''));
  check('missing price is a clear error', /what you paid/i.test((await call('POST', '/api/homes', { name: 'Y', zip: '60614' })).body.error || ''));
  check('failed adds leave nothing behind', (await call('GET', '/api/homes')).body.homes.length === 2);
  check('second lookup uses the cache', fhfaHits === 1);

  // ---- mortgage + equity
  const loan = (await call('POST', '/api/accounts', { name: 'Mortgage', type: 'loan', balance: 250000 })).body.id;
  await call('PUT', `/api/homes/${home}`, { mortgage_id: loan });
  h = (await call('GET', '/api/homes')).body.homes.find(x => x.id === home);
  check('equity = value − mortgage', h.mortgage && h.equity === h.value - 250000, [h.equity, h.value]);

  // ---- manual value
  await call('PUT', `/api/homes/${home}`, { source: 'manual', manual_value: 650000 });
  h = (await call('GET', '/api/homes')).body.homes.find(x => x.id === home);
  check('manual value wins', h.value === 650000 && h.home.method === 'manual');
  await call('PUT', `/api/homes/${home}`, { source: 'auto' });

  // ---- RentCast
  check('bad key format rejected', (await call('PUT', '/api/homes-settings', { rentcast_key: 'short' })).status === 400);
  check('key saved', (await call('PUT', '/api/homes-settings', { rentcast_key: 'rc_test_key_1234567890' })).body.rentcast === true);
  const stored = JSON.stringify(require('../server/db').getSetting('rentcast'));
  check('key stored encrypted', !stored.includes('rc_test_key'));
  await call('PUT', `/api/homes/${home}`, { bedrooms: 3 });
  h = (await call('GET', '/api/homes')).body.homes.find(x => x.id === home);
  check('market estimate used', h.value === 512345 && h.home.method === 'rentcast' && h.home.low === 480000 && h.home.high === 545000 && h.home.comps === 3, h.home);
  const before = rcHits;
  await homes.refreshAll();
  check('weekly refresh skips a fresh estimate', rcHits === before);
  check('forced refresh calls again', (await call('POST', `/api/homes/${home}/refresh`)).body.value === 512345 && rcHits === before + 1);
  rcMode = 'limit';
  const lim = (await call('POST', `/api/homes/${home}/refresh`)).body;
  check('RentCast limit falls back to the index', lim.method === 'index' && /limit/i.test(lim.note || ''), lim);
  rcMode = 'ok';
  check('history recorded', (await call('GET', `/api/accounts/${home}/history`)).body.length >= 1);
  check('remove key', (await call('PUT', '/api/homes-settings', { rentcast_key: '' })).body.rentcast === false);

  // ---- household rules apply
  await call('POST', '/api/members', { name: 'Kid', password: 'kid-view-pass', role: 'view' });
  let kc = '';
  const kid = async (method, url, body) => { const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-PP': '1', cookie: kc }, body: body ? JSON.stringify(body) : undefined }); const sc = res.headers.get('set-cookie'); if (sc) kc = sc.split(';')[0]; return res.status; };
  await kid('POST', '/api/auth/login', { password: 'kid-view-pass' });
  check('viewer sees homes', (await kid('GET', '/api/homes')) === 200);
  check('viewer cannot add homes', (await kid('POST', '/api/homes', { name: 'Z' })) === 403);
  check('viewer cannot set the key', (await kid('PUT', '/api/homes-settings', { rentcast_key: 'rc_test_key_1234567890' })) === 403);

  srv.close(); mock.close();
  console.log(`\n${ok} home value checks passed`);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
