/* Cancel subscriptions: guided cancel flow, tracking until confirmed, refund/dispute help, savings, keep-or-cancel review. */
'use strict';

const CANCEL_ICON = { channel: '📱', online: '🌐', email: '✉️', phone: '📞', other: '✅' };
const cancelStateHTML = p => p.cancel_state === 'failed' ? '<span class="pill red">Charged after cancelling</span>'
  : p.cancel_state === 'pending' ? '<span class="pill amber">Cancel pending</span>'
  : p.status === 'cancelled' ? '<span class="pill green">Cancelled ✓</span>' : '';

// re-render the page under an open drawer (route() would close the drawer)
function softRefresh() {
  const [name, query] = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?');
  if (!VIEWS[name]) return;
  clearCharts(); Promise.resolve(VIEWS[name]($('#view'), new URLSearchParams(query || ''))).catch(() => {});
}

// card inside the recurring drawer
async function cancelCard(slot, r) {
  if (!slot || r.kind === 'income') return;
  const name = r.custom_name || r.name;
  if (r.status === 'active') {
    slot.innerHTML = `<div class="card cancel-card"><div class="row between wrap"><div><h3 style="margin:0">Don't need it anymore?</h3><div class="small muted">Cancelling saves <strong>${money(r.monthly * 12, { cents: false })}</strong> a year.</div></div>
      <button class="btn danger" id="cxGo">Cancel ${esc(name)}</button></div></div>`;
    $('#cxGo', slot).onclick = () => cancelFlow(r.id);
    return;
  }
  if (r.status !== 'cancelled') return;
  const p = await api(`/recurring/${r.id}/cancel`);
  slot.innerHTML = cancelStatusHTML(p);
  wireCancelStatus(slot, p);
}

function cancelStatusHTML(p) {
  const st = p.cancel_state;
  const head = st === 'failed' ? `<h3 style="margin:0">❌ ${esc(p.name)} charged you after you cancelled</h3><p class="small">Ask for your money back:</p><ol class="small">${p.dispute.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      <div class="row wrap"><a class="btn primary" href="mailto:?subject=${encodeURIComponent('Refund request: ' + p.name)}&body=${encodeURIComponent(refundLetter(p))}">✉️ Email a refund request</a><button class="btn" id="cxRefCopy">Copy refund request</button></div>`
    : st === 'pending' ? `<h3 style="margin:0">⏳ Waiting to confirm</h3><p class="small">You cancelled on ${fdate(p.cancelled_at, { month: 'long', day: 'numeric' })}${p.cancel_ref ? ` (ref ${esc(p.cancel_ref)})` : ''}. PocketFinance watches for the next charge${p.next_date && p.next_date > p.cancelled_at ? ` around ${fdate(p.next_date)}` : ''}: if none comes, it's confirmed automatically; if one does, you'll get an alert with refund steps.</p>`
    : `<h3 style="margin:0">✅ Cancelled</h3><p class="small">No charges since ${fdate(p.cancelled_at, { month: 'long', day: 'numeric', year: 'numeric' })}${p.cancel_ref ? ` · ref ${esc(p.cancel_ref)}` : ''}. That's ${money(p.yearly, { cents: false })} a year you keep.</p>`;
  return `<div class="card cancel-card">${head}<div class="row wrap" style="margin-top:8px">${st === 'pending' ? '<button class="btn sm" id="cxOk">It\'s confirmed</button>' : ''}<button class="btn sm" id="cxUndo">It's still active</button></div></div>`;
}
function refundLetter(p) {
  return `Hello ${p.name} support,\n\nI cancelled my subscription on ${p.cancelled_at}${p.cancel_ref ? ` (confirmation ${p.cancel_ref})` : ''}, but I was charged again afterwards. Please refund every charge made after ${p.cancelled_at} and confirm the account is closed.\n\nIf this isn't resolved within 7 days I will dispute the charge with my bank.\n\nThank you,\n[your name]`;
}
function wireCancelStatus(slot, p) {
  if ($('#cxOk', slot)) $('#cxOk', slot).onclick = async () => { await api(`/recurring/${p.id}/cancel/confirm`, { method: 'POST' }); toast('Marked confirmed'); closeDrawer(); route(); };
  if ($('#cxUndo', slot)) $('#cxUndo', slot).onclick = async () => { await api(`/recurring/${p.id}/cancel/undo`, { method: 'POST' }); toast(`${p.name} is active again`); closeDrawer(); route(); };
  if ($('#cxRefCopy', slot)) $('#cxRefCopy', slot).onclick = () => navigator.clipboard.writeText(refundLetter(p)).then(() => toast('Copied'));
}

// the guided cancel flow
async function cancelFlow(id, { onDone } = {}) {
  const p = await api(`/recurring/${id}/cancel`);
  let pick = p.methods[0].id;
  const method = () => p.methods.find(m => m.id === pick);
  const body = () => {
    const m = method();
    return `<div class="small muted" style="margin:6px 0 10px">${esc(m.why)}</div><ol class="cx-steps">${m.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      ${m.url ? `<a class="btn primary" target="_blank" rel="noopener" href="${esc(m.url)}" id="cxOpen">Open ${m.id === 'channel' ? esc(p.channel.name) : 'the cancel page'} ↗</a>` : ''}
      ${m.id === 'email' ? `<label class="f" style="margin-top:8px"><span>Subject</span><input id="cxSubj" value="${esc(p.email.subject)}"></label><label class="f"><span>Email</span><textarea id="cxBody" rows="9">${esc(p.email.body)}</textarea></label>
        <div class="row wrap"><a class="btn primary" id="cxMail" href="#">✉️ Open in my email</a><button type="button" class="btn" id="cxCopy">Copy</button></div>` : ''}`;
  };
  openDrawer(`<div class="row" style="gap:14px"><div class="ico" style="width:48px;height:48px;font-size:22px">✂️</div><div><h2 style="margin:0">Cancel ${esc(p.name)}</h2>
      <div class="small muted">${money(p.amount)} ${(CAD_LABEL[p.cadence] || '').toLowerCase()} · <strong>${money(p.yearly, { cents: false })}/yr</strong> back in your pocket${p.next_date ? ` · next charge ${relDay(p.next_date).toLowerCase()}` : ''}</div></div></div>
    ${p.last ? `<div class="small muted" style="margin-top:8px">Paid with ${esc(p.last.account)}${p.last.mask ? ' ••' + esc(p.last.mask) : ''}, last charged ${fdate(p.last.date)}.</div>` : ''}
    <h3 class="sub-h">1. Cancel it</h3><div class="seg" id="cxM">${p.methods.map(m => `<button type="button" data-m="${m.id}" class="${m.id === pick ? 'on' : ''}">${CANCEL_ICON[m.id]} ${esc(m.title.replace(/^Cancel /, ''))}</button>`).join('')}</div>
    <div id="cxBodyBox">${body()}</div>
    <h3 class="sub-h">2. Tell PocketFinance it's done</h3>
    <form class="form" id="cxF"><div class="two"><label class="f"><span>Confirmation # (if you got one)</span><input name="ref" maxlength="80" placeholder="optional"></label><label class="f"><span>Cancelled on</span><input type="date" name="date" value="${todayISO()}"></label></div>
      <button class="btn primary">✓ I've cancelled it</button>
      <p class="small muted" style="margin:0">We'll watch for the next charge${p.next_date ? ` (expected ${fdate(p.next_date)})` : ''}. No charge → confirmed automatically. A charge → an alert with refund and dispute steps.</p></form>`, d => {
    const wire = () => {
      if ($('#cxMail', d)) $('#cxMail', d).onclick = e => { e.preventDefault(); location.href = `mailto:?subject=${encodeURIComponent($('#cxSubj', d).value)}&body=${encodeURIComponent($('#cxBody', d).value)}`; };
      if ($('#cxCopy', d)) $('#cxCopy', d).onclick = () => navigator.clipboard.writeText(`Subject: ${$('#cxSubj', d).value}\n\n${$('#cxBody', d).value}`).then(() => toast('Copied'));
    };
    $$('#cxM button', d).forEach(b => b.onclick = () => { pick = b.dataset.m; $$('#cxM button', d).forEach(x => x.classList.toggle('on', x === b)); $('#cxBodyBox', d).innerHTML = body(); wire(); });
    wire();
    $('#cxF', d).onsubmit = async e => {
      e.preventDefault(); const f = formData(e.target);
      await run(e.submitter, () => api(`/recurring/${id}/cancel`, { method: 'POST', body: { method: pick, ref: f.ref, date: f.date } }));
      openDrawer(`<div class="empty"><div class="big">🎉</div><h2>${esc(p.name)} cancelled</h2><p>That's <strong>${money(p.yearly, { cents: false })} a year</strong> back in your pocket.</p>
        <p class="small muted">PocketFinance will confirm it once the next billing date passes without a charge, and alert you if they bill you anyway.</p><button class="btn primary" data-close>Done</button></div>`);
      if (onDone) onDone(); else softRefresh();
    };
  });
}

// Rocket Money-style "keep or cancel?" walk through every subscription
async function reviewSubs() {
  const list = await api('/subscriptions/review');
  if (!list.length) return toast('All subscriptions reviewed in the last 90 days 👍');
  let i = 0, kept = 0, cancelled = 0;
  const total = list.reduce((s, x) => s + x.yearly, 0);
  const show = () => {
    if (i >= list.length) {
      return openDrawer(`<div class="empty"><div class="big">✅</div><h2>Review done</h2><p>${kept} kept · ${cancelled} cancelled${cancelled ? '' : ''}</p><p class="small muted">We'll ask again in 90 days, or when a price goes up.</p><button class="btn primary" data-close id="rvDone">Done</button></div>`, d => { $('#rvDone', d).onclick = () => { closeDrawer(); route(); }; });
    }
    const p = list[i];
    openDrawer(`<div class="small muted">Subscription ${i + 1} of ${list.length} · ${money(total, { cents: false })}/yr in total</div>
      <div class="bar" style="margin:6px 0 16px"><span style="width:${i / list.length * 100}%"></span></div>
      <div class="review-sub"><div class="ico" style="width:64px;height:64px;font-size:30px;margin:0 auto">${catIcon('Subscriptions')}</div>
        <h2 style="text-align:center;margin:10px 0 2px">${esc(p.name)}</h2>
        <div style="text-align:center" class="muted">${money(p.amount)} ${(CAD_LABEL[p.cadence] || '').toLowerCase()} · <strong style="color:var(--text)">${money(p.yearly, { cents: false })} a year</strong></div>
        ${p.last ? `<div class="small muted" style="text-align:center;margin-top:4px">Last charged ${fdate(p.last.date)}${p.channel ? ` · billed through ${esc(p.channel.name)}` : ''}</div>` : ''}
        <p style="text-align:center;margin:18px 0 10px"><strong>Still using it?</strong></p>
        <div class="row" style="justify-content:center;gap:10px"><button class="btn" id="rvKeep">👍 Keep</button><button class="btn danger" id="rvCancel">✂️ Cancel it</button></div>
        <div style="text-align:center;margin-top:10px"><button class="btn sm" id="rvSkip">Skip for now</button></div></div>`, d => {
      $('#rvKeep', d).onclick = async () => { await api(`/recurring/${p.id}/keep`, { method: 'POST' }); kept++; i++; show(); };
      $('#rvSkip', d).onclick = () => { i++; show(); };
      $('#rvCancel', d).onclick = () => cancelFlow(p.id, { onDone: () => { cancelled++; i++; setTimeout(show, 1600); } });
    });
  };
  show();
}

// savings banner for the Recurring page
function savingsBanner(d) {
  const s = d.savings || {};
  return `<div class="grid g2" style="margin-top:16px">
    <div class="card save-card"><div class="row between"><div><div class="label muted small">SAVED BY CANCELLING</div><div class="num" style="font-size:26px;font-weight:800">${money(s.yearly || 0, { cents: false })}<span class="small muted" style="font-weight:500">/yr</span></div>
      <div class="small muted">${s.count ? `${s.count} cancelled · ${money(s.soFar, { cents: false })} kept so far` : 'Cancel something you don\'t use and it shows up here.'}</div></div><div style="font-size:30px">💰</div></div></div>
    <div class="card"><div class="row between wrap" style="gap:10px"><div><strong>Review your subscriptions</strong><div class="small muted">${d.toReview ? `${d.toReview} to go through — keep or cancel, one at a time.` : 'All reviewed in the last 90 days.'}</div></div>
      <button class="btn primary" id="rvStart" ${d.toReview ? '' : 'disabled'}>Start review</button></div></div></div>`;
}
