/* Popular banks: picker, per-bank connect options, bank file instructions, Teller Connect */
'use strict';

const GENERIC_STEPS = 'Sign in on the bank\'s website → open the account → look for <strong>Download</strong> or <strong>Export</strong> near the transaction list → choose <strong>CSV</strong> (or Quicken <strong>QFX</strong>) and a date range.';
const BANKS = [
  { id: 'bmo-us', name: 'BMO', sub: 'US · formerly BMO Harris', country: 'US', color: '#0079C1', ab: 'BMO', url: 'https://www.bmo.com/en-us/main/personal/', hint: 'bmo-us',
    steps: 'Sign in to BMO Digital Banking → open the account → <strong>Download transactions</strong> → choose <strong>CSV</strong>, Quicken (<strong>QFX</strong>) or QuickBooks (<strong>QBO</strong>). QFX is the most reliable — it carries BMO\'s own transaction IDs.' },
  { id: 'bmo-ca', name: 'BMO', sub: 'Canada · Bank of Montreal', country: 'CA', color: '#0079C1', ab: 'BMO', url: 'https://www.bmo.com/main/personal/', hint: 'bmo-ca',
    steps: 'Sign in to BMO Online Banking → open the account → <strong>Download transactions</strong> → choose <strong>Microsoft Excel (CSV)</strong> or Quicken/QuickBooks → pick dates. Works for chequing, savings and BMO Mastercard files.' },
  { id: 'chase', name: 'Chase', country: 'US', color: '#117ACA', ab: 'C', url: 'https://www.chase.com', hint: 'chase',
    steps: 'Sign in at chase.com → pick the account → click the <strong>⬇ Download account activity</strong> icon above your transactions → choose <strong>CSV</strong> (or Quicken QFX) and a date range.' },
  { id: 'boa', name: 'Bank of America', country: 'US', color: '#E31837', ab: 'BofA', url: 'https://www.bankofamerica.com', hint: 'boa',
    steps: 'Sign in → open the account → click <strong>Download</strong> above the transactions → choose <strong>Microsoft Excel</strong> (CSV) or <strong>Quicken</strong> (QFX).' },
  { id: 'wells', name: 'Wells Fargo', country: 'US', color: '#D71E28', ab: 'WF', url: 'https://www.wellsfargo.com', hint: 'wells',
    steps: 'Sign in → open the account → <strong>Download Account Activity</strong> → choose <strong>Comma Delimited</strong> (CSV) or Quicken → pick dates.' },
  { id: 'citi', name: 'Citi', country: 'US', color: '#056DAE', ab: 'citi', url: 'https://online.citi.com', hint: 'citi',
    steps: 'Sign in → open the account → in <strong>Account Activity</strong> click the <strong>Download</strong> icon → choose <strong>CSV</strong>.' },
  { id: 'capone', name: 'Capital One', country: 'US', color: '#004977', ab: 'C1', url: 'https://www.capitalone.com', hint: 'capone',
    steps: 'Sign in → open the account → <strong>View transactions</strong> → <strong>Download Transactions</strong> → choose <strong>CSV</strong>.' },
  { id: 'amex', name: 'American Express', country: 'US', color: '#2E77BB', ab: 'AMEX', url: 'https://www.americanexpress.com', hint: 'amex', card: true,
    steps: 'Sign in → <strong>Statements &amp; Activity</strong> → <strong>Download</strong> → choose <strong>CSV</strong>. PocketFinance knows Amex lists purchases as positive numbers.' },
  { id: 'discover', name: 'Discover', country: 'US', color: '#FF6000', ab: 'D', url: 'https://www.discover.com', hint: 'discover', card: true,
    steps: 'Sign in → <strong>Activity</strong> → <strong>Download</strong> → choose <strong>CSV</strong> (or Quicken).' },
  { id: 'usbank', name: 'U.S. Bank', country: 'US', color: '#0C2074', ab: 'usb', url: 'https://www.usbank.com', hint: 'usbank',
    steps: 'Sign in → open the account → <strong>Download transactions</strong> → choose <strong>CSV</strong> or Quicken (QFX).' },
  { id: 'pnc', name: 'PNC', country: 'US', color: '#EF7622', ab: 'PNC', url: 'https://www.pnc.com' },
  { id: 'truist', name: 'Truist', country: 'US', color: '#2E1A47', ab: 'T', url: 'https://www.truist.com' },
  { id: 'td-us', name: 'TD Bank', sub: 'US', country: 'US', color: '#2C8C3C', ab: 'TD', url: 'https://www.td.com/us/en/personal-banking' },
  { id: 'ally', name: 'Ally', country: 'US', color: '#650360', ab: 'ally', url: 'https://www.ally.com' },
  { id: 'navyfed', name: 'Navy Federal', country: 'US', color: '#003865', ab: 'NFCU', url: 'https://www.navyfederal.org' },
  { id: 'usaa', name: 'USAA', country: 'US', color: '#002F6C', ab: 'USAA', url: 'https://www.usaa.com' },
  { id: 'schwab', name: 'Charles Schwab', country: 'US', color: '#00A0DF', ab: 'S', url: 'https://www.schwab.com' },
  { id: 'fidelity', name: 'Fidelity', country: 'US', color: '#368727', ab: 'F', url: 'https://www.fidelity.com' },
  { id: 'sofi', name: 'SoFi', country: 'US', color: '#00A2C7', ab: 'SoFi', url: 'https://www.sofi.com' },
  { id: 'chime', name: 'Chime', country: 'US', color: '#1EC677', ab: 'chime', url: 'https://www.chime.com',
    steps: 'Chime offers monthly PDF statements rather than a CSV download, so connect it automatically with Plaid, Teller or SimpleFIN instead.' },
  { id: 'regions', name: 'Regions', country: 'US', color: '#5A9E2F', ab: 'R', url: 'https://www.regions.com' },
  { id: 'fifththird', name: 'Fifth Third', country: 'US', color: '#1B3D6D', ab: '5/3', url: 'https://www.53.com' },
  { id: 'huntington', name: 'Huntington', country: 'US', color: '#4A8E2F', ab: 'H', url: 'https://www.huntington.com' },
  { id: 'citizens', name: 'Citizens', country: 'US', color: '#008555', ab: 'C', url: 'https://www.citizensbank.com' },
  { id: 'keybank', name: 'KeyBank', country: 'US', color: '#CC0000', ab: 'Key', url: 'https://www.key.com' },
  { id: 'rbc', name: 'RBC Royal Bank', country: 'CA', color: '#005DAA', ab: 'RBC', url: 'https://www.rbcroyalbank.com', hint: 'rbc',
    steps: 'Sign in → <strong>Account Services → Download Transactions</strong> → choose <strong>Comma Delimited</strong> (CSV) or Quicken → pick the account and dates.' },
  { id: 'td-ca', name: 'TD Canada Trust', country: 'CA', color: '#2C8C3C', ab: 'TD', url: 'https://www.td.com/ca/en/personal-banking', hint: 'td-ca',
    steps: 'Sign in to EasyWeb → open the account → <strong>Download</strong> → choose <strong>Spreadsheet (.csv)</strong> or Quicken.' },
  { id: 'scotia', name: 'Scotiabank', country: 'CA', color: '#EC111A', ab: 'S', url: 'https://www.scotiabank.com', hint: 'scotia' },
  { id: 'cibc', name: 'CIBC', country: 'CA', color: '#C41F3E', ab: 'CIBC', url: 'https://www.cibc.com', hint: 'cibc' },
];
const POPULAR = ['bmo-us', 'bmo-ca', 'chase', 'boa', 'wells', 'citi', 'capone', 'amex', 'discover', 'usbank', 'pnc', 'truist', 'navyfed', 'usaa', 'ally', 'rbc'];

const bankLogo = (b, size = 40) => `<span class="bank-logo" style="--bc:${b.color};width:${size}px;height:${size}px;font-size:${Math.round(size * (b.ab.length > 3 ? .26 : b.ab.length > 2 ? .31 : .42))}px">${esc(b.ab)}</span>`;
const bankStepsHTML = b => `<p style="margin:6px 0">${b.steps || GENERIC_STEPS}</p><a href="${b.url}" target="_blank" rel="noopener">Open the ${esc(b.name)} website ↗</a>`;
const bankTile = b => `<button type="button" class="bank-tile" data-bank="${b.id}">${bankLogo(b)}<span class="bn">${esc(b.name)}</span><span class="bs">${b.sub ? esc(b.sub.split(' · ')[0]) : b.country === 'CA' ? 'Canada' : '&nbsp;'}</span></button>`;

function addAccountDrawer() {
  const pop = POPULAR.map(id => BANKS.find(b => b.id === id));
  openDrawer(`<h2>Add an account</h2><p class="muted small" style="margin-top:-4px">Pick your bank, or choose another way below. Bank connections are read-only.</p>
    <input id="bankQ" class="bank-search" type="search" placeholder="Search banks — BMO, Chase, Wells Fargo…" autocomplete="off">
    <div class="bank-grid" id="bankGrid">${pop.map(bankTile).join('')}</div>
    <p class="small muted" style="margin:8px 0 18px">Not listed? Plaid and SimpleFIN reach 12,000+ banks and credit unions, and any bank's CSV or QFX file works with <a href="#" data-opt="import">Import a file</a>.</p>
    <h3 class="sub-h">Other ways to connect</h3><div class="stack">
    <div class="connect-opt" data-opt="plaid"><div class="ico">🏦</div><div><strong>Any bank, card, loan or brokerage (Plaid)</strong><div class="small muted">12,000+ US &amp; Canadian institutions. Auto-syncs transactions, balances, due dates and holdings.</div></div></div>
    <div class="connect-opt" data-opt="teller"><div class="ico">⚡</div><div><strong>Teller</strong><div class="small muted">Direct connections to the big US banks and card issuers. Free for personal use (up to 100 connections).</div></div></div>
    <div class="connect-opt" data-opt="simplefin"><div class="ico">🔗</div><div><strong>SimpleFIN Bridge</strong><div class="small muted">Low-cost personal bank feed you control ($1.50/mo). Paste a setup token from beta-bridge.simplefin.org.</div></div></div>
    <div class="connect-opt" data-opt="import"><div class="ico">📄</div><div><strong>Import a file</strong><div class="small muted">CSV/QFX/OFX/QBO from any bank, or exports from Mint, Monarch, YNAB, Copilot, Rocket Money and Empower.</div></div></div>
    <div class="connect-opt" data-opt="crypto"><div class="ico">🪙</div><div><strong>Crypto</strong><div class="small muted">Watch-only BTC, ETH, SOL, LTC or DOGE wallet address, or a manual coin balance. Live prices.</div></div></div>
    <div class="connect-opt" data-opt="home"><div class="ico">🏡</div><div><strong>Track a home's value</strong><div class="small muted">Market estimate from the address, or your price grown by the official local home price index. Link the mortgage to see your equity.</div></div></div>
    <div class="connect-opt" data-opt="manual"><div class="ico">🚗</div><div><strong>Manual asset or debt</strong><div class="small muted">Car, cash, a private loan — anything you want in your net worth.</div></div></div>
  </div>`, el => {
    const wire = () => $$('[data-bank]', el).forEach(t => t.onclick = () => bankDrawer(BANKS.find(b => b.id === t.dataset.bank)));
    wire();
    $$('[data-opt]', el).forEach(o => o.onclick = e => { e.preventDefault(); ({ plaid: () => plaidLink(), teller: () => tellerLink(), simplefin: simplefinDrawer, import: () => importDrawer(), crypto: cryptoDrawer, manual: manualDrawer, home: () => homeDrawer(null) })[o.dataset.opt](); });
    $('#bankQ', el).oninput = e => {
      const q = e.target.value.trim().toLowerCase();
      const list = q ? BANKS.filter(b => `${b.name} ${b.sub || ''} ${b.ab} ${b.country === 'CA' ? 'canada' : 'usa us'}`.toLowerCase().includes(q)) : pop;
      $('#bankGrid', el).innerHTML = list.length ? list.map(bankTile).join('')
        : `<div class="small muted" style="grid-column:1/-1;padding:8px 2px">No shortcut for “${esc(e.target.value)}” — use <strong>Plaid</strong>, <strong>SimpleFIN</strong> or <strong>Import a file</strong> below; together they cover almost every bank.</div>`;
      wire();
    };
  });
}

async function bankDrawer(b) {
  const [plaid, teller] = await Promise.all([api('/plaid/status').catch(() => ({})), api('/teller/status').catch(() => ({}))]);
  const us = b.country === 'US';
  const badge = ok => ok ? '<span class="pill green">Ready</span>' : '<span class="pill">Needs setup</span>';
  const opts = [
    { k: 'plaid', ico: '🏦', t: 'Connect with Plaid', d: `Log in to ${esc(b.name)} in Plaid's secure window. Syncs transactions, balances and payment due dates automatically.`, ok: plaid.configured, rec: plaid.configured },
    ...(us ? [{ k: 'teller', ico: '⚡', t: 'Connect with Teller', d: `Direct and free for personal use. Teller's window shows whether ${esc(b.name)} is supported.`, ok: teller.configured, rec: !plaid.configured && teller.configured }] : []),
    ...(us ? [{ k: 'simplefin', ico: '🔗', t: 'Connect with SimpleFIN', d: `Link ${esc(b.name)} inside SimpleFIN Bridge ($1.50/mo), then paste the setup token here.` }] : []),
  ];
  const anyReady = plaid.configured || (us && teller.configured);
  const pinned = await quickLogins();
  openDrawer(`<div class="bank-head">${bankLogo(b, 52)}<div><h2 style="margin:0">${esc(b.name)}</h2><div class="small muted">${esc(b.sub || (us ? 'United States' : 'Canada'))}</div></div></div>
    <div class="row wrap" style="margin-top:12px"><a class="btn primary" href="${esc(b.url)}" target="_blank" rel="noopener noreferrer">🔐 Log in to ${esc(b.name)} online banking ↗</a>
      <button class="btn" id="pinQ">${pinned.includes(b.id) ? '★ On dashboard' : '☆ Add login to dashboard'}</button></div>
    <h3 class="sub-h">Connect automatically</h3><div class="stack">${opts.map(o => `<div class="connect-opt" data-c="${o.k}"><div class="ico">${o.ico}</div><div class="grow"><strong>${o.t}</strong> ${o.k === 'simplefin' ? '' : badge(o.ok)}${o.rec ? ' <span class="pill acc">Recommended</span>' : ''}<div class="small muted">${o.d}</div></div></div>`).join('')}</div>
    ${anyReady ? '' : `<p class="small muted" style="margin:8px 0 0">${us ? 'Plaid and Teller each need' : 'Plaid needs'} free developer keys once — tap it for the 2-minute setup. Until then, importing a file below works right away.</p>`}
    <h3 class="sub-h">Or import a statement file</h3>
    <div class="card" style="padding:14px"><div class="small">${bankStepsHTML(b)}</div><button class="btn primary" id="bankImp" style="margin-top:12px">Import a ${esc(b.name)} file…</button></div>`, el => {
    $$('[data-c]', el).forEach(o => o.onclick = () => ({ plaid: () => plaidLink(), teller: () => tellerLink(), simplefin: simplefinDrawer })[o.dataset.c]());
    $('#bankImp', el).onclick = () => importDrawer({ bank: b });
    $('#pinQ', el).onclick = async e => { const cur = await quickLogins(); const next = cur.includes(b.id) ? cur.filter(x => x !== b.id) : [...cur, b.id];
      await api('/settings', { method: 'PUT', body: { quick_logins: next } }); QUICK = next; e.target.textContent = next.includes(b.id) ? '★ On dashboard' : '☆ Add login to dashboard'; toast(next.includes(b.id) ? 'Login button added to the dashboard' : 'Removed from the dashboard'); };
  });
}

// one-tap bank logins on the dashboard (opens the bank's own site; PocketFinance never sees the password)
let QUICK = null;
async function quickLogins() { if (!QUICK) QUICK = (await api('/settings').catch(() => ({}))).quick_logins || []; return QUICK; }
async function quickLoginBar(slot) {
  const list = (await quickLogins()).map(id => BANKS.find(b => b.id === id)).filter(Boolean);
  if (!slot || !list.length) return;
  slot.innerHTML = `<div class="quick-logins"><span class="small muted">Bank logins</span>${list.map(b => `<a class="ql" href="${esc(b.url)}" target="_blank" rel="noopener noreferrer" title="Open ${esc(b.name)} online banking (${esc(b.sub)})">${bankLogo(b, 26)}<span>${esc(b.name)}${BANKS.filter(x => x.name === b.name).length > 1 ? ' ' + b.country : ''}</span><i>↗</i></a>`).join('')}
    <a class="ql more" href="#/accounts?add=1" title="Pick a bank, then ‘Add login to dashboard’">+</a></div>`;
}

let tellerScript;
async function tellerLink(connectionId) {
  const st = await api('/teller/status');
  if (!st.configured) return tellerSetupDrawer();
  if (st.env !== 'sandbox' && !st.has_cert) return tellerSetupDrawer('Real bank connections need your Teller certificate. Add it below, or switch to Sandbox to try test banks.');
  toast('Opening secure bank login…');
  if (!tellerScript) tellerScript = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'https://cdn.teller.io/connect/connect.js'; s.onload = res;
    s.onerror = () => { tellerScript = null; rej(new Error('Could not load Teller Connect (offline?)')); }; document.head.appendChild(s);
  });
  try {
    await tellerScript;
    const enrollmentId = connectionId ? (await api(`/teller/enrollment/${connectionId}`)).enrollmentId : null;
    TellerConnect.setup({
      applicationId: st.application_id, environment: st.env, products: ['transactions', 'balance'], selectAccount: 'disabled',
      ...(enrollmentId ? { enrollmentId } : {}),
      onSuccess: async enrollment => {
        closeDrawer(); toast('Importing transactions… this can take a minute', 8000);
        try {
          await api('/teller/enroll', { method: 'POST', body: { accessToken: enrollment.accessToken, enrollment: enrollment.enrollment } });
          STATE.accounts = (await api('/accounts')).accounts;
          const inst = enrollment.enrollment && enrollment.enrollment.institution;
          toast(`${(inst && inst.name) || 'Bank'} connected`); location.hash = '#/accounts'; route(); refreshBell();
        } catch (e) { toast(e.message, 6000); }
      },
      onFailure: f => toast((f && f.message) || 'Bank login failed', 6000),
    }).open();
  } catch (e) { toast(e.message, 6000); }
}

function tellerSetupHTML(st) {
  return `<form class="form" id="tellerF">
    <ol class="small" style="margin:0 0 4px;padding-left:18px"><li>Sign up free at <a href="https://teller.io/signup" target="_blank" rel="noopener">teller.io</a> and open the dashboard.</li>
      <li>Copy your <strong>Application ID</strong> (starts with <span class="kbd">app_</span>).</li>
      <li>For real banks: under <strong>Certificates</strong>, create one and download it. Pick <span class="kbd">certificate.pem</span> and <span class="kbd">private_key.pem</span> below. Sandbox needs no certificate.</li></ol>
    <label class="f"><span>Application ID</span><input name="application_id" value="${esc(st.application_id || '')}" placeholder="app_…" autocomplete="off"></label>
    <label class="f"><span>Environment</span><select name="env">
      <option value="sandbox" ${st.env === 'sandbox' ? 'selected' : ''}>Sandbox (test banks: username / password)</option>
      <option value="development" ${st.env === 'development' ? 'selected' : ''}>Development (real banks, free, up to 100)</option>
      <option value="production" ${st.env === 'production' ? 'selected' : ''}>Production (real banks, billed by Teller)</option></select></label>
    <div class="two"><label class="f"><span>certificate.pem ${st.has_cert ? '(saved)' : ''}</span><input type="file" name="certFile" accept=".pem,.crt"></label>
    <label class="f"><span>private_key.pem ${st.has_cert ? '(saved)' : ''}</span><input type="file" name="keyFile" accept=".pem,.key"></label></div>
    <p class="small muted" style="margin:0">The certificate and key are stored encrypted on this computer and only used to talk to api.teller.io.</p>
    <div class="row"><button class="btn primary">Save Teller settings</button>${st.has_cert ? '<button type="button" class="btn danger" id="tellerClr">Remove certificate</button>' : ''}</div></form>`;
}

function wireTellerSetup(el, after) {
  const f = $('#tellerF', el); if (!f) return;
  f.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(f), certF = fd.get('certFile'), keyF = fd.get('keyFile');
    const body = { application_id: fd.get('application_id'), env: fd.get('env') };
    if (certF && certF.size) body.cert = await certF.text();
    if (keyF && keyF.size) body.key = await keyF.text();
    if (!!body.cert !== !!body.key) return toast('Pick both certificate.pem and private_key.pem', 5000);
    await run(e.submitter, () => api('/teller/settings', { method: 'PUT', body }), 'Teller settings saved');
    if (after) after();
  };
  const clr = $('#tellerClr', el);
  if (clr) clr.onclick = async e => {
    if (!confirm('Remove the saved Teller certificate?')) return;
    await run(e.target, () => api('/teller/settings', { method: 'PUT', body: { clear_cert: true } }), 'Certificate removed');
    if (after) after();
  };
}

async function tellerSetupDrawer(note) {
  const st = await api('/teller/status');
  openDrawer(`<h2>⚡ Set up Teller</h2><p class="small">${note ? esc(note) : 'Teller links PocketFinance straight to big US banks like Chase, Bank of America, Wells Fargo, Citi, Capital One and Amex. It needs a free developer account (about 2 minutes).'}</p>${tellerSetupHTML(st)}`,
    el => wireTellerSetup(el, async () => { const s = await api('/teller/status'); if (s.configured && (s.env === 'sandbox' || s.has_cert)) tellerLink(); else tellerSetupDrawer(); }));
}
