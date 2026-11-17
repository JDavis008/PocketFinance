/* "Connect your phone": the addresses a phone can use to reach this PC, with QR codes. */
'use strict';

async function connectCard(slot) {
  if (!slot) return;
  const c = await api('/connect-info');
  const s = await api('/settings').catch(() => ({}));
  const owner = !STATE.user || STATE.user.role === 'owner';
  const wifi = c.addresses.filter(a => !a.tailscale), ts = c.addresses.filter(a => a.tailscale);
  const addr = a => `<div class="conn-addr"><div class="qr">${a.qr}</div><div><div class="small muted">${a.tailscale ? 'Tailscale (works away from home)' : 'Home Wi-Fi'} · ${esc(a.name)}</div>
      <div class="conn-url">${esc(a.url)}</div><button type="button" class="btn sm" data-copy="${esc(a.url)}">Copy</button></div></div>`;
  slot.innerHTML = `<div class="card"><h2>📱 Connect your phone</h2>
    <ol class="small" style="padding-left:18px;margin:0 0 10px">
      <li>Install the PocketFinance app on your Android phone${s.app_share_url ? ` (<a href="${esc(s.app_share_url)}" target="_blank" rel="noopener">download link</a>)` : ' (Settings → Android app)'}.</li>
      <li>Open it and type the address below — or scan the code with the phone's camera to open PocketFinance in the browser.</li>
      <li>Sign in with your PocketFinance password.</li></ol>
    ${c.lanOpen ? `${wifi.length ? wifi.map(addr).join('') : '<p class="small muted">No Wi-Fi network found on this PC.</p>'}
        <p class="small muted" style="margin:6px 0 0">Your phone has to be on the same Wi-Fi. If Windows asks whether to allow <strong>PocketFinance Server</strong>, choose <strong>Private networks</strong>.</p>`
      : `<div class="banner" style="margin:0"><div style="font-size:24px">🔒</div><div class="grow"><strong>Right now only this PC can open PocketFinance.</strong><div class="small muted">Allow devices on your home Wi-Fi so your phone can connect. The password still protects everything.</div></div>
        ${owner ? '<button class="btn primary" id="allowWifi">Allow my Wi-Fi</button>' : ''}</div>`}
    ${c.lanOpen && ts.length ? ts.map(addr).join('') : ''}
    <p class="small muted" style="margin:10px 0 0">Away from home? Install the free <a href="https://tailscale.com/download" target="_blank" rel="noopener">Tailscale</a> app on this PC and the phone, sign in to both with the same account, and use the Tailscale address.</p></div>`;
  $$('[data-copy]', slot).forEach(b => b.onclick = () => navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Copied')));
  if ($('#allowWifi', slot)) $('#allowWifi', slot).onclick = async e => {
    await run(e.target, () => api('/settings', { method: 'PUT', body: { bind_host: '0.0.0.0' } }));
    toast('Restarting so your Wi-Fi can reach it…', 6000);
    // the server restarts on the new address; reload once it answers again
    const t0 = Date.now(); await new Promise(r => setTimeout(r, 2500));
    while (Date.now() - t0 < 30000) { try { const r = await fetch('/api/auth/status'); if (r.ok) break; } catch {} await new Promise(r => setTimeout(r, 1000)); }
    location.hash = '#/settings?connect=1'; location.reload();
  };
}
