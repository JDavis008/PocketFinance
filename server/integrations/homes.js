// Home values for property accounts.
//  - RentCast AVM (address-level market estimate + range), when the owner adds a free API key.
//  - Otherwise: last known value (purchase price or appraisal) grown by the FHFA House Price Index
//    for the home's 3-digit ZIP area (free, quarterly, published by the US Federal Housing Finance Agency).
const fs = require('fs');
const path = require('path');
const { db, getSetting, setSetting, DATA_DIR } = require('../db');
const sec = require('../security');
const { upsertAccount, snapshot } = require('../engine/ingest');
const { today, round2, daysBetween } = require('../util');
const { readXlsx } = require('./xlsx');

const FHFA_URL = process.env.PP_FHFA_URL || 'https://www.fhfa.gov/hpi/download/quarterly_datasets/hpi_at_3zip.xlsx';
const RENTCAST = (process.env.PP_RENTCAST_BASE || 'https://api.rentcast.io').replace(/\/$/, '');
const HPI_FILE = path.join(DATA_DIR, 'hpi-zip3.json');
const bad = msg => Object.assign(new Error(msg), { status: 400 });

// ---------------------------------------------------------------- FHFA index
let hpiCache = null;
async function hpi({ force } = {}) {
  if (!force && hpiCache && Date.now() - hpiCache.fetched < 30 * 864e5) return hpiCache;
  if (!force && fs.existsSync(HPI_FILE)) {
    try { const j = JSON.parse(fs.readFileSync(HPI_FILE, 'utf8')); if (Date.now() - j.fetched < 30 * 864e5) return (hpiCache = j); hpiCache = j; } catch {}
  }
  try {
    const r = await fetch(FHFA_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (PocketFinance home value)' }, signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`FHFA download failed (${r.status})`);
    const rows = readXlsx(Buffer.from(await r.arrayBuffer()));
    const zips = {}; let latest = '';
    for (const row of rows) {
      if (!/^\d{1,3}$/.test(row[0] || '') || !/^\d{4}$/.test(row[1] || '')) continue;
      const z = row[0].padStart(3, '0'), q = `${row[1]}Q${row[2]}`, v = Number(row[3]);
      if (!Number.isFinite(v)) continue;
      (zips[z] ||= {})[q] = v; if (q > latest) latest = q;
    }
    if (!Object.keys(zips).length) throw new Error('FHFA file had no index rows');
    hpiCache = { fetched: Date.now(), latest, zips };
    fs.writeFileSync(HPI_FILE, JSON.stringify(hpiCache));
    return hpiCache;
  } catch (e) {
    if (hpiCache) return hpiCache; // keep using the older copy if the refresh fails
    throw Object.assign(new Error(`Couldn't load the home price index: ${e.message}`), { status: 502 });
  }
}
const quarterOf = d => `${d.slice(0, 4)}Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
async function indexValue(home) {
  const zip = String(home.zip || '').replace(/\D/g, '').slice(0, 5);
  if (zip.length < 3) throw bad('Add the ZIP code to estimate the value.');
  if (!(home.base_value > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(home.base_date || '')) throw bad('Add what you paid (or an appraisal) and the date.');
  const data = await hpi();
  const series = data.zips[zip.slice(0, 3)];
  if (!series) throw bad(`No price index for ZIP ${zip.slice(0, 3)}xx (US ZIP codes only).`);
  const qs = Object.keys(series).sort();
  const baseQ = quarterOf(home.base_date);
  const from = series[baseQ] ?? (baseQ < qs[0] ? null : series[qs.filter(q => q <= baseQ).pop()]);
  if (!from) throw bad(`The index for this area starts in ${qs[0]}; use a later appraisal date.`);
  const lastQ = qs[qs.length - 1], to = series[lastQ];
  const value = Math.round(home.base_value * to / from / 100) * 100;
  // yearly change in the area, for context
  const yearAgoQ = `${Number(lastQ.slice(0, 4)) - 1}${lastQ.slice(4)}`;
  const yoy = series[yearAgoQ] ? round2((to / series[yearAgoQ] - 1) * 100) : null;
  return { value, method: 'index', as_of: lastQ, area_change_1y: yoy, growth: round2((to / from - 1) * 100) };
}

// ---------------------------------------------------------------- RentCast AVM
function rentcastKey() { const s = getSetting('rentcast'); try { return s && s.key_enc ? sec.decrypt(s.key_enc) : null; } catch { return null; } }
async function rentcastValue(home) {
  const key = rentcastKey(); if (!key) return null;
  if (!home.address) throw bad('Add the full street address for a market estimate.');
  const q = new URLSearchParams({ address: home.address });
  for (const k of ['propertyType', 'bedrooms', 'bathrooms', 'squareFootage']) if (home[k]) q.set(k, home[k]);
  const r = await fetch(`${RENTCAST}/v1/avm/value?${q}`, { headers: { 'X-Api-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error('RentCast rejected the API key — check it in Settings → Home values.'), { status: 400 });
  if (r.status === 429) throw Object.assign(new Error('RentCast monthly limit reached — the free plan includes 50 lookups a month.'), { status: 429 });
  if (!r.ok || !(j.price > 0)) throw Object.assign(new Error(j.message || `RentCast couldn't value this address (${r.status}).`), { status: 400 });
  return { value: Math.round(j.price), low: j.priceRangeLow ? Math.round(j.priceRangeLow) : null, high: j.priceRangeHigh ? Math.round(j.priceRangeHigh) : null,
    method: 'rentcast', as_of: today(), comps: Array.isArray(j.comparables) ? j.comparables.length : null };
}

// ---------------------------------------------------------------- homes (property accounts)
const metaOf = a => { try { return JSON.parse(a.meta || 'null') || {}; } catch { return {}; } };
function list() {
  return db.prepare("SELECT id, name, balance, meta, updated FROM accounts WHERE type='property' AND hidden=0 ORDER BY balance DESC").all().map(a => {
    const m = metaOf(a), h = m.home || {};
    const mort = h.mortgage_id ? db.prepare('SELECT id, name, balance FROM accounts WHERE id=?').get(h.mortgage_id) : null;
    const hist = db.prepare('SELECT date, balance FROM balance_history WHERE account_id=? ORDER BY date').all(a.id);
    return { id: a.id, name: a.name, value: a.balance, home: h, mortgage: mort || null, equity: round2(a.balance - (mort ? mort.balance : 0)),
      gain: h.base_value ? round2(a.balance - h.base_value) : null, history: hist.length > 120 ? hist.filter((p, i) => i % Math.ceil(hist.length / 120) === 0 || i === hist.length - 1) : hist };
  });
}
function cleanHome(b, cur = {}) {
  const h = { ...cur };
  const str = (k, n = 160) => { if (b[k] !== undefined) h[k] = String(b[k] || '').trim().slice(0, n) || null; };
  str('address'); str('zip', 10); str('propertyType', 30);
  for (const k of ['bedrooms', 'bathrooms', 'squareFootage']) if (b[k] !== undefined) h[k] = b[k] === '' || b[k] == null ? null : Math.max(0, Number(b[k])) || null;
  if (b.base_value !== undefined) h.base_value = b.base_value === '' || b.base_value == null ? null : Math.abs(Number(b.base_value)) || null;
  if (b.base_date !== undefined) { if (b.base_date && !/^\d{4}-\d{2}-\d{2}$/.test(b.base_date)) throw bad('Date must be YYYY-MM-DD.'); h.base_date = b.base_date || null; }
  if (b.mortgage_id !== undefined) h.mortgage_id = b.mortgage_id ? Number(b.mortgage_id) : null;
  if (b.source !== undefined) h.source = ['auto', 'manual'].includes(b.source) ? b.source : 'auto';
  if (b.manual_value !== undefined && b.manual_value !== '' && b.manual_value != null) h.manual_value = Math.abs(Number(b.manual_value)) || null;
  if (!h.zip && h.address) { const m = h.address.match(/\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/); if (m) h.zip = m[1]; }
  return h;
}
function saveMeta(id, home) {
  const a = db.prepare('SELECT meta FROM accounts WHERE id=?').get(id);
  db.prepare('UPDATE accounts SET meta=? WHERE id=?').run(JSON.stringify({ ...metaOf(a || {}), home }), id);
}

/** Value one home. Uses RentCast when a key is set (weekly, to stay inside the free plan), else the price index. */
async function valuate(id, { force } = {}) {
  const a = db.prepare("SELECT * FROM accounts WHERE id=? AND type='property'").get(id); if (!a) throw bad('Home not found');
  const home = metaOf(a).home || {};
  let v = null, note = null;
  if (home.source === 'manual') {
    v = { value: home.manual_value || a.balance, method: 'manual', as_of: today() };
  } else {
    const fresh = home.last_valued && daysBetween(home.last_valued, today()) < 7;
    if (rentcastKey() && home.address && (force || !fresh || home.method !== 'rentcast')) {
      try { v = await rentcastValue(home); } catch (e) { note = e.message; }
    } else if (rentcastKey() && fresh && home.method === 'rentcast') {
      return { id, value: a.balance, method: 'rentcast', skipped: true };
    }
    if (!v) v = await indexValue(home);
  }
  const next = { ...home, method: v.method, as_of: v.as_of, last_valued: today(), low: v.low ?? null, high: v.high ?? null,
    area_change_1y: v.area_change_1y ?? home.area_change_1y ?? null, comps: v.comps ?? null, note };
  saveMeta(id, next);
  db.prepare('UPDATE accounts SET balance=?, updated=? WHERE id=?').run(v.value, Date.now(), id);
  snapshot(id, v.value);
  return { id, value: v.value, method: v.method, note };
}

async function create(b) {
  const name = String(b.name || '').trim().slice(0, 80) || (b.address ? String(b.address).split(',')[0] : 'Home');
  const home = cleanHome({ source: 'auto', ...b });
  const start = home.manual_value || home.base_value || 0;
  const id = upsertAccount(null, { external_id: 'home-' + Date.now(), name, type: 'property', balance: start, institution: 'Home value', manual: true });
  saveMeta(id, home);
  try { return { id, valued: await valuate(id, { force: true }), error: null }; }
  catch (e) { db.prepare('DELETE FROM accounts WHERE id=?').run(id); throw Object.assign(new Error(e.message), { status: e.status || 400 }); } // don't leave a $0 home behind
}
async function update(id, b) {
  const a = db.prepare("SELECT * FROM accounts WHERE id=? AND type='property'").get(id); if (!a) throw bad('Home not found');
  if (b.name) db.prepare('UPDATE accounts SET name=? WHERE id=?').run(String(b.name).slice(0, 80), id);
  saveMeta(id, cleanHome(b, metaOf(a).home || {}));
  let valued = null, error = null;
  try { valued = await valuate(id, { force: true }); } catch (e) { error = e.message; }
  return { valued, error };
}
// called after each sync: index values refresh as FHFA publishes; RentCast weekly
async function refreshAll() {
  const out = [];
  for (const h of db.prepare("SELECT id, meta FROM accounts WHERE type='property' AND hidden=0").all()) {
    const home = metaOf(h).home; if (!home || home.source === 'manual') continue;
    try { out.push(await valuate(h.id)); } catch (e) { out.push({ id: h.id, error: e.message }); }
  }
  return out;
}

function settings() { const s = getSetting('rentcast') || {}; return { rentcast: !!s.key_enc, hpi: hpiCache ? { latest: hpiCache.latest, fetched: hpiCache.fetched } : null }; }
async function saveSettings(b) {
  if (b.rentcast_key === '' || b.rentcast_key === null) { setSetting('rentcast', null); return settings(); }
  const key = String(b.rentcast_key || '').trim();
  if (!/^[A-Za-z0-9_\-]{16,128}$/.test(key)) throw bad("That doesn't look like a RentCast API key.");
  setSetting('rentcast', { key_enc: sec.encrypt(key) });
  return settings();
}

module.exports = { hpi, indexValue, rentcastValue, list, create, update, valuate, refreshAll, settings, saveSettings, quarterOf, HPI_FILE };
