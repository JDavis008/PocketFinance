// Sample household data so every screen can be tried before linking real accounts.
const { db, tx, getSetting, setSetting } = require('./db');
require('./ious'); // creates the ious table
require('./family'); // creates the kids tables
const { upsertAccount, upsertTransactions, snapshot } = require('./engine/ingest');
const { today, addDays, addMonths, round2 } = require('./util');

function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }

function load() {
  clear();
  const r = rng(42);
  const pick = a => a[Math.floor(r() * a.length)];
  const t = today();
  const start = addMonths(t, -13);
  const conn = Number(db.prepare("INSERT INTO connections(provider,name,institution,created,status,last_sync) VALUES('demo','Demo Bank','Demo Bank',?,'ok',?)").run(Date.now(), Date.now()).lastInsertRowid);
  const acct = (ext, name, type, balance, extra = {}) => upsertAccount(conn, { external_id: ext, name, type, balance, institution: 'Demo Bank', ...extra });
  const checking = acct('chk', 'Everyday Checking', 'depository', 0, { mask: '4821', subtype: 'checking' });
  const savings = acct('sav', 'High-Yield Savings', 'depository', 0, { mask: '1190', subtype: 'savings' });
  const card = acct('cc', 'Rewards Visa', 'credit', 0, { mask: '7713', credit_limit: 12000 });
  const k401 = acct('401k', '401(k) Retirement', 'investment', 0, { subtype: '401k' });
  const loan = acct('auto', 'Auto Loan', 'loan', 0, { subtype: 'auto' });

  const C = [], K = [], S = [];
  const add = (list, date, amount, description) => list.push({ external_id: `d${list.length}_${date}`, date, amount: round2(amount), description });
  // paychecks every other Friday
  let d = start; while (new Date(d).getDay() !== 5) d = addDays(d, 1);
  for (; d <= t; d = addDays(d, 14)) add(C, d, 2480 + (d > addMonths(t, -5) ? 120 : 0), 'ACME CORP PAYROLL DIR DEP');
  // monthly bills
  for (let m = 0; m <= 13; m++) {
    const base = addMonths(start, m).slice(0, 8);
    const day = n => `${base}${String(n).padStart(2, '0')}`;
    const inRange = s => s <= t && s >= start;
    if (inRange(day(1))) add(C, day(1), -1650, 'OAKWOOD APARTMENTS RENT ACH');
    if (inRange(day(3))) add(K, day(3), day(3) > addMonths(t, -4) ? -17.99 : -15.49, 'NETFLIX.COM 866-579-7172 CA');
    if (inRange(day(7))) add(K, day(7), -11.99, 'SPOTIFY USA 877-778-1161');
    if (inRange(day(9))) add(K, day(9), -2.99, 'APPLE.COM/BILL ICLOUD');
    if (inRange(day(11))) add(K, day(11), m > 9 ? -18.99 : -17.99, 'HULU 877-8244858 CA');
    if (inRange(day(14))) add(K, day(14), -24.99, 'PLANET FITNESS CLUB FEES');
    if (inRange(day(15))) add(C, day(15), -85.40, 'VERIZON WIRELESS PAYMENTS');
    if (inRange(day(18))) add(C, day(18), -79.99, 'COMCAST XFINITY INTERNET');
    if (inRange(day(21))) add(C, day(21), -(95 + r() * 70), 'DUKE ENERGY PAYMENT');
    if (inRange(day(22))) add(C, day(22), -142.50, 'GEICO AUTO INSURANCE');
    if (inRange(day(25))) add(C, day(25), -389.00, 'ALLY AUTO LOAN PAYMENT');
    if (inRange(day(5))) add(C, day(5), -400, 'ONLINE TRANSFER TO SAVINGS');
    if (inRange(day(5))) add(S, day(5), 400, 'ONLINE TRANSFER FROM CHECKING');
    if (inRange(day(28))) add(S, day(28), round2(10 + m * 1.7), 'INTEREST PAID');
    if (inRange(day(20))) add(C, day(20), -2350 - r() * 500, 'REWARDS VISA PAYMENT THANK YOU');
    if (inRange(day(16)) && m >= 10) add(K, day(16), -20, 'OPENAI *CHATGPT SUBSCR');
  }
  add(K, addDays(t, -380), -139, 'AMAZON PRIME*MEMBERSHIP');
  add(K, addDays(t, -15), -139, 'AMAZON PRIME*MEMBERSHIP');
  // everyday spending on the card
  const spots = [
    [['KROGER #1234', 'WHOLEFDS MKT 10432', "TRADER JOE'S #552", 'ALDI 72045'], 45, 140, 0.35],
    [['STARBUCKS STORE 08812', 'CHIPOTLE 2231', 'TST* LOCAL TAQUERIA', "MCDONALD'S F1234", 'UBER *EATS PENDING', 'DOORDASH*THAI BASIL'], 8, 55, 0.55],
    [['SHELL OIL 57442', 'EXXONMOBIL 4410', 'QT 1102'], 30, 62, 0.18],
    [['AMAZON.COM*MK3LP AMZN.COM/BILL', 'TARGET 00012345', 'WALMART SUPERCENTER #511', 'BEST BUY 00213'], 12, 180, 0.22],
    [['CVS/PHARMACY #0911', 'WALGREENS #3321'], 8, 45, 0.06],
    [['AMC THEATRES 4421', 'STEAMGAMES.COM 4259522985', 'TICKETMASTER'], 15, 90, 0.05],
    [['PETSMART #0412', 'CHEWY.COM'], 20, 75, 0.05],
    [['UBER TRIP HELP.UBER.COM', 'LYFT *RIDE'], 9, 32, 0.07],
  ];
  for (let x = start; x <= t; x = addDays(x, 1)) {
    for (const [names, lo, hi, p] of spots) if (r() < p) add(K, x, -(lo + r() * (hi - lo)), pick(names));
  }
  add(K, addDays(t, -40), -612.33, 'DELTA AIR LINES 0062341');
  add(K, addDays(t, -38), -418.20, 'MARRIOTT HOTELS DENVER');
  add(K, addDays(t, -2), -64.10, 'TARGET 00012345');
  add(C, addDays(t, -60), 1240, 'IRS TREAS 310 TAX REF');
  // a few money leaks for the leak finder: bank fees, card interest, a foreign fee, a double charge
  add(C, addDays(t, -24), -35, 'OVERDRAFT FEE');
  add(C, addDays(t, -55), -12, 'MONTHLY MAINTENANCE FEE');
  add(C, addDays(t, -9), -3.5, 'NON-NETWORK ATM FEE');
  add(K, addDays(t, -12), -27.84, 'PURCHASE INTEREST CHARGE');
  add(K, addDays(t, -37), -12.55, 'FOREIGN TRANSACTION FEE');
  add(K, addDays(t, -3), -48.99, 'BEST BUY 00213');
  add(K, addDays(t, -3), -48.99, 'BEST BUY 00213');

  upsertTransactions(checking, C); upsertTransactions(card, K); upsertTransactions(savings, S);

  // balances + history
  const bal = (list, startBal) => { const map = {}; let b = startBal; const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date)); for (const i of sorted) { b += i.amount; map[i.date] = b; } return { map, end: b }; };
  const ch = bal(C, 2100), sv = bal(S, 6200);
  const cardBal = round2(1380 + r() * 300);
  tx(() => {
    const hist = (id, map) => { let last = null; for (let x = start; x <= t; x = addDays(x, 1)) { if (map[x] != null) last = map[x]; if (last != null) snapshot(id, round2(last), x); } };
    hist(checking, ch.map); hist(savings, sv.map);
    for (let i = 0, x = start; x <= t; x = addDays(x, 1), i++) {
      snapshot(k401, round2(38500 + i * 52 + Math.sin(i / 20) * 900), x);
      snapshot(loan, round2(Math.max(0, 16800 - i * 10.4)), x);
      snapshot(card, round2(600 + (i % 30) * 40 + r() * 200), x);
    }
  });
  const last = id => db.prepare('SELECT balance FROM balance_history WHERE account_id=? ORDER BY date DESC LIMIT 1').get(id).balance;
  for (const id of [checking, savings, k401, loan]) db.prepare('UPDATE accounts SET balance=? WHERE id=?').run(last(id), id);
  db.prepare('UPDATE accounts SET balance=?, meta=? WHERE id=?').run(cardBal, JSON.stringify({ liability: { due_date: addDays(t, 6), minimum: 45, statement_balance: cardBal, apr: 24.99 } }), card);
  snapshot(card, cardBal);
  db.prepare('UPDATE accounts SET meta=? WHERE id=?').run(JSON.stringify({ holdings: [
    { name: 'Vanguard Target Retirement 2055', ticker: 'VFFVX', quantity: 612.4, value: round2(last(k401) * 0.7) },
    { name: 'Fidelity 500 Index', ticker: 'FXAIX', quantity: 52.1, value: round2(last(k401) * 0.3) },
  ] }), k401);
  // a manual asset
  const car = upsertAccount(null, { external_id: 'demo-car', name: '2021 Jeep Wrangler', type: 'vehicle', balance: 31500, manual: true, institution: 'Manual' });
  db.prepare("UPDATE accounts SET meta='{\"demo\":true}' WHERE id=?").run(car);
  tx(() => { for (let i = 0, x = start; x <= t; x = addDays(x, 1), i++) snapshot(car, round2(35800 - i * 10.8), x); });
  db.prepare('UPDATE accounts SET balance=(SELECT balance FROM balance_history WHERE account_id=? ORDER BY date DESC LIMIT 1) WHERE id=?').run(car, car);

  tx(() => {
    const b = db.prepare('INSERT OR REPLACE INTO budgets(category,amount,rollover) VALUES(?,?,?)');
    [['Groceries', 650, 0], ['Dining & Drinks', 350, 0], ['Gas', 180, 0], ['Shopping', 300, 1], ['Entertainment', 100, 0], ['Subscriptions', 120, 0], ['Health & Wellness', 80, 0], ['Pets', 90, 0]].forEach(x => b.run(...x));
    const g = db.prepare('INSERT INTO goals(name,target,saved,target_date,color,icon,created) VALUES(?,?,?,?,?,?,?)');
    const goals = [
      Number(g.run('Emergency fund', 15000, 9300, addMonths(t, 8), '#16a34a', '🛟', Date.now()).lastInsertRowid),
      Number(g.run('Japan trip', 4500, 1250, addMonths(t, 10), '#0ea5e9', '🗾', Date.now()).lastInsertRowid),
    ];
    // shared costs: a trip split with a friend, a dinner, money you owe back
    const txId = (acct, desc) => (db.prepare('SELECT id FROM transactions WHERE account_id=? AND description=? ORDER BY date DESC LIMIT 1').get(acct, desc) || {}).id || null;
    const iou = db.prepare("INSERT INTO ious(tx_id,person,amount,direction,note,date,created,settled_at) VALUES(?,?,?,?,?,?,?,?)");
    const ious = [
      [txId(card, 'DELTA AIR LINES 0062341'), 'Sam', 306.17, 'owed_me', 'Half of the Denver flights', addDays(t, -40), null],
      [txId(card, 'MARRIOTT HOTELS DENVER'), 'Sam', 209.10, 'owed_me', 'Half the hotel', addDays(t, -38), null],
      [txId(card, 'TICKETMASTER'), 'Alex', 45, 'owed_me', 'Concert ticket', addDays(t, -20), null],
      [null, 'Jordan', 60, 'i_owe', 'Fantasy league buy-in', addDays(t, -6), null],
      [null, 'Alex', 32.50, 'owed_me', 'Pizza night', addDays(t, -75), addDays(t, -60)],
    ].map(x => Number(iou.run(...x.slice(0, 6), Date.now(), x[6]).lastInsertRowid));
    // two kids with allowance, chores and a few weeks of history
    const kidIns = db.prepare('INSERT INTO kids(name,emoji,color,allowance,pay_day,last_paid,save_pct,give_pct,goal_name,goal_amount,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    const led = db.prepare('INSERT INTO kid_ledger(kid_id,date,amount,jar,kind,note,chore_id,created) VALUES(?,?,?,?,?,?,?,?)');
    const chore = db.prepare('INSERT INTO kid_chores(kid_id,name,reward,freq,active,created) VALUES(?,?,?,?,1,?)');
    const lastSat = addDays(t, -((new Date(t + 'T12:00').getDay() + 1) % 7));
    const put = (kid, sp, gp, date, amt, kind, note, cid = null) => {
      const save = round2(amt * sp / 100), give = round2(amt * gp / 100);
      [['spend', round2(amt - save - give)], ['save', save], ['give', give]].forEach(([jar, v]) => v && led.run(kid, date, v, jar, kind, note, cid, Date.now()));
    };
    const kids = [
      ['Emma', '🦄', '#e0418f', 10, 30, 10, 'LEGO castle', 80],
      ['Leo', '🦖', '#0ea5a4', 7, 20, 10, 'Soccer cleats', 55],
    ].map(([name, emoji, color, allow, sp, gp, goal, goalAmt]) => {
      const id = Number(kidIns.run(name, emoji, color, allow, 6, lastSat, sp, gp, goal, goalAmt, Date.now()).lastInsertRowid);
      for (let w = 7; w >= 0; w--) put(id, sp, gp, addDays(lastSat, -7 * w), allow, 'allowance', 'Weekly allowance');
      const c1 = Number(chore.run(id, 'Make bed', 0.5, 'daily', Date.now()).lastInsertRowid);
      const c2 = Number(chore.run(id, name === 'Emma' ? 'Feed the dog' : 'Take out trash', 1, 'weekly', Date.now()).lastInsertRowid);
      chore.run(id, 'Clean room', 3, 'weekly', Date.now());
      for (let d = 1; d <= 12; d += 2) put(id, sp, gp, addDays(t, -d), 0.5, 'chore', 'Make bed', c1);
      put(id, sp, gp, addDays(t, -9), 1, 'chore', name === 'Emma' ? 'Feed the dog' : 'Take out trash', c2);
      led.run(id, addDays(t, -16), -6.5, 'spend', 'spend', name === 'Emma' ? 'Slime kit' : 'Pack of cards', null, Date.now());
      led.run(id, addDays(t, -30), 20, 'save', 'deposit', 'Birthday money from Grandma', null, Date.now());
      return id;
    });
    setSetting('demo', { ious, goals, kids, budgets: ['Groceries', 'Dining & Drinks', 'Gas', 'Shopping', 'Entertainment', 'Subscriptions', 'Health & Wellness', 'Pets'] });
    const cs = db.prepare('INSERT INTO credit_scores(date,score,bureau,notes) VALUES(?,?,?,?)');
    [[-12, 688], [-9, 701], [-6, 712], [-3, 718], [0, 731]].forEach(([mo, s]) => cs.run(addMonths(t, mo), s, 'VantageScore 3.0', 'demo'));
  });
  return conn;
}

function clear() {
  tx(() => {
    db.prepare("DELETE FROM connections WHERE provider='demo'").run();
    db.prepare("DELETE FROM accounts WHERE meta LIKE '%\"demo\":true%'").run();
    db.prepare("DELETE FROM credit_scores WHERE notes='demo'").run();
    const d = getSetting('demo');
    if (d) {
      (d.ious || []).forEach(id => db.prepare('DELETE FROM ious WHERE id=?').run(id));
      (d.kids || []).forEach(id => { db.prepare('DELETE FROM kid_ledger WHERE kid_id=?').run(id); db.prepare('DELETE FROM kid_chores WHERE kid_id=?').run(id); db.prepare('DELETE FROM kids WHERE id=?').run(id); });
      d.goals.forEach(id => db.prepare('DELETE FROM goals WHERE id=?').run(id));
      d.budgets.forEach(c => db.prepare('DELETE FROM budgets WHERE category=?').run(c));
      db.prepare('DELETE FROM alerts').run();
      setSetting('demo', null);
    }
    db.prepare('DELETE FROM recurring WHERE id NOT IN (SELECT DISTINCT recurring_id FROM transactions WHERE recurring_id IS NOT NULL) AND auto=1').run();
  });
}

module.exports = { load, clear };
