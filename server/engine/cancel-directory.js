// Where to cancel common subscriptions, plus negotiation tips for common bills.
// key = merchant_key prefix (see categorize.merchantKey).
const DIR = {
  netflix: { url: 'https://www.netflix.com/cancelplan', how: 'Account → Membership → Cancel membership.' },
  spotify: { url: 'https://www.spotify.com/account/subscription/', how: 'Account → Manage your plan → Cancel subscription.' },
  hulu: { url: 'https://secure.hulu.com/account', how: 'Account → Cancel your subscription.' },
  disney: { url: 'https://www.disneyplus.com/account/subscription', how: 'Account → Subscription → Cancel subscription.' },
  max: { url: 'https://auth.max.com/subscription', how: 'Settings → Subscription → Manage → Cancel your subscription.' },
  paramount: { url: 'https://www.paramountplus.com/account/', how: 'Account → Cancel subscription.' },
  peacock: { url: 'https://www.peacocktv.com/account/plans', how: 'Account → Plans & Payment → Change plan → Cancel.' },
  youtube: { url: 'https://www.youtube.com/paid_memberships', how: 'Purchases and memberships → Manage → Deactivate.' },
  apple: { url: 'https://apps.apple.com/account/subscriptions', how: 'iPhone: Settings → your name → Subscriptions → pick one → Cancel.' },
  icloud: { url: 'https://apps.apple.com/account/subscriptions', how: 'iPhone: Settings → your name → iCloud → Manage Storage → Change plan → Downgrade.' },
  amazonprime: { url: 'https://www.amazon.com/mc/pipelines/cancellation', how: 'Account → Prime membership → Manage → End membership.' },
  audible: { url: 'https://www.audible.com/account/overview', how: 'Account details → Cancel membership (desktop site only).' },
  kindleunlimited: { url: 'https://www.amazon.com/kindle-dbs/ku/ku-central', how: 'Kindle Unlimited → Cancel membership.' },
  googleone: { url: 'https://one.google.com/settings', how: 'Settings → Cancel membership.' },
  microsoft: { url: 'https://account.microsoft.com/services', how: 'Services & subscriptions → Manage → Cancel subscription.' },
  xbox: { url: 'https://account.microsoft.com/services', how: 'Services & subscriptions → Game Pass → Manage → Cancel.' },
  playstation: { url: 'https://www.playstation.com/acct/subscriptions', how: 'Settings → Users and Accounts → Account → Payment and Subscriptions → Subscriptions → Turn off auto-renew.' },
  nintendo: { url: 'https://accounts.nintendo.com/shop', how: 'Shop menu → Nintendo Switch Online → Turn off automatic renewal.' },
  adobe: { url: 'https://account.adobe.com/plans', how: 'Plans → Manage plan → Cancel your plan. Watch for the early termination fee on annual plans billed monthly.' },
  dropbox: { url: 'https://www.dropbox.com/account/plan', how: 'Settings → Plan → Cancel plan.' },
  openai: { url: 'https://chatgpt.com/#settings/Subscription', how: 'Settings → Subscription → Manage → Cancel plan.' },
  anthropic: { url: 'https://claude.ai/settings/billing', how: 'Settings → Billing → Cancel plan.' },
  github: { url: 'https://github.com/settings/billing', how: 'Settings → Billing and plans → Downgrade / cancel.' },
  canva: { url: 'https://www.canva.com/settings/billing-and-teams', how: 'Settings → Billing & plans → Cancel subscription.' },
  patreon: { url: 'https://www.patreon.com/settings/memberships', how: 'Memberships → Edit → Cancel membership.' },
  siriusxm: { url: 'https://care.siriusxm.com/login', how: 'Call 1-866-635-2349 or use online chat; say "cancel" and decline retention offers (or accept a cheaper one).' },
  pandora: { url: 'https://www.pandora.com/account/settings', how: 'Settings → Subscription → Switch plans → Cancel.' },
  crunchyroll: { url: 'https://www.crunchyroll.com/account/membership', how: 'Account → Membership → Cancel membership.' },
  slingtv: { url: 'https://www.sling.com/my-account', how: 'My Account → Cancel subscription.' },
  fubo: { url: 'https://www.fubo.tv/account/subscription', how: 'My Account → Subscription & billing → Cancel subscription.' },
  espn: { url: 'https://www.espn.com/watch/settings', how: 'Settings → Subscriptions → Manage → Cancel.' },
  newyorktimes: { url: 'https://myaccount.nytimes.com/seg/subscription', how: 'Account → Subscription → Cancel (may require chat).' },
  duolingo: { url: 'https://www.duolingo.com/settings/subscription', how: 'Cancel in the app store where you subscribed (Apple/Google) or Settings → Subscription.' },
  headspace: { url: 'https://www.headspace.com/subscription', how: 'Account → Subscription → Cancel.' },
  calm: { url: 'https://www.calm.com/account', how: 'Cancel in the app store where you subscribed, or Account → Manage subscription.' },
  peloton: { url: 'https://members.onepeloton.com/preferences/subscriptions', how: 'Preferences → Subscriptions → Cancel.' },
  planetfitness: { url: 'https://www.planetfitness.com/my-account', how: 'Many clubs require cancelling in person or by certified letter — use the letter below.' },
  gym: { url: null, how: 'Gyms often require a written notice. Send the letter below by certified mail and keep the receipt.' },
  linkedin: { url: 'https://www.linkedin.com/premium/manage', how: 'Me → Premium features → Manage Premium account → Cancel subscription.' },
  datingapp: { url: null, how: 'Cancel in the app store you subscribed through (Settings → Subscriptions on iPhone, Play Store → Subscriptions on Android).' },
  walmartplus: { url: 'https://www.walmart.com/plus/account', how: 'Account → Walmart+ → Manage membership → Cancel.' },
  dashpass: { url: 'https://www.doordash.com/consumer/membership', how: 'Account → Manage DashPass → End subscription.' },
  uberone: { url: 'https://www.uber.com/us/en/u/uber-one/', how: 'Uber app → Account → Uber One → Manage membership → End membership.' },
  instacart: { url: 'https://www.instacart.com/store/account/instacart-plus', how: 'Account → Instacart+ → Cancel membership.' },
  hellofresh: { url: 'https://www.hellofresh.com/account-settings/plan-settings', how: 'Account settings → Plan settings → Cancel plan.' },
  ring: { url: 'https://account.ring.com/account/subscription', how: 'Account → Plan → Cancel plan.' },
  securitysoftware: { url: null, how: 'Turn off auto-renewal in the vendor account page, then request a refund within the money-back window.' },
  noomww: { url: null, how: 'Cancel in the app (Settings → Subscription) or via the store you subscribed through.' },
};

// Bills worth calling about, with what to say.
const NEGOTIABLE = {
  'Bills & Utilities': {
    tips: ['Ask for the "retention" or "loyalty" department.', 'Mention a specific competitor price (e.g. "T-Mobile offers me the same for $X").',
      'Ask what promotions are available for existing customers.', 'Remove equipment rentals you can replace with your own modem/router.', 'If they refuse, schedule a cancellation — retention offers often appear then.'],
  },
  Insurance: {
    tips: ['Get two competing quotes first.', 'Ask about bundling, paperless, autopay, safe-driver, and low-mileage discounts.',
      'Raise your deductible if you have an emergency fund.', 'Ask them to re-rate your policy based on your current credit and driving record.'],
  },
  Subscriptions: { tips: ['Ask for a discounted or paused plan instead of cancelling.', 'Switch to annual billing if you keep it (often 15–20% cheaper).', 'Check for student, military or family-plan pricing.'] },
};

function lookup(merchantKey) {
  if (!merchantKey) return null;
  for (const k of Object.keys(DIR)) if (merchantKey === k || (k.length >= 5 && merchantKey.startsWith(k))) return DIR[k];
  return null;
}

module.exports = { lookup, NEGOTIABLE };
