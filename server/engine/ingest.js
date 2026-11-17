// Shared write path for accounts, balances and transactions coming from any source.
const { db, tx } = require('../db');
const { categorize } = require('./categorize');
const { today, addDays } = require('../util');

const LIABILITY = new Set(['credit', 'loan']);

function upsertAccount(connectionId, a) {
  const now = Date.now();
  const existing = db.prepare('SELECT id FROM accounts WHERE connection_id IS ? AND external_id=?').get(connectionId, a.external_id);
  if (existing) {
    db.prepare(`UPDATE accounts SET balance=?, available=?, credit_limit=?, official_name=COALESCE(?,official_name),
      mask=COALESCE(?,mask), currency=COALESCE(?,currency), institution=COALESCE(?,institution), updated=?, meta=COALESCE(?,meta) WHERE id=?`)
      .run(a.balance ?? 0, a.available ?? null, a.credit_limit ?? null, a.official_name ?? null, a.mask ?? null,
        a.currency ?? null, a.institution ?? null, now, a.meta ? JSON.stringify(a.meta) : null, existing.id);
    snapshot(existing.id, a.balance ?? 0);
    return existing.id;
  }
  const r = db.prepare(`INSERT INTO accounts(connection_id,external_id,name,official_name,mask,type,subtype,currency,balance,available,credit_limit,institution,manual,updated,meta)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(connectionId, a.external_id, a.name, a.official_name ?? null, a.mask ?? null,
    a.type || 'depository', a.subtype ?? null, a.currency || 'USD', a.balance ?? 0, a.available ?? null, a.credit_limit ?? null,
    a.institution ?? null, a.manual ? 1 : 0, now, a.meta ? JSON.stringify(a.meta) : null);
  const id = Number(r.lastInsertRowid);
  snapshot(id, a.balance ?? 0);
  return id;
}

function snapshot(accountId, balance, date = today()) {
  db.prepare('INSERT INTO balance_history(account_id,date,balance) VALUES(?,?,?) ON CONFLICT(account_id,date) DO UPDATE SET balance=excluded.balance')
    .run(accountId, date, balance);
}

/**
 * items: [{external_id, date, amount (negative = money out), description, pending, merchantName?, pfc?, category?, notes?, logo?}]
 * Returns {added, updated}.
 */
function upsertTransactions(accountId, items) {
  let added = 0, updated = 0;
  const find = db.prepare('SELECT id, user_category FROM transactions WHERE account_id=? AND external_id=?');
  const ins = db.prepare(`INSERT INTO transactions(account_id,external_id,date,amount,description,merchant,merchant_key,category,pending,notes,excluded,provider_category,logo,created,reviewed,tags)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  // new transactions from the last 30 days go to the review inbox; older history (first sync, imports) does not
  const reviewCutoff = addDays(today(), -30);
  const updAuto = db.prepare('UPDATE transactions SET date=?, amount=?, description=?, pending=?, merchant=?, merchant_key=?, category=?, excluded=?, provider_category=?, logo=COALESCE(?,logo) WHERE id=?');
  const updUser = db.prepare('UPDATE transactions SET date=?, amount=?, description=?, pending=?, provider_category=?, logo=COALESCE(?,logo) WHERE id=?');
  tx(() => {
    for (const it of items) {
      const t = categorize({ description: it.description, amount: it.amount, category: it.category || null, merchant: it.merchant || null, excluded: it.excluded },
        { merchantName: it.merchantName, pfc: it.pfc });
      const pc = it.pfc ? JSON.stringify({ ...it.pfc, merchant_name: it.merchantName || null }) : null;
      const ex = find.get(accountId, it.external_id);
      if (ex) {
        if (ex.user_category) updUser.run(it.date, it.amount, it.description, it.pending ? 1 : 0, pc, it.logo || null, ex.id);
        else updAuto.run(it.date, it.amount, it.description, it.pending ? 1 : 0, t.merchant, t.merchant_key, t.category, t.excluded ? 1 : 0, pc, it.logo || null, ex.id);
        updated++;
      } else {
        ins.run(accountId, it.external_id, it.date, it.amount, it.description, t.merchant, t.merchant_key, t.category,
          it.pending ? 1 : 0, it.notes || null, t.excluded ? 1 : 0, pc, it.logo || null, Date.now(),
          it.reviewed != null ? (it.reviewed ? 1 : 0) : (it.date >= reviewCutoff ? 0 : 1), t.ruleTags ? require('./reports').normTags(t.ruleTags) : null);
        added++;
      }
    }
  });
  return { added, updated };
}

function removeTransactions(accountIdByExternal, externalIds) {
  const del = db.prepare('DELETE FROM transactions WHERE external_id=? AND account_id IN (SELECT id FROM accounts WHERE connection_id=?)');
  tx(() => externalIds.forEach(id => del.run(id, accountIdByExternal)));
}

module.exports = { upsertAccount, upsertTransactions, removeTransactions, snapshot, LIABILITY };
