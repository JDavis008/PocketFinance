// Runs every provider's sync, then recurring detection and alerts. Also the background schedule.
const { db, getSetting } = require('./db');
const plaid = require('./integrations/plaid');
const simplefin = require('./integrations/simplefin');
const crypto = require('./integrations/crypto');
const teller = require('./integrations/teller');
const recurring = require('./engine/recurring');
const alerts = require('./engine/alerts');
const { snapshot } = require('./engine/ingest');

const PROVIDERS = { plaid, simplefin, crypto, teller };
let running = null;

async function syncConnection(id) {
  const c = db.prepare('SELECT * FROM connections WHERE id=?').get(id);
  if (!c || !PROVIDERS[c.provider]) return { skipped: true };
  try {
    const r = await PROVIDERS[c.provider].sync(id);
    db.prepare("UPDATE connections SET status='ok', error=COALESCE(?, NULL), last_sync=? WHERE id=?").run(r.warnings || null, Date.now(), id);
    return r;
  } catch (e) {
    const needsLogin = ['ITEM_LOGIN_REQUIRED', 'PENDING_EXPIRATION', 'ACCESS_NOT_GRANTED', 'TELLER_RECONNECT'].includes(e.code);
    db.prepare("UPDATE connections SET status='error', error=? WHERE id=?").run(needsLogin ? 'Bank login expired — click Reconnect.' : e.message, id);
    return { error: e.message, code: e.code };
  }
}

function afterSync() {
  // daily balance snapshot for manual accounts so net-worth history stays continuous
  for (const a of db.prepare('SELECT id, balance FROM accounts WHERE manual=1').all()) snapshot(a.id, a.balance);
  const events = recurring.detect();
  alerts.evaluate(events);
  return events;
}

async function syncAll() {
  if (running) return running;
  running = (async () => {
    const results = {};
    for (const c of db.prepare("SELECT id FROM connections WHERE provider IN ('plaid','simplefin','crypto','teller')").all()) results[c.id] = await syncConnection(c.id);
    // home values (price index refresh; RentCast at most weekly per home)
    try { await require('./integrations/homes').refreshAll(); } catch (e) { console.error('home values', e.message); }
    const events = afterSync();
    return { results, events: events.length };
  })();
  try { return await running; } finally { running = null; }
}

function startSchedule() {
  const tick = async () => {
    try { const b = require('./autobackup').run(); if (b) console.log('automatic backup saved', b); } catch (e) { console.error('automatic backup failed', e.message); }
    const hours = Number(getSetting('sync_hours', 6)) || 6;
    const last = Number(getSetting('last_auto_sync', 0)) || 0;
    if (Date.now() - last >= hours * 3600e3) {
      require('./db').setSetting('last_auto_sync', Date.now());
      try { await syncAll(); } catch (e) { console.error('auto sync failed', e); }
    }
  };
  setTimeout(tick, 15e3);
  setInterval(tick, 10 * 60e3);
}

module.exports = { syncAll, syncConnection, afterSync, startSchedule };
