// Merchant clean-up and automatic categorization.
const { db } = require('../db');

// [regex on the raw/cleaned description, display name, category, isSubscription]
const KNOWN = [
  [/netflix/i, 'Netflix', 'Subscriptions', 1], [/spotify/i, 'Spotify', 'Subscriptions', 1],
  [/hulu/i, 'Hulu', 'Subscriptions', 1], [/disney\s*(plus|\+)|disneyplus/i, 'Disney+', 'Subscriptions', 1],
  [/\bmax\.com|hbo\s*max|\bhbo\b/i, 'Max', 'Subscriptions', 1], [/paramount/i, 'Paramount+', 'Subscriptions', 1],
  [/peacock/i, 'Peacock', 'Subscriptions', 1], [/youtube\s*(premium|tv)|google\s*\*?\s*youtube/i, 'YouTube Premium', 'Subscriptions', 1],
  [/apple\.com\/bill|apple\s*services|itunes/i, 'Apple', 'Subscriptions', 1],
  [/prime\s*video|amazon\s*prime|amzn\s*prime|prime\s*member/i, 'Amazon Prime', 'Subscriptions', 1],
  [/audible/i, 'Audible', 'Subscriptions', 1], [/kindle\s*unl/i, 'Kindle Unlimited', 'Subscriptions', 1],
  [/google\s*\*?\s*(storage|one|gsuite|workspace)|google\s*one/i, 'Google One', 'Subscriptions', 1],
  [/microsoft\s*\*?\s*(365|office|xbox|store)|msft\s*\*/i, 'Microsoft', 'Subscriptions', 1],
  [/xbox/i, 'Xbox Game Pass', 'Subscriptions', 1], [/playstation|sony\s*interactive/i, 'PlayStation', 'Subscriptions', 1],
  [/nintendo/i, 'Nintendo', 'Subscriptions', 1], [/steam(games|powered)/i, 'Steam', 'Entertainment', 0],
  [/adobe/i, 'Adobe', 'Subscriptions', 1], [/dropbox/i, 'Dropbox', 'Subscriptions', 1],
  [/openai|chatgpt/i, 'OpenAI', 'Subscriptions', 1], [/anthropic|claude\.ai/i, 'Anthropic', 'Subscriptions', 1],
  [/github/i, 'GitHub', 'Subscriptions', 1], [/canva/i, 'Canva', 'Subscriptions', 1],
  [/patreon/i, 'Patreon', 'Subscriptions', 1], [/onlyfans/i, 'OnlyFans', 'Subscriptions', 1],
  [/siriusxm|sirius\s*xm/i, 'SiriusXM', 'Subscriptions', 1], [/pandora/i, 'Pandora', 'Subscriptions', 1],
  [/tidal/i, 'Tidal', 'Subscriptions', 1], [/crunchyroll/i, 'Crunchyroll', 'Subscriptions', 1],
  [/sling/i, 'Sling TV', 'Subscriptions', 1], [/fubo/i, 'Fubo', 'Subscriptions', 1], [/espn\s*\+|espnplus/i, 'ESPN+', 'Subscriptions', 1],
  [/nytimes|new\s*york\s*times/i, 'New York Times', 'Subscriptions', 1], [/wsj|wall\s*street\s*journal/i, 'Wall Street Journal', 'Subscriptions', 1],
  [/duolingo/i, 'Duolingo', 'Subscriptions', 1], [/headspace/i, 'Headspace', 'Subscriptions', 1], [/calm\.com/i, 'Calm', 'Subscriptions', 1],
  [/peloton/i, 'Peloton', 'Subscriptions', 1], [/planet\s*fitness/i, 'Planet Fitness', 'Health & Wellness', 1],
  [/la\s*fitness|anytime\s*fitness|24\s*hour\s*fit|crunch\s*fit|gold'?s\s*gym|equinox/i, 'Gym', 'Health & Wellness', 1],
  [/noom|weight\s*watchers|\bww\b/i, 'Noom/WW', 'Subscriptions', 1], [/hello\s*fresh/i, 'HelloFresh', 'Groceries', 1],
  [/linkedin/i, 'LinkedIn', 'Subscriptions', 1], [/tinder|bumble|hinge|match\.com/i, 'Dating app', 'Subscriptions', 1],
  [/norton|mcafee|nordvpn|expressvpn|surfshark/i, 'Security software', 'Subscriptions', 1],
  [/icloud/i, 'iCloud', 'Subscriptions', 1], [/chegg/i, 'Chegg', 'Subscriptions', 1], [/ring\.com|ring\s*(basic|protect)/i, 'Ring', 'Subscriptions', 1],
  [/costco\s*(membership|annual)/i, 'Costco Membership', 'Subscriptions', 1], [/walmart\s*\+|walmart\s*plus/i, 'Walmart Plus', 'Subscriptions', 1],
  [/doordash\s*dashpass|dashpass/i, 'DashPass', 'Subscriptions', 1], [/uber\s*one/i, 'Uber One', 'Subscriptions', 1],
  [/instacart\s*\+|instacart\s*express/i, 'Instacart+', 'Subscriptions', 1],
  // utilities & bills
  [/verizon/i, 'Verizon', 'Bills & Utilities', 0], [/at\s*&\s*t|\batt\b\*?/i, 'AT&T', 'Bills & Utilities', 0],
  [/t-?mobile/i, 'T-Mobile', 'Bills & Utilities', 0], [/comcast|xfinity/i, 'Xfinity', 'Bills & Utilities', 0],
  [/spectrum|charter\s*comm/i, 'Spectrum', 'Bills & Utilities', 0], [/cox\s*comm/i, 'Cox', 'Bills & Utilities', 0],
  [/mint\s*mobile/i, 'Mint Mobile', 'Bills & Utilities', 0], [/visible\b/i, 'Visible', 'Bills & Utilities', 0],
  [/cricket\s*wireless/i, 'Cricket', 'Bills & Utilities', 0], [/frontier\s*comm/i, 'Frontier', 'Bills & Utilities', 0],
  [/starlink/i, 'Starlink', 'Bills & Utilities', 0], [/dish\s*network|directv/i, 'Satellite TV', 'Bills & Utilities', 0],
  [/electric|power\s*co|energy|duke\s*energy|pg&e|con\s*ed|edison|dominion|ameren|xcel|entergy|fpl\b/i, null, 'Bills & Utilities', 0],
  [/water\s*(dept|util|bill)|sewer|waste\s*management|republic\s*services|trash/i, null, 'Bills & Utilities', 0],
  [/geico/i, 'GEICO', 'Insurance', 0], [/progressive/i, 'Progressive', 'Insurance', 0], [/state\s*farm/i, 'State Farm', 'Insurance', 0],
  [/allstate/i, 'Allstate', 'Insurance', 0], [/liberty\s*mutual/i, 'Liberty Mutual', 'Insurance', 0], [/farmers\s*ins/i, 'Farmers Insurance', 'Insurance', 0],
  [/usaa/i, 'USAA', 'Insurance', 0], [/lemonade/i, 'Lemonade', 'Insurance', 0], [/insurance|insur\b/i, null, 'Insurance', 0],
  // food
  [/uber\s*\*?\s*eats/i, 'Uber Eats', 'Dining & Drinks', 0], [/doordash/i, 'DoorDash', 'Dining & Drinks', 0], [/grubhub/i, 'Grubhub', 'Dining & Drinks', 0],
  [/starbucks/i, 'Starbucks', 'Dining & Drinks', 0], [/dunkin/i, "Dunkin'", 'Dining & Drinks', 0], [/mcdonald/i, "McDonald's", 'Dining & Drinks', 0],
  [/chick-?fil-?a/i, 'Chick-fil-A', 'Dining & Drinks', 0], [/chipotle/i, 'Chipotle', 'Dining & Drinks', 0], [/taco\s*bell/i, 'Taco Bell', 'Dining & Drinks', 0],
  [/wendy'?s/i, "Wendy's", 'Dining & Drinks', 0], [/burger\s*king/i, 'Burger King', 'Dining & Drinks', 0], [/subway/i, 'Subway', 'Dining & Drinks', 0],
  [/domino'?s/i, "Domino's", 'Dining & Drinks', 0], [/pizza\s*hut/i, 'Pizza Hut', 'Dining & Drinks', 0], [/panera/i, 'Panera', 'Dining & Drinks', 0],
  [/sonic\s*drive/i, 'Sonic', 'Dining & Drinks', 0], [/restaurant|grill|cafe|coffee|bistro|pizza|sushi|taqueria|diner|bar\s*&|brewing|tst\*/i, null, 'Dining & Drinks', 0],
  // Canada (BMO, RBC, TD, CIBC, Scotiabank customers)
  [/tim\s*horton/i, 'Tim Hortons', 'Dining & Drinks', 0], [/a\s*&\s*w\b/i, 'A&W', 'Dining & Drinks', 0], [/harvey'?s/i, "Harvey's", 'Dining & Drinks', 0],
  [/skip\s*the\s*dishes|skipthedishes/i, 'SkipTheDishes', 'Dining & Drinks', 0],
  [/loblaw/i, 'Loblaws', 'Groceries', 0], [/no\s*frills/i, 'No Frills', 'Groceries', 0], [/sobeys/i, 'Sobeys', 'Groceries', 0],
  [/^metro\b(?!\s*(pcs|by|transit|bus|rail))|\bmetro\s*(inc|#?\d)/i, 'Metro', 'Groceries', 0], [/real\s*canadian\s*superstore|rcss/i, 'Real Canadian Superstore', 'Groceries', 0],
  [/food\s*basics/i, 'Food Basics', 'Groceries', 0], [/save[-\s]*on[-\s]*foods/i, 'Save-On-Foods', 'Groceries', 0], [/\bfreshco\b/i, 'FreshCo', 'Groceries', 0],
  [/\bmaxi\b/i, 'Maxi', 'Groceries', 0], [/\biga\b/i, 'IGA', 'Groceries', 0],
  [/petro[-\s]*can/i, 'Petro-Canada', 'Gas', 0], [/\besso\b/i, 'Esso', 'Gas', 0], [/husky/i, 'Husky', 'Gas', 0], [/ultramar/i, 'Ultramar', 'Gas', 0], [/pioneer\s*(gas|station)/i, 'Pioneer', 'Gas', 0],
  [/canadian\s*tire/i, 'Canadian Tire', 'Shopping', 0], [/shoppers\s*drug/i, 'Shoppers Drug Mart', 'Health & Wellness', 0], [/\brexall\b/i, 'Rexall', 'Health & Wellness', 0],
  [/dollarama/i, 'Dollarama', 'Shopping', 0], [/winners\b/i, 'Winners', 'Shopping', 0], [/hudson'?s\s*bay|\bthe\s*bay\b/i, "Hudson's Bay", 'Shopping', 0],
  [/rogers\b/i, 'Rogers', 'Bills & Utilities', 0], [/\bbell\s*(canada|mobility|media)?\b/i, 'Bell', 'Bills & Utilities', 0], [/telus/i, 'Telus', 'Bills & Utilities', 0],
  [/\bfido\b/i, 'Fido', 'Bills & Utilities', 0], [/koodo/i, 'Koodo', 'Bills & Utilities', 0], [/hydro\s*one|bc\s*hydro|hydro[-\s]*qu[eé]bec|toronto\s*hydro|enbridge/i, null, 'Bills & Utilities', 0],
  [/presto/i, 'PRESTO', 'Auto & Transport', 0], [/\bttc\b/i, 'TTC', 'Auto & Transport', 0], [/407\s*etr/i, '407 ETR', 'Auto & Transport', 0],
  [/\blcbo\b/i, 'LCBO', 'Dining & Drinks', 0], [/\bsaq\b/i, 'SAQ', 'Dining & Drinks', 0], [/beer\s*store/i, 'The Beer Store', 'Dining & Drinks', 0],
  [/instacart/i, 'Instacart', 'Groceries', 0], [/kroger/i, 'Kroger', 'Groceries', 0], [/safeway/i, 'Safeway', 'Groceries', 0],
  [/whole\s*foods|wholefds/i, 'Whole Foods', 'Groceries', 0], [/trader\s*joe/i, "Trader Joe's", 'Groceries', 0], [/aldi/i, 'Aldi', 'Groceries', 0],
  [/publix/i, 'Publix', 'Groceries', 0], [/h-?e-?b\b/i, 'H-E-B', 'Groceries', 0], [/wegmans/i, 'Wegmans', 'Groceries', 0],
  [/meijer/i, 'Meijer', 'Groceries', 0], [/food\s*lion|giant\s*eagle|stop\s*&\s*shop|albertsons|winco|sprouts|hy-?vee|food\s*city|ingles|piggly/i, null, 'Groceries', 0],
  [/grocery|supermarket|market\b/i, null, 'Groceries', 0],
  // shopping
  [/amazon|amzn/i, 'Amazon', 'Shopping', 0], [/walmart|wal-mart|wm\s*supercenter/i, 'Walmart', 'Shopping', 0], [/target\b/i, 'Target', 'Shopping', 0],
  [/costco/i, 'Costco', 'Groceries', 0], [/sam'?s\s*club/i, "Sam's Club", 'Groceries', 0], [/best\s*buy/i, 'Best Buy', 'Shopping', 0],
  [/home\s*depot/i, 'Home Depot', 'Home & Garden', 0], [/lowe'?s/i, "Lowe's", 'Home & Garden', 0], [/ikea/i, 'IKEA', 'Home & Garden', 0],
  [/ebay/i, 'eBay', 'Shopping', 0], [/etsy/i, 'Etsy', 'Shopping', 0], [/temu/i, 'Temu', 'Shopping', 0], [/shein/i, 'Shein', 'Shopping', 0],
  [/tj\s*maxx|marshalls|ross\s*stores|kohl'?s|macy'?s|nordstrom|old\s*navy|gap\b/i, null, 'Shopping', 0],
  [/cvs/i, 'CVS', 'Health & Wellness', 0], [/walgreens/i, 'Walgreens', 'Health & Wellness', 0], [/pharmacy|dental|medical|clinic|hospital|doctor|optometr|vision/i, null, 'Health & Wellness', 0],
  [/petsmart|petco|chewy|vet(erinary)?\b/i, null, 'Pets', 0],
  // transport
  [/uber(?!\s*\*?\s*eats)/i, 'Uber', 'Auto & Transport', 0], [/lyft/i, 'Lyft', 'Auto & Transport', 0],
  [/shell\s*(oil|service)?\b|exxon|mobil\b|chevron|\bbp\b|sunoco|marathon\s*petro|speedway|wawa|sheetz|circle\s*k|quiktrip|\bqt\b|valero|racetrac|casey'?s|murphy\s*usa|7-?eleven|pilot\s*travel|love'?s\s*travel|buc-?ee/i, null, 'Gas', 0],
  [/parking|toll|e-?zpass|sunpass|fastrak|dmv|jiffy\s*lube|auto\s*zone|autozone|o'?reilly\s*auto|advance\s*auto|car\s*wash|tesla\s*supercharg/i, null, 'Auto & Transport', 0],
  [/airline|delta\s*air|united\s*air|american\s*air|southwest|jetblue|spirit\s*air|frontier\s*air|alaska\s*air|airbnb|vrbo|marriott|hilton|hyatt|expedia|booking\.com|hotel/i, null, 'Travel', 0],
  [/amc\s*theat|regal\s*cine|cinemark|ticketmaster|stubhub|eventbrite/i, null, 'Entertainment', 0],
  // money movement
  [/payroll|direct\s*dep|dir\s*dep|salary|paycheck|adp\s*payroll|gusto/i, 'Paycheck', 'Paycheck', 0],
  [/interest\s*(paid|earned|payment)|dividend/i, null, 'Interest & Dividends', 0],
  [/(credit\s*card|card)\s*payment|payment\s*(thank\s*you|received)|autopay\s*pymt|online\s*payment|epay|cardmember\s*serv/i, null, 'Credit Card Payment', 0],
  [/transfer|xfer|\btrnsfr\b|zelle|to\s*savings|from\s*savings|from\s*checking|to\s*checking/i, null, 'Transfer', 0],
  [/robinhood|vanguard|fidelity|schwab|coinbase|acorns|betterment|wealthfront|e\*?trade|webull/i, null, 'Savings & Investing', 0],
  [/mortgage|rocket\s*mortgage|mr\.?\s*cooper|rent\b|apartments?|property\s*mgmt|hoa\b/i, null, 'Housing', 0],
  [/student\s*loan|navient|nelnet|mohela|sallie\s*mae|aidvantage|sofi\s*loan|auto\s*loan|car\s*payment|toyota\s*fin|honda\s*fin|ally\s*auto|capital\s*one\s*auto/i, null, 'Loan Payment', 0],
  [/irs\b|tax\s*(payment|refund)|state\s*tax|treas\s*310/i, null, 'Taxes', 0],
  [/\batm\b|cash\s*withdrawal/i, null, 'Cash & ATM', 0],
  [/overdraft|nsf\b|service\s*charge|monthly\s*fee|late\s*fee|foreign\s*transaction\s*fee|annual\s*fee/i, null, 'Fees & Charges', 0],
  [/refund|return\b|reversal/i, null, 'Refunds', 0],
  [/church|charity|donation|red\s*cross|gofundme|unicef/i, null, 'Gifts & Donations', 0],
  [/school|tuition|university|college|udemy|coursera/i, null, 'Education', 0],
  [/salon|barber|spa\b|nails|ulta|sephora/i, null, 'Personal Care', 0],
];

// Plaid personal_finance_category.primary -> our category
const PFC = {
  INCOME: 'Other Income', TRANSFER_IN: 'Transfer', TRANSFER_OUT: 'Transfer', LOAN_PAYMENTS: 'Loan Payment',
  BANK_FEES: 'Fees & Charges', ENTERTAINMENT: 'Entertainment', FOOD_AND_DRINK: 'Dining & Drinks',
  GENERAL_MERCHANDISE: 'Shopping', HOME_IMPROVEMENT: 'Home & Garden', MEDICAL: 'Health & Wellness',
  PERSONAL_CARE: 'Personal Care', GENERAL_SERVICES: 'Bills & Utilities', GOVERNMENT_AND_NON_PROFIT: 'Gifts & Donations',
  TRANSPORTATION: 'Auto & Transport', TRAVEL: 'Travel', RENT_AND_UTILITIES: 'Bills & Utilities',
};
const PFC_DETAILED = {
  INCOME_WAGES: 'Paycheck', INCOME_DIVIDENDS: 'Interest & Dividends', INCOME_INTEREST_EARNED: 'Interest & Dividends',
  FOOD_AND_DRINK_GROCERIES: 'Groceries', TRANSPORTATION_GAS: 'Gas', RENT_AND_UTILITIES_RENT: 'Housing',
  LOAN_PAYMENTS_CREDIT_CARD_PAYMENT: 'Credit Card Payment', LOAN_PAYMENTS_MORTGAGE_PAYMENT: 'Housing',
  GENERAL_SERVICES_INSURANCE: 'Insurance', GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT: 'Taxes',
  TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS: 'Savings & Investing', TRANSFER_OUT_SAVINGS: 'Savings & Investing',
  GENERAL_MERCHANDISE_PET_SUPPLIES: 'Pets', GENERAL_SERVICES_EDUCATION: 'Education', TRANSFER_OUT_WITHDRAWAL: 'Cash & ATM',
};

const NOISE = [
  /^(pos|debit|dbt|ach|checkcard|check\s*card|visa|purchase|recurring|preauthorized|pre-?auth|card)\s+(purchase|debit|payment|pmt|card)?\s*/i,
  /purchase\s+authorized\s+on\s+\d{1,2}\/\d{1,2}/i, /^(sq|tst|sp|pp|py|in|dd|ck|pos)\s*\*\s*/i, /^paypal\s*\*\s*/i,
  /\b(x{2,}|\*{2,})\d{2,}\b/gi, /#\s*\d+/g, /\b\d{4,}\b/g, /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g,
  /\b(card|crd)\s*\d+\b/gi, /\s+[A-Z]{2}\s*$/, /\s+(us|usa)\s*$/i, /\bref\s*#?\s*\w+/gi, /\bid:?\s*\w+/gi,
];

function cleanMerchant(raw) {
  let s = (raw || '').replace(/\s+/g, ' ').trim();
  for (const re of NOISE) s = s.replace(re, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/[*_]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  // drop trailing city names after many spaces / known separators
  s = s.replace(/\s+-\s+.*$/, '').trim();
  // drop trailing payment jargon ("DUKE ENERGY PAYMENT", "RENT ACH", "AUTO LOAN PMT WEB")
  let prevS;
  do { prevS = s; s = s.replace(/\s+(ach|pmt|pymt|payments?|autopay|auto\s*pay|debit|web|online|ppd|ccd|epay|bill\s*pay|bill)$/i, '').trim(); } while (s !== prevS && s.includes(' '));
  if (!s) s = (raw || 'Unknown').trim();
  // Title-case if all caps
  if (s === s.toUpperCase()) s = s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/\b(Llc|Inc|Co)\b/g, m => m.toUpperCase());
  return s.slice(0, 60);
}
const merchantKey = name => (name || '').toLowerCase().replace(/\.com\b/, '').replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'unknown';

function known(text) {
  for (const [re, name, cat, sub] of KNOWN) if (re.test(text)) return { name, category: cat, subscription: !!sub };
  return null;
}
const isKnownSubscription = text => { const k = known(text || ''); return !!(k && k.subscription); };

let ruleCache = null;
const loadRules = () => (ruleCache = db.prepare('SELECT * FROM rules ORDER BY id DESC').all());
const invalidateRules = () => { ruleCache = null; };

function ruleMatch(rule, t) {
  const val = (rule.match_field === 'description' ? t.description : t.merchant) || '';
  const p = rule.pattern || '';
  if (rule.match_type === 'equals') return val.toLowerCase() === p.toLowerCase();
  if (rule.match_type === 'regex') { try { return new RegExp(p, 'i').test(val); } catch { return false; } }
  return val.toLowerCase().includes(p.toLowerCase());
}

/** Fill merchant / merchant_key / category on a transaction-like object. */
function categorize(t, { merchantName, pfc } = {}) {
  const raw = t.description || '';
  const k = known(`${merchantName || ''} ${raw}`);
  t.merchant = t.merchant || merchantName || (k && k.name) || cleanMerchant(raw);
  t.merchant_key = merchantKey(t.merchant);
  if (!t.category) {
    if (k) t.category = k.category;
    else if (pfc && (PFC_DETAILED[pfc.detailed] || PFC[pfc.primary])) t.category = PFC_DETAILED[pfc.detailed] || PFC[pfc.primary];
    else t.category = t.amount > 0 ? 'Other Income' : 'Uncategorized';
  }
  // income-like category on a debit (or the reverse) is usually wrong
  if (t.amount < 0 && /Income|Paycheck|Refunds|Interest/.test(t.category) && !k) t.category = 'Uncategorized';
  for (const r of ruleCache || loadRules()) {
    if (ruleMatch(r, t)) {
      if (r.set_category) t.category = r.set_category;
      if (r.set_merchant) { t.merchant = r.set_merchant; t.merchant_key = merchantKey(r.set_merchant); }
      if (r.set_excluded != null) t.excluded = r.set_excluded;
      if (r.set_tags) t.ruleTags = r.set_tags;
      break;
    }
  }
  const kind = db.prepare('SELECT kind FROM categories WHERE name=?').get(t.category);
  if (kind && kind.kind === 'transfer' && t.excluded == null) t.excluded = 1;
  return t;
}

/** Re-run categorization for every transaction the user hasn't edited by hand. */
function recategorizeAll() {
  invalidateRules();
  const rows = db.prepare('SELECT id, description, amount, provider_category FROM transactions WHERE user_category=0').all();
  const upd = db.prepare('UPDATE transactions SET merchant=?, merchant_key=?, category=?, excluded=? WHERE id=?');
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      let pfc = null; try { pfc = r.provider_category ? JSON.parse(r.provider_category) : null; } catch {}
      const t = categorize({ description: r.description, amount: r.amount }, { merchantName: pfc && pfc.merchant_name, pfc });
      upd.run(t.merchant, t.merchant_key, t.category, t.excluded ? 1 : 0, r.id);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return rows.length;
}

module.exports = { categorize, cleanMerchant, merchantKey, isKnownSubscription, invalidateRules, recategorizeAll, ruleMatch };
