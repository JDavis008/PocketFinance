/* AI Advisor (Gemini): chat page, setup, dashboard insights card */
'use strict';

const AI_SUGGESTIONS = [
  ['💸', 'Where can I cut $300 a month?'],
  ['🔄', 'Which subscriptions should I cancel?'],
  ['💳', 'Make a plan to pay off my debt'],
  ['🛟', 'How big should my emergency fund be, and how do I get there?'],
  ['📊', 'Review my spending this month vs last month'],
  ['🎯', 'Am I on track with my budgets and goals?'],
  ['📈', 'How can I raise my savings rate?'],
  ['🧾', 'What bills could I negotiate down?'],
];
const AI_NOTE = 'AI-generated from your data by Google Gemini. Not a licensed financial advisor — double-check before acting.';

function aiSetupHTML(st, compact) {
  return `<div class="card ai-setup">
    <div class="row" style="gap:14px;align-items:flex-start"><div class="ai-orb">✨</div><div style="flex:1;min-width:0">
      <h2 style="margin-bottom:4px">${st && st.configured ? 'AI Advisor settings' : 'Turn on your AI Advisor'}</h2>
      <p class="small muted" style="margin:0">Powered by Google Gemini. Ask questions about your money and get advice based on your real numbers.</p></div></div>
    ${st && st.configured ? '' : `<ol class="small" style="margin:14px 0 4px;padding-left:20px"><li>Open <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> and sign in with Google.</li>
      <li>Click <strong>Create API key</strong> and copy it (the free tier is plenty for personal use).</li><li>Paste it below — it's stored encrypted on your PC.</li></ol>`}
    <form class="form" id="aiKeyF" style="margin-top:12px">
      <label class="f"><span>Gemini API key ${st && st.configured ? '(saved — paste a new one to replace)' : ''}</span><input name="key" type="password" autocomplete="off" placeholder="${st && st.configured ? '••••••••••••' : 'AIza…'}"></label>
      <label class="f"><span>Model</span><div class="row"><select name="model" id="aiModel"><option value="${esc(st ? st.model : 'gemini-2.5-flash')}">${esc(st ? st.model : 'gemini-2.5-flash')}</option></select><button type="button" class="btn sm" id="aiLoadModels">Load models</button></div></label>
      ${compact ? '' : `<label class="f"><span>About me (optional — helps tailor advice)</span><textarea name="profile" rows="3" placeholder="e.g. 34, two kids, paid twice a month, want to buy a house in 2 years, moderate risk tolerance">${esc(st ? st.profile : '')}</textarea></label>`}
      <div class="row wrap"><button class="btn primary">Save</button><button type="button" class="btn" id="aiPeek">What Gemini sees</button>${st && st.configured ? '<button type="button" class="btn danger" id="aiRemove">Remove key</button>' : ''}</div>
      <p class="small muted" style="margin:0">Gemini gets a summary of your finances — balances, totals by category, bills, debts, goals — with every question. It never gets passwords, account numbers or bank logins.</p>
    </form></div>`;
}

function wireAiSetup(el, after) {
  $('#aiLoadModels', el).onclick = async e => {
    const key = $('input[name=key]', el).value.trim();
    const models = await run(e.target, () => api('/ai/models', { method: 'POST', body: { key: key || undefined } }));
    const sel = $('#aiModel', el), cur = sel.value;
    sel.innerHTML = models.map(m => `<option value="${esc(m.id)}" ${m.id === cur ? 'selected' : ''}>${esc(m.name)} (${esc(m.id)})</option>`).join('');
    if (!models.some(m => m.id === cur)) { const pref = models.find(m => /flash/.test(m.id) && !/lite|preview|exp/.test(m.id)) || models[0]; if (pref) sel.value = pref.id; }
    toast(`${models.length} models available`);
  };
  $('#aiKeyF', el).onsubmit = async e => {
    e.preventDefault(); const f = formData(e.target);
    await run(e.submitter, () => api('/ai/settings', { method: 'PUT', body: { key: f.key ? f.key : undefined, model: f.model, profile: f.profile } }), 'AI Advisor saved');
    after && after();
  };
  $('#aiPeek', el).onclick = async () => {
    const s = await api('/ai/snapshot');
    openDrawer(`<h2>What Gemini sees</h2><p class="small muted">This summary is sent along with each question. It's rebuilt from your latest data every time.</p><pre class="letter">${esc(s.text)}</pre>`);
  };
  if ($('#aiRemove', el)) $('#aiRemove', el).onclick = async () => { if (!confirm('Remove the Gemini API key?')) return; await api('/ai/settings', { method: 'PUT', body: { key: '' } }); toast('Key removed'); after && after(); };
}

VIEWS.advisor = async el => {
  const st = await api('/ai/status');
  if (!st.configured) { el.innerHTML = aiSetupHTML(st); wireAiSetup(el, route); return; }
  const hist = await api('/ai/history');
  el.innerHTML = `<div class="ai-wrap">
    <div class="ai-head"><div class="row" style="gap:12px"><div class="ai-orb sm">✨</div><div><strong>Money coach</strong><div class="small muted">Gemini · ${esc(st.model)}</div></div></div>
      <div class="row"><button class="btn sm" id="aiNew">New chat</button><button class="icon-btn" id="aiCfg" title="AI settings">⚙️</button></div></div>
    <div class="ai-chat" id="aiChat"></div>
    <form class="ai-input" id="aiForm"><textarea id="aiQ" rows="1" placeholder="Ask anything about your money…" maxlength="4000"></textarea><button class="btn primary" id="aiSend">Send</button></form>
    <div class="small muted" style="text-align:center;margin-top:6px">${AI_NOTE}</div></div>`;
  const chat = $('#aiChat', el);
  const bubble = (role, text, extra = '') => `<div class="msg ${role === 'user' ? 'me' : 'ai'}">${role === 'user' ? `<div class="b">${esc(text)}</div>` : `<div class="av">✨</div><div class="b md">${md(text)}${extra}</div>`}</div>`;
  const empty = () => `<div class="ai-empty"><div class="ai-orb lg">✨</div><h2>Hi! I've looked over your accounts.</h2><p class="muted">Ask me anything — I'll answer using your real balances, spending, bills and goals.</p>
    <div class="chips">${AI_SUGGESTIONS.map(([i, q]) => `<button class="chip" data-q="${esc(q)}">${i} ${esc(q)}</button>`).join('')}</div></div>`;
  chat.innerHTML = hist.length ? hist.map(m => bubble(m.role, m.text)).join('') : empty();
  const scroll = () => { chat.scrollTop = chat.scrollHeight; };
  scroll();
  const q = $('#aiQ', el);
  const grow = () => { q.style.height = 'auto'; q.style.height = Math.min(160, q.scrollHeight) + 'px'; };
  q.addEventListener('input', grow);
  q.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#aiForm', el).requestSubmit(); } });
  let busy = false;
  const send = async text => {
    if (busy || !text.trim()) return; busy = true;
    if ($('.ai-empty', chat)) chat.innerHTML = '';
    chat.insertAdjacentHTML('beforeend', bubble('user', text) + `<div class="msg ai" id="aiTyping"><div class="av">✨</div><div class="b"><span class="dots"><i></i><i></i><i></i></span></div></div>`);
    q.value = ''; grow(); scroll(); $('#aiSend', el).disabled = true;
    try {
      const r = await api('/ai/ask', { method: 'POST', body: { question: text } });
      $('#aiTyping', chat).outerHTML = bubble('model', r.answer);
    } catch (e) {
      $('#aiTyping', chat).outerHTML = `<div class="msg ai"><div class="av">⚠️</div><div class="b"><span class="neg">${esc(e.message)}</span></div></div>`;
    } finally { busy = false; $('#aiSend', el).disabled = false; scroll(); q.focus(); }
  };
  $('#aiForm', el).onsubmit = e => { e.preventDefault(); send(q.value); };
  chat.addEventListener('click', e => { const c = e.target.closest('[data-q]'); if (c) send(c.dataset.q); });
  $('#aiNew', el).onclick = async () => { await api('/ai/history', { method: 'DELETE' }); chat.innerHTML = empty(); };
  $('#aiCfg', el).onclick = () => openDrawer(aiSetupHTML(st), d => wireAiSetup(d, () => { closeDrawer(); route(); }));
};

// Dashboard card: today's AI insights (generated once a day, refreshable).
async function loadAiCard(slot) {
  if (!slot) return;
  let st; try { st = await api('/ai/status'); } catch { return; }
  if (!st.configured) {
    slot.innerHTML = `<a class="card ai-card" href="#/advisor"><div class="ai-orb">✨</div><div style="flex:1;min-width:0"><strong>Get personal money advice</strong><div class="small muted">Connect Google Gemini to your PocketFinance for tips based on your real numbers.</div></div><span class="btn sm">Set up</span></a>`;
    return;
  }
  const paint = (body, foot = '') => {
    slot.innerHTML = `<div class="card ai-card col"><div class="card-h" style="width:100%"><div class="row" style="gap:10px"><div class="ai-orb sm">✨</div><h2>Today's insights</h2></div>
      <div class="row"><button class="btn sm" id="aiRefresh" title="Generate new insights">↻</button><a class="tile-link" href="#/advisor">Ask a question ›</a></div></div><div class="md ai-insights">${body}</div>${foot}</div>`;
    $('#aiRefresh', slot).onclick = () => go(true);
  };
  const go = async force => {
    paint('<div class="row muted small"><span class="dots"><i></i><i></i><i></i></span> Gemini is reviewing your finances…</div>');
    try { const r = await api('/ai/insights', { method: 'POST', body: { refresh: !!force } }); paint(md(r.text), `<div class="small muted" style="margin-top:8px">${AI_NOTE}</div>`); }
    catch (e) { paint(`<p class="neg small">${esc(e.message)}</p>`); }
  };
  if (st.insights && st.insights.date === todayISO()) paint(md(st.insights.text), `<div class="small muted" style="margin-top:8px">${AI_NOTE}</div>`);
  else go(false);
}
