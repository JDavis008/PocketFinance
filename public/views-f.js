/* Split & IOUs (shared costs, settle up), quick search (Ctrl+K), restore from backup. */
'use strict';

// ---------- Split & IOUs ----------
const initials = n => esc(String(n).trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase());
const iouLine = i => i.direction === 'owed_me' ? `${esc(i.person)} owes you` : `You owe ${esc(i.person)}`;

VIEWS.owed = async el => {
  const d = await api('/ious');
  const net = d.owed_me - d.i_owe;
  el.innerHTML = `<div class="grid g3">
    <div class="card stat"><div class="label">Owed to you</div><div class="value num pos">${money(d.owed_me)}</div><div class="sub">${d.open.filter(i => i.direction === 'owed_me').length} open</div></div>
    <div class="card stat"><div class="label">You owe</div><div class="value num ${d.i_owe ? 'neg' : ''}">${money(d.i_owe)}</div><div class="sub">${d.open.filter(i => i.direction === 'i_owe').length} open</div></div>
    <div class="card stat"><div class="label">Overall</div><div class="value num ${net >= 0 ? 'pos' : 'neg'}">${money(net, { sign: true })}</div><div class="sub">${net >= 0 ? 'in your favor' : 'you owe overall'}</div></div></div>
  <div class="toolbar" style="margin-top:16px"><span class="small muted grow">Split a bill with a roommate, a trip with friends, or keep track of money you lent. Tip: open any transaction and tap <strong>👥 Share cost</strong>.</span><button class="btn primary" id="addIou">+ Add IOU</button></div>
  <div class="grid g2">
    <div class="card"><h2>People</h2><div class="list">${d.people.length ? d.people.map(p => `<div class="item person" style="cursor:default">
      <div class="ico avatar">${initials(p.person)}</div><div class="main"><div class="t">${esc(p.person)}</div>
      <div class="s">${p.net > 0 ? `owes you <strong class="pos">${money(p.net)}</strong>` : p.net < 0 ? `you owe <strong class="neg">${money(-p.net)}</strong>` : 'all even'} · ${p.count} item${p.count === 1 ? '' : 's'}</div></div>
      <div class="acts">${p.net > 0 ? `<button class="btn sm" data-remind="${esc(p.person)}">📤 Remind</button>` : ''}<button class="btn sm primary" data-settle="${esc(p.person)}">Settle up</button></div></div>`).join('')
      : '<div class="empty"><div class="big">🤝</div>Nobody owes anybody. Nice.</div>'}</div></div>
    <div class="card"><h2>Open</h2><div class="list" id="openList">${d.open.length ? d.open.map(iouRow).join('') : '<div class="empty small">No open IOUs.</div>'}</div></div>
  </div>
  ${d.settled.length ? `<details class="card" style="margin-top:16px"><summary><strong>Settled</strong> <span class="muted small">(${d.settled.length})</span></summary><div class="list" style="margin-top:8px">${d.settled.map(iouRow).join('')}</div></details>` : ''}`;
  const reload = () => route();
  $('#addIou', el).onclick = () => iouDrawer({ names: d.names }, reload);
  el.addEventListener('click', async e => {
    const row = e.target.closest('[data-iou]');
    if (row) { const i = [...d.open, ...d.settled].find(x => x.id === Number(row.dataset.iou)); if (i) iouDrawer({ iou: i, names: d.names }, reload); return; }
    const s = e.target.closest('[data-settle]');
    if (s) {
      const p = d.people.find(x => x.person === s.dataset.settle);
      if (!confirm(`Mark everything with ${p.person} as settled (${p.net >= 0 ? `they paid you ${money(p.net)}` : `you paid ${money(-p.net)}`})?`)) return;
      await run(s, () => api('/ious/settle', { method: 'POST', body: { person: p.person } }), r => `Settled ${r.settled} item${r.settled === 1 ? '' : 's'} with ${p.person}`); reload(); return;
    }
    const rm = e.target.closest('[data-remind]');
    if (rm) {
      const p = d.people.find(x => x.person === rm.dataset.remind);
      const items = d.open.filter(i => i.person.toLowerCase() === p.person.toLowerCase());
      const text = [`Hi ${p.person}! Quick reminder, the running total is ${money(p.net)}:`, ...items.map(i => `• ${i.note || i.merchant || 'Shared cost'} (${fdate(i.date)}): ${i.direction === 'owed_me' ? '' : '−'}${money(i.amount)}`)].join('\n');
      const how = await sendShare({ title: `Reminder for ${p.person}`, text });
      if (how === 'fallback') { try { await navigator.clipboard.writeText(text); toast('Reminder copied — paste it into a text'); } catch { prompt('Copy this reminder:', text); } }
    }
  });
};

function iouRow(i) {
  return `<a class="item" data-iou="${i.id}"><div class="ico avatar ${i.direction === 'i_owe' ? 'neg' : ''}">${initials(i.person)}</div>
    <div class="main"><div class="t">${iouLine(i)}</div><div class="s">${esc(i.note || i.merchant || 'Shared cost')} · ${fdate(i.date, { month: 'short', day: 'numeric', year: 'numeric' })}${i.settled_at ? ` · settled ${fdate(i.settled_at)}` : ''}</div></div>
    <div class="amt num ${i.settled_at ? 'muted' : i.direction === 'owed_me' ? 'pos' : 'neg'}">${money(i.amount)}</div></a>`;
}

// add / edit one IOU; pass { tx } to share a transaction's cost
async function iouDrawer({ iou, tx, names }, after) {
  if (!names) names = (await api('/ious').catch(() => ({ names: [] }))).names;
  const amt = iou ? iou.amount : tx ? Math.abs(tx.amount) / 2 : '';
  openDrawer(`<h2>${iou ? 'IOU' : tx ? `Share ${esc(tx.merchant)}` : 'Add an IOU'}</h2>
    ${tx ? `<p class="small muted" style="margin-top:0">${money(Math.abs(tx.amount))} on ${fdate(tx.date, { month: 'short', day: 'numeric', year: 'numeric' })}. Half is filled in; change it for a different split.</p>
      <div class="seg" id="splitPick" style="margin-bottom:12px"><button type="button" data-f="0.5" class="on">Half</button><button type="button" data-f="0.3333">A third</button><button type="button" data-f="0.25">A quarter</button><button type="button" data-f="1">All of it</button></div>` : ''}
    <form class="form" id="iouF">
      <div class="two"><label class="f"><span>Person</span><input name="person" list="iouNames" required maxlength="60" value="${esc(iou ? iou.person : '')}" autocomplete="off" placeholder="e.g. Sam"><datalist id="iouNames">${(names || []).map(n => `<option value="${esc(n)}">`).join('')}</datalist></label>
        <label class="f"><span>Amount</span><input name="amount" type="number" step="0.01" min="0.01" required value="${amt === '' ? '' : Number(amt).toFixed(2)}"></label></div>
      <label class="f"><span>Who owes who</span><select name="direction"><option value="owed_me" ${!iou || iou.direction === 'owed_me' ? 'selected' : ''}>They owe me</option><option value="i_owe" ${iou && iou.direction === 'i_owe' ? 'selected' : ''}>I owe them</option></select></label>
      <div class="two"><label class="f"><span>What for</span><input name="note" maxlength="120" value="${esc(iou ? iou.note || '' : tx ? tx.merchant : '')}"></label>
        <label class="f"><span>Date</span><input name="date" type="date" value="${esc(iou ? iou.date : tx ? tx.date : todayISO())}" ${iou ? 'disabled' : ''}></label></div>
      <div class="row wrap"><button class="btn primary">${iou ? 'Save' : 'Add'}</button>
        ${iou ? `<button type="button" class="btn" id="iouSettle">${iou.settled_at ? '↩ Reopen' : '✓ Mark settled'}</button>${iou.tx_id ? `<button type="button" class="btn" id="iouTx">View transaction</button>` : ''}<span style="flex:1"></span><button type="button" class="btn danger" id="iouDel">Delete</button>` : ''}</div>
    </form>`, d => {
    const f = $('#iouF', d);
    if ($('#splitPick', d)) $('#splitPick', d).onclick = e => { const b = e.target.closest('button'); if (!b) return; $$('#splitPick button', d).forEach(x => x.classList.toggle('on', x === b)); f.amount.value = (Math.abs(tx.amount) * Number(b.dataset.f)).toFixed(2); };
    f.onsubmit = async e => {
      e.preventDefault(); const v = formData(f);
      if (iou) await run(e.submitter, () => api(`/ious/${iou.id}`, { method: 'PATCH', body: v }), 'Saved');
      else await run(e.submitter, () => api('/ious', { method: 'POST', body: { ...v, tx_id: tx ? tx.id : null } }), v.direction === 'owed_me' ? `${v.person} owes you ${money(v.amount)}` : `You owe ${v.person} ${money(v.amount)}`);
      closeDrawer(); after && after();
    };
    if (iou) {
      $('#iouSettle', d).onclick = async e => { await run(e.target, () => api(`/ious/${iou.id}`, { method: 'PATCH', body: { settled: !iou.settled_at } }), iou.settled_at ? 'Reopened' : 'Settled'); closeDrawer(); after && after(); };
      $('#iouDel', d).onclick = async () => { if (!confirm('Delete this IOU?')) return; await api(`/ious/${iou.id}`, { method: 'DELETE' }); closeDrawer(); after && after(); };
      if ($('#iouTx', d)) $('#iouTx', d).onclick = () => editTx(iou.tx_id, after);
    }
  });
}

// ---------- quick search (Ctrl+K or /) ----------
function openSearch() {
  openDrawer(`<h2>Search</h2><input id="qsIn" type="search" placeholder="Pages, accounts, categories, merchants, amounts…" autocomplete="off">
    <div class="small muted" style="margin:6px 2px 4px">↑ ↓ to move · Enter to open · Esc to close</div><div id="qsRes" class="list qs"></div>`, d => {
    const input = $('#qsIn', d), res = $('#qsRes', d);
    const pages = $$('#nav a').map(a => ({ href: a.getAttribute('href'), icon: a.querySelector('i').textContent, name: a.querySelector('span').textContent.trim() }));
    let seq = 0, sel = 0;
    const item = (attrs, icon, t, s, right = '') => `<a class="item" ${attrs}><div class="ico">${icon}</div><div class="main"><div class="t">${t}</div>${s ? `<div class="s">${s}</div>` : ''}</div>${right}</a>`;
    const mark = () => $$('.item', res).forEach((x, k) => x.classList.toggle('sel', k === sel));
    const draw = async () => {
      const q = input.value.trim().toLowerCase(), my = ++seq; sel = 0;
      const has = s => String(s || '').toLowerCase().includes(q);
      const pg = pages.filter(p => !q || has(p.name)).slice(0, q ? 6 : 8);
      const ac = q ? STATE.accounts.filter(a => has(a.name) || has(a.institution) || has(a.mask)).slice(0, 5) : [];
      const ct = q ? STATE.cats.filter(c => has(c.name)).slice(0, 4) : [];
      let html = (pg.length ? '<div class="day-h">Pages</div>' + pg.map(p => item(`href="${p.href}"`, p.icon, esc(p.name), '')).join('') : '')
        + (ac.length ? '<div class="day-h">Accounts</div>' + ac.map(a => item(`href="#/transactions?account=${a.id}"`, '🏦', esc(a.name), esc(a.institution || ''), `<div class="amt num">${money(a.balance)}</div>`)).join('') : '')
        + (ct.length ? '<div class="day-h">Categories</div>' + ct.map(c => item(`href="#/transactions?category=${encodeURIComponent(c.name)}"`, c.icon, esc(c.name), esc(c.grp))).join('') : '');
      res.innerHTML = html || '<div class="empty small">Type to search.</div>'; mark();
      if (q.length < 2) return;
      const r = await api('/transactions?' + new URLSearchParams({ q: input.value.trim(), limit: 8 })).catch(() => null);
      if (!r || my !== seq || !r.rows.length) return;
      html += `<div class="day-h">Transactions <a class="tile-link" style="float:right;text-transform:none" href="#/transactions?q=${encodeURIComponent(input.value.trim())}">All ${r.total.n} ›</a></div>`
        + r.rows.map(t => item(`href="#" data-qtx="${t.id}"`, catIcon(t.category), esc(t.merchant), `${fdate(t.date, { month: 'short', day: 'numeric', year: 'numeric' })} · ${esc(t.category)}`, `<div class="amt">${txAmt(t.amount)}</div>`)).join('');
      res.innerHTML = html; mark();
    };
    let deb; input.oninput = () => { clearTimeout(deb); deb = setTimeout(draw, 160); };
    input.onkeydown = e => {
      const items = $$('.item', res);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, Math.min(items.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1))); mark(); items[sel] && items[sel].scrollIntoView({ block: 'nearest' }); }
      if (e.key === 'Enter' && items[sel]) { e.preventDefault(); items[sel].click(); }
    };
    res.onclick = e => {
      const a = e.target.closest('a'); if (!a) return;
      if (a.dataset.qtx) { e.preventDefault(); editTx(Number(a.dataset.qtx), () => route()); return; }
      if (a.getAttribute('href') === location.hash) { e.preventDefault(); closeDrawer(); route(); }
    };
    draw(); setTimeout(() => input.focus(), 30);
  });
}
document.addEventListener('keydown', e => {
  if ($('#shell').classList.contains('hidden')) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '')) || e.target.isContentEditable;
  if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) { e.preventDefault(); openSearch(); }
});
$('#searchBtn').addEventListener('click', openSearch);

// ---------- restore from a Full backup (Settings → Your data) ----------
function wireRestore(el) {
  const btn = $('#restoreBtn', el), file = $('#restoreFile', el); if (!btn) return;
  if (STATE.user.role !== 'owner') { btn.remove(); return; }
  btn.onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files[0]; file.value = ''; if (!f) return;
    let data; try { data = JSON.parse(await f.text()); } catch { return toast("That file isn't a PocketFinance backup.", 4500); }
    if (!data || data.version !== 1 || !Array.isArray(data.accounts)) return toast("That file isn't a PocketFinance backup.", 4500);
    const when = data.exported ? new Date(data.exported).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : 'an unknown date';
    if (!confirm(`Replace your accounts, transactions, budgets, goals and the rest with this backup from ${when}?\n\n${data.accounts.length} accounts · ${(data.transactions || []).length.toLocaleString()} transactions\n\nA copy of what's here now is saved first (data\\backups). Bank connections on this PC stay; others will need to be connected again.`)) return;
    const r = await run(btn, () => api('/restore', { method: 'POST', body: data }), r => `Restored ${r.counts.accounts || 0} accounts and ${(r.counts.transactions || 0).toLocaleString()} transactions`);
    await loadCats(true); STATE.accounts = (await api('/accounts')).accounts; refreshBell();
    if (r) location.hash = '#/dashboard';
  };
}
