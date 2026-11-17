// AI advisor: builds a privacy-conscious summary of the user's finances and talks to Gemini.
const { db, getSetting, setSetting } = require('../db');
const insights = require('./insights');
const { perMonth } = require('./recurring');
const gemini = require('../integrations/gemini');
const { today, monthOf, prevMonth, monthEnd } = require('../util');

const $ = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');

/** Plain-text snapshot. No account numbers, no raw bank descriptions, no transaction ids. */
function snapshot() {
  const t = today(), m = monthOf(t);
  const A = insights.accountsSummary();
  const lines = [];
  lines.push(`Today: ${t}. Currency: USD.`);
  lines.push(`\n## Balances\nNet worth ${$(A.netWorth)} (assets ${$(A.assets)}, debts ${$(A.liabilities)}). Cash ${$(A.cash)}. Credit card debt ${$(A.credit)}${A.utilization != null ? ` (${A.utilization}% utilization)` : ''}. Investments ${$(A.investments)}, crypto ${$(A.crypto)}, property/vehicles ${$(A.property)}, loans ${$(A.loans)}.`);
  const accts = db.prepare('SELECT name, type, subtype, balance, credit_limit, meta FROM accounts WHERE hidden=0 ORDER BY type, balance DESC').all();
  if (accts.length) {
    lines.push('Accounts:');
    for (const a of accts) {
      let meta = {}; try { meta = JSON.parse(a.meta || '{}') || {}; } catch {}
      const l = meta.liability || {};
      lines.push(`- ${a.name} (${a.subtype || a.type}): ${$(a.balance)}${a.credit_limit ? ` of ${$(a.credit_limit)} limit` : ''}${l.apr ? `, APR ${l.apr}%` : ''}${l.minimum ? `, min payment ${$(l.minimum)}` : ''}${l.due_date ? `, due ${l.due_date}` : ''}`);
    }
  } else lines.push('No accounts connected yet.');

  const nw = insights.netWorthHistory(365);
  if (nw.length > 30) lines.push(`Net worth change: 30 days ${$(nw[nw.length - 1].net - nw[nw.length - 31].net)}${nw.length > 180 ? `, 6 months ${$(nw[nw.length - 1].net - nw[nw.length - 181].net)}` : ''}.`);

  const cf = insights.cashflow(6);
  lines.push(`\n## Cash flow (last 6 months, current month is partial)\n${cf.map(c => `- ${c.month}: income ${$(c.income)}, spending ${$(c.spending)}, net ${$(c.net)}`).join('\n')}`);
  const full = cf.slice(0, -1).filter(c => c.income || c.spending);
  if (full.length) {
    const avgI = full.reduce((s, c) => s + c.income, 0) / full.length, avgS = full.reduce((s, c) => s + c.spending, 0) / full.length;
    lines.push(`Average full month: income ${$(avgI)}, spending ${$(avgS)}, savings rate ${avgI ? Math.round((avgI - avgS) / avgI * 100) : 0}%.`);
  }

  const rep = insights.report(m), last = insights.report(prevMonth(m));
  const dayOf = Number(t.slice(8)), daysIn = Number(monthEnd(m).slice(8));
  lines.push(`\n## Spending by category — this month so far (day ${dayOf} of ${daysIn}) vs last month`);
  const lastMap = Object.fromEntries(last.categories.map(c => [c.name, c.total]));
  const names = [...new Set([...rep.categories.map(c => c.name), ...last.categories.map(c => c.name)])];
  for (const n of names.slice(0, 18)) lines.push(`- ${n}: ${$((rep.categories.find(c => c.name === n) || {}).total || 0)} (last month ${$(lastMap[n] || 0)})`);
  if (last.merchants.length) lines.push(`Top merchants last month: ${last.merchants.slice(0, 10).map(x => `${x.name} ${$(x.total)}`).join(', ')}.`);

  const b = insights.budgets(m);
  if (b.list.length) lines.push(`\n## Budgets this month\n${b.list.map(x => `- ${x.category}: spent ${$(x.spent)} of ${$(x.limit)}`).join('\n')}\nSpending outside budgets: ${$(b.unbudgeted)}.`);

  const rec = db.prepare("SELECT COALESCE(custom_name,name) name, amount, prev_amount, cadence, kind, category, next_date FROM recurring WHERE status='active' ORDER BY amount DESC").all();
  if (rec.length) {
    const subs = rec.filter(r => r.kind === 'subscription'), bills = rec.filter(r => r.kind === 'bill'), inc = rec.filter(r => r.kind === 'income');
    const fmt = r => `- ${r.name}: ${$(r.amount)} ${r.cadence}${r.prev_amount && r.amount > r.prev_amount ? ` (was ${$(r.prev_amount)})` : ''}, next ${r.next_date}`;
    if (subs.length) lines.push(`\n## Subscriptions (${$(subs.reduce((s, r) => s + perMonth(r.amount, r.cadence), 0))}/mo)\n${subs.map(fmt).join('\n')}`);
    if (bills.length) lines.push(`\n## Bills (${$(bills.reduce((s, r) => s + perMonth(r.amount, r.cadence), 0))}/mo)\n${bills.map(fmt).join('\n')}`);
    if (inc.length) lines.push(`\n## Recurring income\n${inc.map(fmt).join('\n')}`);
  }
  const fc = insights.forecast(30);
  lines.push(`\n## Next 30 days\nSafe to spend now: ${$(fc.safeToSpend)} (cash minus ${$(fc.billsBeforePay)} of bills due before next paycheck${fc.nextPaycheck ? ' on ' + fc.nextPaycheck.date : ''}). Projected lowest cash balance ${$(fc.low)} on ${fc.lowDate}. Typical day-to-day spending ${$(fc.dailyDiscretionary)}/day.`);

  const goals = db.prepare('SELECT g.name, g.target, g.saved, g.target_date, a.balance ab FROM goals g LEFT JOIN accounts a ON a.id=g.account_id').all();
  if (goals.length) lines.push(`\n## Savings goals\n${goals.map(g => `- ${g.name}: ${$(g.ab ?? g.saved)} of ${$(g.target)}${g.target_date ? ` by ${g.target_date}` : ''}`).join('\n')}`);
  const cs = db.prepare('SELECT date, score, bureau FROM credit_scores ORDER BY date DESC LIMIT 3').all();
  if (cs.length) lines.push(`\n## Credit score\n${cs.map(c => `- ${c.date}: ${c.score} (${c.bureau})`).join('\n')}`);
  const about = (getSetting('ai_profile', '') || '').trim();
  if (about) lines.push(`\n## About me (written by the user)\n${about.slice(0, 1500)}`);
  return lines.join('\n');
}

const SYSTEM = `You are PocketFinance's built-in money coach. You help one person understand and improve their personal finances using the snapshot of their real data below.
Rules:
- Be specific: cite their actual numbers, categories, subscriptions and bills. Do the math for them.
- Be practical and kind. Prioritize: avoid overdraft/late fees, build an emergency fund, pay down high-APR debt, cut unused subscriptions, then save and invest.
- Give general education, not regulated advice: don't recommend specific stocks, funds or crypto to buy or sell, and for taxes, legal questions or large decisions suggest a licensed professional.
- If the data is missing or thin (for example no accounts connected), say what's missing and give general guidance.
- Format with short paragraphs, bullet lists and **bold** key numbers. Keep answers under about 300 words unless asked for more.
- Never invent transactions or balances that aren't in the snapshot.`;

const systemPrompt = () => `${SYSTEM}\n\n# Financial snapshot\n${snapshot()}`;

// ---- chat history (one running conversation) ----
db.exec('CREATE TABLE IF NOT EXISTS ai_messages (id INTEGER PRIMARY KEY, role TEXT, text TEXT, created INTEGER)');
const history = () => db.prepare('SELECT id, role, text, created FROM ai_messages ORDER BY id').all();
const clearHistory = () => db.prepare('DELETE FROM ai_messages').run();

async function ask(question) {
  const q = String(question || '').trim().slice(0, 4000);
  if (!q) throw new Error('Type a question.');
  const past = history().slice(-20);
  const r = await gemini.chat(systemPrompt(), [...past.map(m => ({ role: m.role, text: m.text })), { role: 'user', text: q }]);
  const ins = db.prepare('INSERT INTO ai_messages(role,text,created) VALUES(?,?,?)');
  ins.run('user', q, Date.now());
  ins.run('model', r.text, Date.now());
  return { answer: r.text, model: r.model };
}

// ---- daily insights for the dashboard (cached per day unless refreshed) ----
async function dailyInsights(force) {
  const cached = getSetting('ai_insights');
  if (!force && cached && cached.date === today()) return cached;
  const r = await gemini.chat(systemPrompt(), [{ role: 'user', text:
    'Give me exactly 3 short, specific insights for today based on my snapshot. Each one: an emoji, a bold 3-6 word title, then one or two sentences with real numbers and one concrete action. Format as a markdown list of 3 items. No intro or outro.' }], { temperature: 0.5 });
  const out = { date: today(), text: r.text, model: r.model, created: Date.now() };
  setSetting('ai_insights', out);
  return out;
}

module.exports = { snapshot, ask, history, clearHistory, dailyInsights };
