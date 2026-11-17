// Subscription cancellation: how to cancel (billing channel + methods), tracking, confirmation and savings.
const { db } = require('../db');
const { today, addDays, round2, daysBetween } = require('../util');
const { lookup } = require('./cancel-directory');
const { perMonth } = require('./recurring');

const bad = msg => Object.assign(new Error(msg), { status: 400 });

// Subscriptions bought through an app store or a payment service have to be cancelled there.
const CHANNELS = [
  { id: 'apple', re: /apple\.com\/bill|itunes|apple services/i, name: 'Apple (App Store)', url: 'https://apps.apple.com/account/subscriptions',
    steps: ['On iPhone or iPad: Settings → tap your name → Subscriptions.', 'Pick the subscription → Cancel Subscription.', 'On a Windows PC: open the Apple Music or Apple TV app → your name → View My Account → Subscriptions → Manage.'] },
  { id: 'google', re: /google \*|google play|googleplay|google\s*\*?\s*(youtube|storage|one)/i, name: 'Google Play', url: 'https://play.google.com/store/account/subscriptions',
    steps: ['Open the Google Play Store → tap your profile → Payments & subscriptions → Subscriptions.', 'Pick the subscription → Cancel subscription.'] },
  { id: 'paypal', re: /paypal/i, name: 'PayPal', url: 'https://www.paypal.com/myaccount/autopay/',
    steps: ['PayPal → Settings (gear) → Payments → Manage automatic payments.', 'Pick the merchant → Cancel.', 'This stops PayPal paying them; also cancel on their site so the account closes.'] },
  { id: 'amazon', re: /amzn digital|prime video channels|amazon channels|amzn\.com\/bill.*(channel|video)/i, name: 'Amazon (Prime Video Channels)', url: 'https://www.amazon.com/gp/video/settings/channels',
    steps: ['Amazon → Prime Video → Settings → Channels.', 'Cancel the channel.'] },
  { id: 'roku', re: /roku/i, name: 'Roku', url: 'https://my.roku.com/subscriptions', steps: ['my.roku.com → Manage your subscriptions → Unsubscribe.'] },
];
const DISPUTE_STEPS = [
  'Contact the merchant first and ask for a refund of any charge after your cancellation date (keep the confirmation number handy).',
  'If they refuse, call the number on the back of your card or use your bank\'s app to dispute the charge — you usually have 60 days from the statement date.',
  'Ask your bank to block future charges from this merchant, or replace the card number if they keep billing you.',
];

function channelOf(r) {
  const desc = db.prepare('SELECT description FROM transactions WHERE recurring_id=? ORDER BY date DESC LIMIT 3').all(r.id).map(t => t.description).join(' ');
  return CHANNELS.find(c => c.re.test(desc)) || null;
}

/** Everything needed to cancel one subscription, best method first. */
function plan(id) {
  const r = db.prepare('SELECT * FROM recurring WHERE id=?').get(id); if (!r) throw bad('Not found');
  const name = r.custom_name || r.name;
  const dir = lookup(r.merchant_key);
  const ch = channelOf(r);
  const last = db.prepare('SELECT t.date, t.amount, a.name account, a.mask FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE t.recurring_id=? ORDER BY t.date DESC LIMIT 1').get(r.id);
  const methods = [];
  if (ch) methods.push({ id: 'channel', title: `Cancel through ${ch.name}`, why: `Your charges come through ${ch.name}, so that's where this subscription lives.`, url: ch.url, steps: ch.steps });
  if (r.cancel_url || (dir && dir.url)) methods.push({ id: 'online', title: 'Cancel online', why: dir ? dir.how : 'Use the account or billing page on their website.', url: r.cancel_url || dir.url,
    steps: [dir ? dir.how : 'Sign in → Account / Billing / Subscription → Cancel.', 'Turn off auto-renew if there is a separate switch.', 'Save or screenshot the confirmation page.'] });
  methods.push({ id: 'email', title: 'Cancel by email', why: 'A written request gives you proof of the date you asked.', steps: ['Send the email below from the address on the account.', 'Ask for written confirmation and keep the reply.'] });
  methods.push({ id: 'phone', title: 'Cancel by phone or chat', why: 'Some services only cancel through support.',
    steps: [`Find "${name} support" on their website or the back of the receipt email.`, 'Say: "I want to cancel my subscription effective today, and I don\'t want a retention offer."', 'Ask for a cancellation or reference number and the date of the final charge.'] });
  if (!ch && !(r.cancel_url || dir)) methods.push({ id: 'online', title: 'Cancel online', why: 'Look for Account, Billing, Subscription or Membership in your account settings.', url: null, steps: ['Sign in on their website or app.', 'Account → Billing / Subscription → Cancel.'] });
  return {
    id: r.id, name, amount: r.amount, cadence: r.cadence, monthly: round2(perMonth(r.amount, r.cadence)), yearly: round2(perMonth(r.amount, r.cadence) * 12),
    next_date: r.next_date, status: r.status, cancel_state: r.cancel_state, cancel_method: r.cancel_method, cancel_ref: r.cancel_ref, cancelled_at: r.cancelled_at,
    channel: ch ? { id: ch.id, name: ch.name } : null, methods, last, dispute: DISPUTE_STEPS,
    email: { subject: `Cancel my ${name} subscription`, body: letter(name, r, last) },
  };
}
function letter(name, r, last) {
  return `Hello ${name} support,\n\nPlease cancel my ${name} subscription effective immediately and stop all future charges.\n` +
    (last ? `My most recent charge was $${Math.abs(last.amount).toFixed(2)} on ${last.date}${last.mask ? ` to my card ending in ${last.mask}` : ''}.\n` : '') +
    `\nAccount email / username: [your account email]\n\nPlease confirm the cancellation in writing, including the date of the final charge. If any charge posts after today (${today()}), I request a full refund.\n\nThank you,\n[your name]`;
}

/** Record a cancellation request. It's "pending" until the next billing date passes with no charge. */
function request(id, b = {}) {
  const r = db.prepare('SELECT * FROM recurring WHERE id=?').get(id); if (!r) throw bad('Not found');
  const method = ['channel', 'online', 'email', 'phone', 'other'].includes(b.method) ? b.method : 'other';
  db.prepare(`UPDATE recurring SET status='cancelled', cancelled_at=?, cancel_state='pending', cancel_method=?, cancel_ref=?, notes=COALESCE(?,notes), updated=? WHERE id=?`)
    .run(b.date && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : today(), method, String(b.ref || '').slice(0, 80) || null, b.notes ? String(b.notes).slice(0, 300) : null, Date.now(), id);
  return plan(id);
}
function confirm(id) { db.prepare("UPDATE recurring SET cancel_state='confirmed', updated=? WHERE id=?").run(Date.now(), id); return plan(id); }
function undo(id) { db.prepare("UPDATE recurring SET status='active', cancel_state=NULL, cancelled_at=NULL, cancel_method=NULL, cancel_ref=NULL, updated=? WHERE id=?").run(Date.now(), id); }
function keep(id) { db.prepare('UPDATE recurring SET reviewed_at=? WHERE id=?').run(today(), id); }

/**
 * After each sync: pending cancellations are confirmed once the expected billing date (+5 days grace)
 * passes with no new charge; a charge after the cancel date marks it failed (the alert comes from recurring.detect).
 */
function check() {
  const events = [];
  for (const r of db.prepare("SELECT * FROM recurring WHERE status='cancelled' AND cancel_state='pending'").all()) {
    const charged = db.prepare('SELECT date, amount FROM transactions WHERE recurring_id=? AND date>? ORDER BY date LIMIT 1').get(r.id, r.cancelled_at);
    if (charged) { db.prepare("UPDATE recurring SET cancel_state='failed' WHERE id=?").run(r.id); events.push({ type: 'cancel_failed', id: r.id, name: r.custom_name || r.name, ...charged }); continue; }
    const due = r.next_date && r.next_date > r.cancelled_at ? r.next_date : addDays(r.cancelled_at, 35);
    if (today() > addDays(due, 5)) { db.prepare("UPDATE recurring SET cancel_state='confirmed' WHERE id=?").run(r.id); events.push({ type: 'cancel_confirmed', id: r.id, name: r.custom_name || r.name, amount: r.amount }); }
  }
  // a confirmed cancellation that charges again also counts as failed
  for (const r of db.prepare("SELECT * FROM recurring WHERE status='cancelled' AND cancel_state='confirmed'").all()) {
    const charged = db.prepare('SELECT date, amount FROM transactions WHERE recurring_id=? AND date>? ORDER BY date LIMIT 1').get(r.id, r.cancelled_at);
    if (charged) { db.prepare("UPDATE recurring SET cancel_state='failed' WHERE id=?").run(r.id); events.push({ type: 'cancel_failed', id: r.id, name: r.custom_name || r.name, ...charged }); }
  }
  return events;
}

/** Money saved by cancelling: per month now, and what it has added up to since each cancellation. */
function savings() {
  const rows = db.prepare("SELECT id, COALESCE(custom_name,name) name, amount, cadence, cancelled_at, cancel_state FROM recurring WHERE status='cancelled' AND kind!='income' AND cancelled_at IS NOT NULL AND COALESCE(cancel_state,'confirmed')!='failed'").all();
  let monthly = 0, soFar = 0;
  const list = rows.map(r => { const m = perMonth(r.amount, r.cadence); monthly += m; const s = Math.max(0, daysBetween(r.cancelled_at, today())) / 30.44 * m; soFar += s; return { ...r, monthly: round2(m), saved: round2(s) }; });
  return { count: rows.length, monthly: round2(monthly), yearly: round2(monthly * 12), soFar: round2(soFar), list: list.sort((a, b) => b.monthly - a.monthly) };
}

/** Active subscriptions not reviewed in the last 90 days, biggest first — for the keep-or-cancel review. */
function toReview() {
  return db.prepare("SELECT id FROM recurring WHERE status='active' AND kind='subscription' AND (reviewed_at IS NULL OR reviewed_at<?) ORDER BY amount DESC").all(addDays(today(), -90)).map(r => plan(r.id));
}

module.exports = { plan, request, confirm, undo, keep, check, savings, toReview, channelOf, CHANNELS };
