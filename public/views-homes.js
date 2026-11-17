/* Home values: Homes card (Net worth page), add/edit drawer, RentCast key card (Settings). */
'use strict';

const homeMethod = h => h.home.method === 'rentcast' ? `Market estimate${h.home.low ? ` · range ${short(h.home.low)}–${short(h.home.high)}` : ''}${h.home.comps ? ` · ${h.home.comps} nearby sales` : ''}`
  : h.home.method === 'index' ? `FHFA home price index for ZIP ${esc(String(h.home.zip || '').slice(0, 3))}xx · ${esc((h.home.as_of || '').replace('Q', ' Q'))}`
  : h.home.method === 'manual' ? 'Value you entered' : 'Not valued yet';

async function homesCard(slot) {
  const { homes, settings } = await api('/homes');
  slot.innerHTML = `<div class="card"><div class="card-h"><h2>🏡 Homes</h2><button class="btn sm" id="addHome">+ Track a home</button></div>
    ${homes.length ? `<div class="stack">${homes.map(h => `<div class="home-row" data-id="${h.id}"><div class="row between wrap" style="gap:10px">
        <div><strong>${esc(h.name)}</strong><div class="small muted">${esc(h.home.address || '')}</div></div>
        <div style="text-align:right"><div class="num" style="font-size:22px;font-weight:800">${money(h.value, { cents: false })}</div>
          ${h.gain != null ? `<div class="small"><span class="${h.gain >= 0 ? 'pos' : 'neg'}">${money(h.gain, { sign: true, cents: false })}</span> <span class="muted">since ${h.home.base_date ? fdate(h.home.base_date, { month: 'short', year: 'numeric' }) : 'purchase'}</span></div>` : ''}</div></div>
      <div class="small muted" style="margin-top:4px">${homeMethod(h)}${h.home.area_change_1y != null ? ` · area ${h.home.area_change_1y >= 0 ? '+' : ''}${h.home.area_change_1y}% this year` : ''}${h.home.last_valued ? ` · checked ${relDay(h.home.last_valued).toLowerCase()}` : ''}</div>
      ${h.home.note ? `<div class="small" style="color:var(--warn);margin-top:2px">${esc(h.home.note)} Used the price index instead.</div>` : ''}
      ${h.mortgage ? `<div class="equity"><div class="row between small"><span>Equity <strong class="num">${money(h.equity, { cents: false })}</strong></span><span class="muted">${esc(h.mortgage.name)} ${money(h.mortgage.balance, { cents: false })}</span></div>
        <div class="bar" style="margin-top:5px;height:8px"><span style="width:${h.value > 0 ? Math.max(0, Math.min(100, h.equity / h.value * 100)) : 0}%;background:linear-gradient(90deg,var(--pos),var(--teal))"></span></div></div>` : ''}
      <div class="row" style="margin-top:8px"><button class="btn sm" data-ref="${h.id}">⟳ Update value</button><button class="btn sm" data-edit="${h.id}">Edit</button></div></div>`).join('')}</div>`
      : '<div class="empty small">Add your home to keep its value in your net worth up to date — from the address and the local home price index.</div>'}
    <p class="small muted" style="margin:10px 0 0">${settings.rentcast ? 'Market estimates by RentCast, refreshed weekly.' : 'Values follow the official FHFA house price index for your area (updated quarterly). For an address-level market estimate, add a free RentCast key in Settings → Home values.'}</p></div>`;
  $('#addHome', slot).onclick = () => homeDrawer(null);
  $$('[data-ref]', slot).forEach(b => b.onclick = e => run(e.target, async () => { const r = await api(`/homes/${b.dataset.ref}/refresh`, { method: 'POST' }); route(); return r; }, r => `Value updated: ${money(r.value, { cents: false })}`));
  $$('[data-edit]', slot).forEach(b => b.onclick = () => homeDrawer(homes.find(h => h.id === Number(b.dataset.edit))));
}

async function homeDrawer(h) {
  const loans = (await api('/accounts')).accounts.filter(a => a.type === 'loan');
  const x = (h && h.home) || {};
  const types = ['', 'Single Family', 'Condo', 'Townhouse', 'Multi-Family', 'Manufactured'];
  openDrawer(`<h2>${h ? esc(h.name) : 'Track a home'}</h2><form class="form" id="hf">
    <label class="f"><span>Name</span><input name="name" value="${esc(h ? h.name : '')}" placeholder="e.g. Our house"></label>
    <label class="f"><span>Street address</span><input name="address" value="${esc(x.address || '')}" placeholder="123 Main St, Springfield, IL 62704" autocomplete="street-address"></label>
    <div class="two"><label class="f"><span>ZIP code</span><input name="zip" value="${esc(x.zip || '')}" inputmode="numeric" maxlength="10" placeholder="62704"></label>
      <label class="f"><span>Mortgage (for equity)</span><select name="mortgage_id"><option value="">None</option>${loans.map(l => `<option value="${l.id}" ${x.mortgage_id === l.id ? 'selected' : ''}>${esc(l.name)} · ${money(l.balance, { cents: false })}</option>`).join('')}</select></label></div>
    <div class="two"><label class="f"><span>What you paid (or a recent appraisal)</span><input name="base_value" type="number" min="0" step="1000" value="${x.base_value ?? ''}" placeholder="350000"></label>
      <label class="f"><span>On this date</span><input name="base_date" type="date" value="${esc(x.base_date || '')}"></label></div>
    <details><summary class="small">More details (sharper market estimates)</summary>
      <div class="two" style="margin-top:8px"><label class="f"><span>Bedrooms</span><input name="bedrooms" type="number" min="0" value="${x.bedrooms ?? ''}"></label><label class="f"><span>Bathrooms</span><input name="bathrooms" type="number" min="0" step="0.5" value="${x.bathrooms ?? ''}"></label></div>
      <div class="two"><label class="f"><span>Square feet</span><input name="squareFootage" type="number" min="0" value="${x.squareFootage ?? ''}"></label><label class="f"><span>Type</span><select name="propertyType">${types.map(t => `<option ${x.propertyType === t ? 'selected' : ''} value="${t}">${t || '—'}</option>`).join('')}</select></label></div></details>
    <label class="chk"><input type="checkbox" name="manual" ${x.source === 'manual' ? 'checked' : ''}> I'll enter the value myself</label>
    <label class="f ${x.source === 'manual' ? '' : 'hidden'}" id="mv"><span>Value</span><input name="manual_value" type="number" min="0" step="1000" value="${x.manual_value ?? (h ? h.value : '')}"></label>
    <div class="row"><button class="btn primary">${h ? 'Save &amp; update value' : 'Add home'}</button>${h ? '<span style="flex:1"></span><button type="button" class="btn danger" id="delH">Remove</button>' : ''}</div>
    <p class="small muted" style="margin:0">The value is estimated from public data and is not an appraisal.</p></form>`, d => {
    $('[name=manual]', d).onchange = e => $('#mv', d).classList.toggle('hidden', !e.target.checked);
    $('#hf', d).onsubmit = async e => {
      e.preventDefault(); const f = formData(e.target);
      const body = { ...f, source: f.manual ? 'manual' : 'auto' }; delete body.manual;
      const r = await run(e.submitter, () => api(h ? `/homes/${h.id}` : '/homes', { method: h ? 'PUT' : 'POST', body }));
      if (r.error) toast(r.error, 6000); else if (r.valued) toast(`Valued at ${money(r.valued.value, { cents: false })}`);
      STATE.accounts = (await api('/accounts')).accounts; closeDrawer();
      if (location.hash.startsWith('#/networth')) route(); else location.hash = '#/networth';
    };
    if ($('#delH', d)) $('#delH', d).onclick = async () => { if (!confirm(`Remove ${h.name} and its value history?`)) return; await api(`/accounts/${h.id}`, { method: 'DELETE' }); STATE.accounts = (await api('/accounts')).accounts; closeDrawer(); route(); };
  });
}

async function homeSettingsCard(slot) {
  const { settings } = await api('/homes');
  slot.innerHTML = `<form class="card form" id="rcF"><h2>🏡 Home values</h2>
    <p class="small muted" style="margin:0">Without a key, homes follow the free FHFA house price index for their ZIP area (quarterly). For an address-level market estimate with a value range, get a free key at <a href="https://app.rentcast.io/app/api" target="_blank" rel="noopener">rentcast.io → API</a> (50 lookups a month free; each home is checked weekly). ${settings.rentcast ? '<span class="pill green">Key saved</span>' : ''}</p>
    <label class="f"><span>RentCast API key ${settings.rentcast ? '(saved — leave blank to keep)' : ''}</span><input name="rentcast_key" type="password" autocomplete="off"></label>
    <div class="row"><button class="btn primary">Save key</button>${settings.rentcast ? '<button type="button" class="btn danger" id="rcDel">Remove key</button>' : ''}</div></form>`;
  $('#rcF', slot).onsubmit = async e => {
    e.preventDefault(); const k = formData(e.target).rentcast_key.trim(); if (!k) return toast('Paste the key first');
    await run(e.submitter, () => api('/homes-settings', { method: 'PUT', body: { rentcast_key: k } }), 'Key saved — tap "Update value" on a home'); homeSettingsCard(slot);
  };
  if ($('#rcDel', slot)) $('#rcDel', slot).onclick = async () => { await api('/homes-settings', { method: 'PUT', body: { rentcast_key: '' } }); homeSettingsCard(slot); };
}
