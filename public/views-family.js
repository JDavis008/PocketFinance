/* Family: kids' allowance + chores (save / spend / give jars) and the monthly family money check-in. */
'use strict';

const JAR = { spend: { icon: '🛍️', label: 'Spend', color: 'var(--sky)' }, save: { icon: '🐷', label: 'Save', color: 'var(--pos)' }, give: { icon: '💝', label: 'Give', color: 'var(--pink)' } };
const FREQ = { daily: 'Every day', weekly: 'Once a week', once: 'One time' };
const KID_EMOJI = ['🧒', '👧', '👦', '🦄', '🦖', '🐱', '🐶', '🦊', '🐼', '🚀', '⚽', '🎨', '🎮', '🌈'];
const KID_COLORS = ['#6d4aff', '#e0418f', '#0ea5a4', '#2f80ed', '#e08a00', '#0f9f6e', '#e5484d'];

VIEWS.family = async (el, q) => {
  const tab = q.get('tab') === 'checkin' ? 'checkin' : 'kids';
  el.innerHTML = `<div class="toolbar"><div class="seg" id="famTabs"><button data-t="kids" class="${tab === 'kids' ? 'on' : ''}">🧒 Kids &amp; allowance</button><button data-t="checkin" class="${tab === 'checkin' ? 'on' : ''}">🗓️ Money check-in</button></div></div><div id="famBody"></div>`;
  $('#famTabs', el).onclick = e => { const b = e.target.closest('button'); if (b) location.hash = '#/family' + (b.dataset.t === 'checkin' ? '?tab=checkin' : ''); };
  const body = $('#famBody', el);
  if (tab === 'checkin') return checkinView(body, q.get('month'));
  return kidsView(body);
};

// ---------- kids ----------
async function kidsView(el) {
  const d = await api('/kids');
  const reload = () => route();
  if (!d.kids.length) {
    el.innerHTML = `<div class="card fam-hero"><div class="big">🐷</div><h2>Teach kids about money</h2>
      <p class="muted">Give each kid a weekly allowance that pays itself, chores that earn extra, and three jars: <strong>Spend</strong>, <strong>Save</strong> for a goal, and <strong>Give</strong>.</p>
      <button class="btn primary" id="addKid">+ Add a kid</button></div>`;
    $('#addKid', el).onclick = () => kidDrawer(null, d.days, reload);
    return;
  }
  el.innerHTML = `<div class="toolbar"><span class="small muted grow">Allowance is paid automatically on payday and split into the jars. Tap a chore when it's done.</span><button class="btn primary" id="addKid">+ Add a kid</button></div>
    <div class="grid g2 kids">${d.kids.map(k => kidCard(k, d.days)).join('')}</div>`;
  $('#addKid', el).onclick = () => kidDrawer(null, d.days, reload);
  el.addEventListener('click', async e => {
    const card = e.target.closest('[data-kid]'); if (!card) return;
    const k = d.kids.find(x => x.id === Number(card.dataset.kid));
    const ch = e.target.closest('[data-chore]');
    if (ch) {
      const c = k.chores.find(x => x.id === Number(ch.dataset.chore));
      if (c.done) { await run(ch, () => api(`/chores/${c.id}/undo`, { method: 'POST' }), 'Undone'); }
      else { await run(ch, () => api(`/chores/${c.id}/done`, { method: 'POST' }), c.reward > 0 ? `${k.emoji} +${money(c.reward)} for “${c.name}”` : `✓ ${c.name}`); confetti(ch); }
      return reload();
    }
    const act = e.target.closest('[data-act]'); if (!act) return;
    const a = act.dataset.act;
    if (a === 'edit') kidDrawer(k, d.days, reload);
    else if (a === 'chore') choreDrawer(k, null, reload);
    else if (a === 'editchore') choreDrawer(k, k.chores.find(x => x.id === Number(act.dataset.id)), reload);
    else if (a === 'money') moneyDrawer(k, act.dataset.type, reload);
    else if (a === 'history') historyDrawer(k, reload);
  });
}

function kidCard(k, days) {
  const goal = k.goal_amount > 0 ? Math.min(1, k.jars.save / k.goal_amount) : null;
  return `<div class="card kid" data-kid="${k.id}" style="--kid:${esc(k.color)}">
    <div class="kid-h"><div class="kid-face">${esc(k.emoji)}</div><div class="main"><h2>${esc(k.name)}</h2>
      <div class="small muted">${k.allowance > 0 ? `${money(k.allowance)} every ${days[k.pay_day]} · next ${relDay(k.next_payday).toLowerCase()}` : 'No allowance set'}</div></div>
      <div class="kid-total num">${money(k.total)}</div></div>
    <div class="jars">${['spend', 'save', 'give'].map(j => `<div class="jar ${j}"><div class="jar-i">${JAR[j].icon}</div><div class="jar-v num">${money(k.jars[j])}</div><div class="jar-l">${JAR[j].label}</div></div>`).join('')}</div>
    ${goal != null ? `<div class="kid-goal"><div class="row small"><span class="grow">🎯 ${esc(k.goal_name || 'Savings goal')}</span><strong class="num">${money(k.jars.save, { cents: false })} / ${money(k.goal_amount, { cents: false })}</strong></div><div class="bar"><span style="width:${(goal * 100).toFixed(1)}%;background:var(--kid)"></span></div>
      ${goal >= 1 ? '<div class="small pos" style="margin-top:4px">🎉 Goal reached!</div>' : k.allowance > 0 ? `<div class="small muted" style="margin-top:4px">About ${Math.ceil((k.goal_amount - k.jars.save) / Math.max(0.01, k.allowance * k.save_pct / 100))} more weeks of saving</div>` : ''}</div>` : ''}
    <div class="card-h" style="margin:14px 0 6px"><h3 style="margin:0">Chores ${k.earned_week > 0 ? `<span class="pill green">+${money(k.earned_week)} this week</span>` : ''}</h3><button class="btn sm" data-act="chore">+ Chore</button></div>
    <div class="chores">${k.chores.length ? k.chores.map(c => `<div class="chore-row"><button class="chore ${c.done ? 'done' : ''}" data-chore="${c.id}" aria-pressed="${c.done}"><span class="tick">${c.done ? '✓' : ''}</span><span class="cn">${esc(c.name)}</span><span class="cr num">${c.reward > 0 ? money(c.reward) : ''}</span></button><button class="icon-btn sm" data-act="editchore" data-id="${c.id}" aria-label="Edit ${esc(c.name)}">✎</button></div><div class="small muted chore-f">${FREQ[c.freq] || ''}</div>`).join('')
      : '<div class="small muted">No chores yet. Add “Make bed”, “Feed the dog”…</div>'}</div>
    <div class="row wrap kid-acts"><button class="btn sm primary" data-act="money" data-type="add">+ Add money</button><button class="btn sm" data-act="money" data-type="spend">− Spend</button><button class="btn sm" data-act="money" data-type="move">⇄ Move</button><span class="grow"></span><button class="btn sm" data-act="history">History</button><button class="btn sm" data-act="edit">⚙️</button></div>
  </div>`;
}

function confetti(near) {
  try {
    const r = near.getBoundingClientRect(), box = document.createElement('div'); box.className = 'confetti'; box.style.left = (r.left + r.width / 2) + 'px'; box.style.top = (r.top + r.height / 2) + 'px';
    box.innerHTML = Array.from({ length: 14 }, (_, i) => `<i style="--a:${i * 360 / 14}deg;--c:${['#6d4aff', '#0ea5a4', '#e0418f', '#e08a00', '#0f9f6e'][i % 5]}"></i>`).join('');
    document.body.appendChild(box); setTimeout(() => box.remove(), 900);
  } catch { /* decoration only */ }
}

function kidDrawer(k, days, after) {
  openDrawer(`<h2>${k ? `Edit ${esc(k.name)}` : 'Add a kid'}</h2><form class="form" id="kidF">
    <div class="two"><label class="f"><span>Name</span><input name="name" required maxlength="40" value="${esc(k ? k.name : '')}"></label>
      <label class="f"><span>Weekly allowance</span><input name="allowance" type="number" step="0.25" min="0" value="${k ? k.allowance : 5}"></label></div>
    <label class="f"><span>Pick an icon</span><div class="emoji-pick" id="emo">${KID_EMOJI.map(e => `<button type="button" class="${(k ? k.emoji : '🧒') === e ? 'on' : ''}">${e}</button>`).join('')}</div></label>
    <label class="f"><span>Color</span><div class="emoji-pick" id="col">${KID_COLORS.map(c => `<button type="button" data-c="${c}" class="sw ${(k ? k.color : '#6d4aff') === c ? 'on' : ''}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div></label>
    <div class="two"><label class="f"><span>Payday</span><select name="pay_day">${days.map((n, i) => `<option value="${i}" ${(k ? k.pay_day : 6) === i ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="f"><span>Split each payment</span><div class="row small"><input name="save_pct" type="number" min="0" max="100" value="${k ? k.save_pct : 20}" style="width:70px"> % save <input name="give_pct" type="number" min="0" max="100" value="${k ? k.give_pct : 10}" style="width:70px"> % give</div></label></div>
    <div class="two"><label class="f"><span>Saving for (optional)</span><input name="goal_name" maxlength="60" placeholder="e.g. Bike" value="${esc(k ? k.goal_name || '' : '')}"></label>
      <label class="f"><span>Goal amount</span><input name="goal_amount" type="number" step="1" min="0" value="${k && k.goal_amount ? k.goal_amount : ''}"></label></div>
    ${k ? '' : '<label class="f"><span>Money they already have (optional)</span><input name="start_balance" type="number" step="0.01" min="0" placeholder="0.00"></label>'}
    <p class="small muted" style="margin:0">The rest of each payment goes to Spend. Allowance starts from today; nothing is back-paid.</p>
    <div class="row wrap"><button class="btn primary">${k ? 'Save' : 'Add'}</button>${k ? '<span style="flex:1"></span><button type="button" class="btn danger" id="kidDel">Remove</button>' : ''}</div></form>`, d => {
    const f = $('#kidF', d);
    let emoji = k ? k.emoji : '🧒', color = k ? k.color : '#6d4aff';
    $('#emo', d).onclick = e => { const b = e.target.closest('button'); if (!b) return; emoji = b.textContent; $$('#emo button', d).forEach(x => x.classList.toggle('on', x === b)); };
    $('#col', d).onclick = e => { const b = e.target.closest('button'); if (!b) return; color = b.dataset.c; $$('#col button', d).forEach(x => x.classList.toggle('on', x === b)); };
    f.onsubmit = async e => {
      e.preventDefault(); const v = { ...formData(f), emoji, color };
      await run(e.submitter, () => (k ? api(`/kids/${k.id}`, { method: 'PATCH', body: v }) : api('/kids', { method: 'POST', body: v })), k ? 'Saved' : `${emoji} ${v.name} added`);
      closeDrawer(); after();
    };
    if (k) $('#kidDel', d).onclick = async () => { if (!confirm(`Remove ${k.name} and all of their jars, chores and history? This can't be undone.`)) return; await api(`/kids/${k.id}`, { method: 'DELETE' }); closeDrawer(); after(); };
  });
}

function choreDrawer(k, c, after) {
  openDrawer(`<h2>${c ? 'Edit chore' : `New chore for ${esc(k.name)}`}</h2><form class="form" id="chF">
    <label class="f"><span>Chore</span><input name="name" required maxlength="60" list="choreIdeas" value="${esc(c ? c.name : '')}" placeholder="e.g. Empty the dishwasher"><datalist id="choreIdeas">${['Make bed', 'Feed the pet', 'Take out trash', 'Empty the dishwasher', 'Clean room', 'Homework done', 'Practice instrument', 'Fold laundry', 'Help with dinner', 'Read 20 minutes'].map(x => `<option value="${x}">`).join('')}</datalist></label>
    <div class="two"><label class="f"><span>Pays</span><input name="reward" type="number" step="0.25" min="0" value="${c ? c.reward : 1}"></label>
      <label class="f"><span>How often</span><select name="freq">${Object.entries(FREQ).map(([v, l]) => `<option value="${v}" ${(c ? c.freq : 'weekly') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <div class="row wrap"><button class="btn primary">${c ? 'Save' : 'Add chore'}</button>${c ? '<span style="flex:1"></span><button type="button" class="btn danger" id="chDel">Delete</button>' : ''}</div></form>`, d => {
    const f = $('#chF', d);
    f.onsubmit = async e => { e.preventDefault(); const v = formData(f); await run(e.submitter, () => (c ? api(`/chores/${c.id}`, { method: 'PATCH', body: v }) : api(`/kids/${k.id}/chores`, { method: 'POST', body: v })), 'Saved'); closeDrawer(); after(); };
    if (c) $('#chDel', d).onclick = async () => { if (!confirm(`Delete “${c.name}”? Money already earned stays.`)) return; await api(`/chores/${c.id}`, { method: 'DELETE' }); closeDrawer(); after(); };
  });
}

function moneyDrawer(k, type, after) {
  const jarSel = (name, sel) => `<select name="${name}">${Object.entries(JAR).map(([v, j]) => `<option value="${v}" ${sel === v ? 'selected' : ''}>${j.icon} ${j.label} (${money(k.jars[v])})</option>`).join('')}</select>`;
  const title = type === 'spend' ? `${esc(k.name)} spent money` : type === 'move' ? 'Move between jars' : `Money for ${esc(k.name)}`;
  openDrawer(`<h2>${title}</h2><form class="form" id="mF">
    <div class="two"><label class="f"><span>Amount</span><input name="amount" type="number" step="0.01" min="0.01" required autofocus></label>
      <label class="f"><span>Date</span><input name="date" type="date" value="${todayISO()}"></label></div>
    ${type === 'move' ? `<div class="two"><label class="f"><span>From</span>${jarSel('from', 'spend')}</label><label class="f"><span>To</span>${jarSel('to', 'save')}</label></div>`
      : type === 'spend' ? `<label class="f"><span>From jar</span>${jarSel('jar', 'spend')}</label>`
      : `<label class="f"><span>Put it in</span><select name="jar"><option value="">Split like allowance (${100 - k.save_pct - k.give_pct}% / ${k.save_pct}% / ${k.give_pct}%)</option>${Object.entries(JAR).map(([v, j]) => `<option value="${v}">${j.icon} All in ${j.label}</option>`).join('')}</select></label>`}
    <label class="f"><span>${type === 'spend' ? 'What for' : 'Note'}</span><input name="note" maxlength="80" placeholder="${type === 'spend' ? 'e.g. Book fair' : type === 'move' ? '' : 'e.g. Birthday money'}"></label>
    <button class="btn primary">${type === 'spend' ? 'Take it out' : type === 'move' ? 'Move' : 'Add'}</button></form>`, d => {
    const f = $('#mF', d);
    f.onsubmit = async e => { e.preventDefault(); const v = { ...formData(f), type }; await run(e.submitter, () => api(`/kids/${k.id}/ledger`, { method: 'POST', body: v }), 'Saved'); closeDrawer(); after(); };
  });
}

function historyDrawer(k, after) {
  const kindLbl = { allowance: '💵 Allowance', chore: '✅ Chore', deposit: '➕ Added', spend: '🛍️ Spent', give: '💝 Gave', move: '⇄ Moved' };
  openDrawer(`<h2>${esc(k.emoji)} ${esc(k.name)}'s history</h2><div class="list">${k.recent.length ? k.recent.map(r => `<div class="item" style="cursor:default"><div class="ico">${JAR[r.jar] ? JAR[r.jar].icon : '•'}</div>
      <div class="main"><div class="t">${esc(r.note || kindLbl[r.kind] || r.kind)}</div><div class="s">${kindLbl[r.kind] || r.kind} · ${JAR[r.jar] ? JAR[r.jar].label : ''} · ${fdate(r.date, { month: 'short', day: 'numeric', year: 'numeric' })}</div></div>
      <div class="amt num ${r.amount < 0 ? 'neg' : 'pos'}">${r.amount < 0 ? '−' : '+'}${money(Math.abs(r.amount))}</div><button class="icon-btn sm" data-del="${r.id}" aria-label="Delete">✕</button></div>`).join('') : '<div class="empty small">Nothing yet.</div>'}</div>
    <p class="small muted">Showing the latest 25 entries.</p>`, d => {
    d.addEventListener('click', async e => { const b = e.target.closest('[data-del]'); if (!b) return; if (!confirm('Delete this entry?')) return; await api(`/kids/ledger/${b.dataset.del}`, { method: 'DELETE' }); closeDrawer(); after(); });
  });
}

// ---------- monthly money check-in ----------
async function checkinView(el, month) {
  // early in the month, the check-in is about the month that just ended
  const m = month || (Number(todayISO().slice(8)) <= 7 ? shiftMonth(todayISO().slice(0, 7), -1) : todayISO().slice(0, 7));
  const d = await api('/family/checkin?month=' + m);
  const t = d.totals, mname = fmonth(d.month);
  el.innerHTML = `<div class="month-nav"><button class="btn sm" id="ciPrev" aria-label="Previous month">‹</button><strong>${mname}${d.current ? ' <span class="pill acc">so far</span>' : ''}</strong><button class="btn sm" id="ciNext" aria-label="Next month" ${d.current ? 'disabled' : ''}>›</button></div>
    <div class="card fam-hero ci"><div class="big">🗓️</div><h2>Family money check-in</h2><p class="muted">Sit down together for 15 minutes once a month. Go through the talking points, decide what to change, and write it down.</p>
      <div class="row wrap" style="justify-content:center"><button class="btn primary" id="ciShare">📤 Share the agenda</button></div></div>
    <div class="grid g3" style="margin-top:16px">
      <div class="card stat"><div class="label">Came in</div><div class="value num pos">${money(t.income, { cents: false })}</div><div class="sub">${d.prev.income ? `${t.income >= d.prev.income ? '▲' : '▼'} ${money(Math.abs(t.income - d.prev.income), { cents: false })} vs last month` : '&nbsp;'}</div></div>
      <div class="card stat"><div class="label">Went out</div><div class="value num">${money(t.spending, { cents: false })}</div><div class="sub">${d.prev.spending ? `${t.spending >= d.prev.spending ? '▲' : '▼'} ${money(Math.abs(t.spending - d.prev.spending), { cents: false })} vs last month` : '&nbsp;'}</div></div>
      <div class="card stat"><div class="label">Kept</div><div class="value num ${t.net >= 0 ? 'pos' : 'neg'}">${money(t.net, { sign: true, cents: false })}</div><div class="sub">${t.income ? Math.round(t.net / t.income * 100) + '% of income' : '&nbsp;'}</div></div></div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h2>💬 Talking points</h2><ol class="points">${d.points.length ? d.points.map(p => `<li>${esc(p)}</li>`).join('') : '<li class="muted">Not much to talk about yet. Connect accounts or load the demo.</li>'}</ol></div>
      <div class="card"><h2>📝 What we decided</h2><textarea id="ciNotes" rows="8" maxlength="5000" placeholder="e.g. Cap eating out at $250. Move $100/month to the Japan trip. Emma gets a raise to $12.">${esc(d.notes)}</textarea>
        <div class="row" style="margin-top:8px"><span class="small muted grow" id="ciSaved">${d.notes_updated ? 'Saved ' + new Date(d.notes_updated).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : ''}</span><button class="btn sm primary" id="ciSave">Save notes</button></div></div>
      <div class="card"><h2>Where it went</h2><div class="list">${d.categories.map(c => `<a class="item" href="#/transactions?category=${encodeURIComponent(c.name)}"><div class="ico">${c.icon || catIcon(c.name)}</div><div class="main"><div class="t">${esc(c.name)}</div><div class="s">${c.prev ? `${c.change >= 0 ? '▲' : '▼'} ${money(Math.abs(c.change), { cents: false })} vs last month` : 'new this month'}</div></div><div class="amt num">${money(c.total, { cents: false })}</div></a>`).join('') || '<div class="empty small">No spending yet.</div>'}</div></div>
      <div class="card"><h2>Budgets ${d.budgets.count ? `<span class="pill ${d.over.length ? 'red' : 'green'}">${d.budgets.on_track}/${d.budgets.count} on track</span>` : ''}</h2>
        ${d.over.length ? `<div class="list">${d.over.map(o => `<a class="item" href="#/budgets"><div class="ico">⚠️</div><div class="main"><div class="t">${esc(o.category)}</div><div class="s">${money(o.spent, { cents: false })} of ${money(o.limit, { cents: false })}</div></div><div class="amt num neg">+${money(o.over, { cents: false })}</div></a>`).join('')}</div>` : `<p class="muted">${d.budgets.count ? 'Every budget is on track. 🎉' : 'No budgets yet. <a href="#/budgets">Set some up</a>.'}</p>`}
        <h3 style="margin-top:14px">Bills in the next 2 weeks</h3><div class="list">${d.bills.length ? d.bills.map(b => `<div class="item" style="cursor:default"><div class="ico">📅</div><div class="main"><div class="t">${esc(b.name)}</div><div class="s">${relDay(b.date)}</div></div><div class="amt num">${money(b.amount)}</div></div>`).join('') : '<div class="small muted">Nothing due.</div>'}</div></div>
      ${d.goals.length ? `<div class="card"><h2>Goals</h2>${d.goals.map(g => `<div style="margin-bottom:10px"><div class="row small"><span class="grow">${g.icon || '🎯'} ${esc(g.name)}</span><strong class="num">${Math.round(g.pct * 100)}%</strong></div><div class="bar"><span style="width:${(g.pct * 100).toFixed(1)}%"></span></div></div>`).join('')}</div>` : ''}
      ${d.kids.length ? `<div class="card"><h2>Kids</h2><div class="list">${d.kids.map(k => `<a class="item" href="#/family"><div class="ico">${esc(k.emoji)}</div><div class="main"><div class="t">${esc(k.name)}</div><div class="s">${money(k.save)} saved · ${k.chores_done}/${k.chores} chores</div></div><div class="amt num">${money(k.total)}</div></a>`).join('')}</div></div>` : ''}
    </div>`;
  const go = n => { location.hash = `#/family?tab=checkin&month=${shiftMonth(d.month, n)}`; };
  $('#ciPrev', el).onclick = () => go(-1);
  $('#ciNext', el).onclick = () => go(1);
  $('#ciSave', el).onclick = async e => { await run(e.target, () => api(`/family/notes/${d.month}`, { method: 'PUT', body: { notes: $('#ciNotes', el).value } }), 'Notes saved'); $('#ciSaved', el).textContent = 'Saved just now'; };
  $('#ciShare', el).onclick = async () => {
    const text = [`Family money check-in: ${mname}`, '', `In ${money(t.income, { cents: false })} · Out ${money(t.spending, { cents: false })} · Kept ${money(t.net, { sign: true, cents: false })}`, '', 'Talking points:', ...d.points.map((p, i) => `${i + 1}. ${p}`),
      ...($('#ciNotes', el).value.trim() ? ['', 'What we decided:', $('#ciNotes', el).value.trim()] : [])].join('\n');
    const how = await sendShare({ title: `Money check-in · ${mname}`, text });
    if (how === 'fallback') { try { await navigator.clipboard.writeText(text); toast('Agenda copied, paste it anywhere'); } catch { prompt('Copy the agenda:', text); } }
  };
}
