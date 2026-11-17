// Plaid: banks, credit cards, loans and investment accounts (12,000+ institutions).
// Keys come from https://dashboard.plaid.com (free Sandbox; Production needs Plaid approval).
const { db, getSetting } = require('../db');
const { encrypt, decrypt } = require('../security');
const { upsertAccount, upsertTransactions } = require('../engine/ingest');

const cfg = () => getSetting('plaid', {}) || {};
const configured = () => { const c = cfg(); return !!(c.client_id && c.secret); };

async function call(endpoint, body) {
  const c = cfg();
  if (!c.client_id || !c.secret) throw new Error('Plaid keys are not set (Settings → Integrations).');
  const env = c.env === 'production' ? 'production' : 'sandbox';
  const res = await fetch(`https://${env}.plaid.com${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: c.client_id, secret: c.secret, ...body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(json.display_message || json.error_message || `Plaid error ${res.status}`);
    e.code = json.error_code; e.type = json.error_type; throw e;
  }
  return json;
}

async function createLinkToken(connectionId) {
  const c = cfg();
  const body = {
    client_name: 'PocketFinance', language: 'en', country_codes: ['US', 'CA'],
    user: { client_user_id: 'pocketpilot-owner' },
  };
  if (c.redirect_uri) body.redirect_uri = c.redirect_uri;
  if (connectionId) {
    const conn = db.prepare('SELECT secret_enc FROM connections WHERE id=? AND provider=?').get(connectionId, 'plaid');
    if (!conn) throw new Error('Connection not found');
    body.access_token = decrypt(conn.secret_enc).access_token; // update mode (re-login)
  } else {
    body.products = ['transactions'];
    body.optional_products = ['liabilities', 'investments'];
    body.transactions = { days_requested: 730 };
  }
  return (await call('/link/token/create', body)).link_token;
}

async function exchange(publicToken, institution) {
  const r = await call('/item/public_token/exchange', { public_token: publicToken });
  const name = (institution && institution.name) || 'Bank';
  const info = db.prepare('INSERT INTO connections(provider,name,institution,secret_enc,created,status) VALUES(?,?,?,?,?,?)')
    .run('plaid', name, name, encrypt({ access_token: r.access_token, item_id: r.item_id }), Date.now(), 'ok');
  const id = Number(info.lastInsertRowid);
  await sync(id);
  return id;
}

const TYPE = { depository: 'depository', credit: 'credit', loan: 'loan', investment: 'investment', brokerage: 'investment', other: 'other' };

async function sync(connectionId) {
  const conn = db.prepare('SELECT * FROM connections WHERE id=?').get(connectionId);
  const { access_token } = decrypt(conn.secret_enc);
  // accounts + balances
  const acc = await call('/accounts/get', { access_token });
  const map = {};
  for (const a of acc.accounts) {
    map[a.account_id] = upsertAccount(connectionId, {
      external_id: a.account_id, name: a.name, official_name: a.official_name, mask: a.mask,
      type: TYPE[a.type] || 'other', subtype: a.subtype, currency: a.balances.iso_currency_code || 'USD',
      balance: a.balances.current ?? 0, available: a.balances.available, credit_limit: a.balances.limit, institution: conn.institution,
    });
  }
  // transactions (incremental cursor)
  let cursor = conn.cursor || null, added = 0, modified = 0, removed = 0;
  const start = cursor;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const adds = [], mods = [], rems = [];
      let more = true; cursor = start;
      while (more) {
        const r = await call('/transactions/sync', { access_token, cursor: cursor || undefined, count: 500 });
        adds.push(...r.added); mods.push(...r.modified); rems.push(...r.removed);
        cursor = r.next_cursor; more = r.has_more;
      }
      const byAcct = {};
      for (const t of [...adds, ...mods]) {
        if (!map[t.account_id]) continue;
        (byAcct[t.account_id] ||= []).push({
          external_id: t.transaction_id, date: t.authorized_date && t.pending ? t.authorized_date : t.date,
          amount: -t.amount, description: t.original_description || t.name, merchantName: t.merchant_name,
          pending: t.pending, pfc: t.personal_finance_category ? { primary: t.personal_finance_category.primary, detailed: t.personal_finance_category.detailed } : null,
          logo: t.logo_url || (t.counterparties && t.counterparties[0] && t.counterparties[0].logo_url) || null,
        });
      }
      for (const [aid, list] of Object.entries(byAcct)) { const r = upsertTransactions(map[aid], list); added += r.added; modified += r.updated; }
      // pending -> posted replaces the old id
      const del = db.prepare('DELETE FROM transactions WHERE external_id=? AND account_id IN (SELECT id FROM accounts WHERE connection_id=?)');
      for (const r of rems) { del.run(r.transaction_id, connectionId); removed++; }
      break;
    } catch (e) {
      if (e.code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && attempt < 2) continue;
      throw e;
    }
  }
  db.prepare('UPDATE connections SET cursor=? WHERE id=?').run(cursor, connectionId);

  // optional: liabilities (statement balance, due date, APR) and investment holdings
  try {
    const l = await call('/liabilities/get', { access_token });
    const all = [...(l.liabilities.credit || []), ...(l.liabilities.student || []), ...(l.liabilities.mortgage || [])];
    for (const x of all) if (map[x.account_id]) mergeMeta(map[x.account_id], {
      liability: {
        due_date: x.next_payment_due_date || null, minimum: x.minimum_payment_amount ?? x.next_monthly_payment ?? null,
        statement_balance: x.last_statement_balance ?? null, apr: x.aprs ? (x.aprs.find(a => a.apr_type === 'purchase_apr') || x.aprs[0] || {}).apr_percentage : x.interest_rate_percentage ?? (x.interest_rate && x.interest_rate.percentage) ?? null,
        is_overdue: x.is_overdue ?? null,
      },
    });
  } catch { /* product not enabled for this item */ }
  try {
    const h = await call('/investments/holdings/get', { access_token });
    const sec = Object.fromEntries(h.securities.map(s => [s.security_id, s]));
    const by = {};
    for (const x of h.holdings) (by[x.account_id] ||= []).push({
      name: (sec[x.security_id] || {}).name, ticker: (sec[x.security_id] || {}).ticker_symbol, quantity: x.quantity,
      value: x.institution_value, cost: x.cost_basis, type: (sec[x.security_id] || {}).type,
    });
    for (const [aid, holdings] of Object.entries(by)) if (map[aid]) mergeMeta(map[aid], { holdings });
  } catch { /* not an investment item */ }

  return { added, modified, removed, accounts: acc.accounts.length };
}

function mergeMeta(accountId, patch) {
  const r = db.prepare('SELECT meta FROM accounts WHERE id=?').get(accountId);
  let m = {}; try { m = JSON.parse(r.meta || '{}') || {}; } catch {}
  db.prepare('UPDATE accounts SET meta=? WHERE id=?').run(JSON.stringify({ ...m, ...patch }), accountId);
}

async function remove(connectionId) {
  const conn = db.prepare('SELECT secret_enc FROM connections WHERE id=?').get(connectionId);
  try { await call('/item/remove', { access_token: decrypt(conn.secret_enc).access_token }); } catch { /* already gone */ }
}

// Sandbox only: create a test item without the Link UI (used by the self-test).
async function sandboxItem(institution_id = 'ins_109508') {
  const r = await call('/sandbox/public_token/create', { institution_id, initial_products: ['transactions'] });
  return exchange(r.public_token, { name: 'Plaid Sandbox Bank' });
}

module.exports = { configured, createLinkToken, exchange, sync, remove, sandboxItem, mergeMeta };
