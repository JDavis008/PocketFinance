// Installs the built dist\PocketFinance-Server.exe into a throwaway folder, checks it serves the app, then uninstalls.
//   node packaging/build-exe.js && node test/install.js
// Uses --no-shortcuts so it never touches real Startup/Desktop shortcuts or the registry.
const os = require('os'), fs = require('fs'), path = require('path'), assert = require('assert'), cp = require('child_process');
const EXE = path.join(__dirname, '..', 'dist', 'PocketFinance-Server.exe');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-install-'));
const PORT = 48191;
const env = { ...process.env, PF_INSTALL_DIR: DIR, PORT: String(PORT) };
const base = `http://127.0.0.1:${PORT}`;

(async () => {
  let ok = 0; const check = (name, cond, extra) => { assert.ok(cond, name + (extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 400) : '')); ok++; console.log('  ✓', name); };
  check('exe was built', fs.existsSync(EXE));
  const inst = cp.spawnSync(EXE, ['--no-shortcuts', '--no-open', '--no-wait'], { env, encoding: 'utf8', timeout: 120000 });
  console.log(inst.stdout.split('\n').map(l => '    | ' + l).join('\n'));
  check('installer finished', inst.status === 0, inst.stderr);
  check('installed the exe', fs.existsSync(path.join(DIR, 'PocketFinance-Server.exe')));
  check('extracted the web app', fs.existsSync(path.join(DIR, 'app', 'public', 'index.html')) && fs.existsSync(path.join(DIR, 'app', 'node_modules', 'chart.js', 'dist', 'chart.umd.min.js')));
  check('bundled the Android app', fs.existsSync(path.join(DIR, 'app', 'dist', 'PocketFinance.apk')));
  check('wrote the hidden start-up loop', /--serve/.test(fs.readFileSync(path.join(DIR, 'run-hidden.vbs'), 'utf8')));
  check('server is running', /running/.test(inst.stdout));
  const st = await (await fetch(base + '/api/auth/status')).json();
  check('fresh install asks for a password', st.setup === false && st.authed === false);
  const html = await (await fetch(base + '/')).text();
  check('serves the PocketFinance page', /<title>PocketFinance<\/title>/.test(html));
  check('serves vendor files', (await fetch(base + '/vendor/chart.js')).ok && (await fetch(base + '/vendor/inter.woff2')).ok);
  const r = await fetch(base + '/api/auth/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PP': '1' }, body: JSON.stringify({ password: 'install-test-1' }) });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  check('can create a password', r.ok);
  const get = u => fetch(base + u, { headers: { cookie, 'X-PP': '1' } });
  const demo = await fetch(base + '/api/demo/load', { method: 'POST', headers: { cookie, 'X-PP': '1' } });
  check('demo data loads (database works)', demo.ok);
  check('dashboard works', (await (await get('/api/dashboard')).json()).accounts.netWorth > 0);
  const ci = await (await get('/api/connect-info')).json();
  check('connect info: packaged, local only by default', ci.packaged === true && ci.lanOpen === false && ci.port === PORT, ci);
  check('connect info has QR codes', ci.addresses.every(a => /<svg/.test(a.qr)));
  check('APK downloadable', (await get('/api/app.apk')).ok);
  check('data stored in the install folder', fs.existsSync(path.join(DIR, 'data', 'pocketpilot.db')));

  // the hidden loop restarts the server if it dies
  const pid = cp.spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${path.join(DIR, 'PocketFinance-Server.exe').replace(/'/g, "''")}' }).ProcessId`], { encoding: 'utf8' }).stdout.trim().split(/\s+/)[0];
  check('found the server process', /^\d+$/.test(pid), pid);
  process.kill(Number(pid));
  await new Promise(res => setTimeout(res, 2500));
  let back = false; for (let i = 0; i < 25 && !back; i++) { try { back = (await fetch(base + '/api/auth/status')).ok; } catch {} if (!back) await new Promise(res => setTimeout(res, 800)); }
  check('restarted after a crash', back);
  check('data survived the restart', (await (await get('/api/dashboard')).json()).accounts.netWorth > 0);

  // update in place keeps data
  const upd = cp.spawnSync(EXE, ['--no-shortcuts', '--no-open', '--no-wait'], { env, encoding: 'utf8', timeout: 120000 });
  check('re-running updates in place', upd.status === 0 && /Updated/.test(upd.stdout), upd.stdout);
  check('data kept after update', (await (await get('/api/dashboard')).json()).accounts.netWorth > 0);

  // uninstall (keep data), then purge
  const un = cp.spawnSync(path.join(DIR, 'PocketFinance-Server.exe'), ['--uninstall', '--no-shortcuts', '--no-wait'], { env, encoding: 'utf8', timeout: 60000 });
  check('uninstall ran', un.status === 0, un.stdout + un.stderr);
  await new Promise(res => setTimeout(res, 5000));
  let down = false; try { await fetch(base + '/api/auth/status', { signal: AbortSignal.timeout(2000) }); } catch { down = true; }
  check('server stopped', down);
  check('app files removed', !fs.existsSync(path.join(DIR, 'app')) && !fs.existsSync(path.join(DIR, 'PocketFinance-Server.exe')));
  check('data kept by default', fs.existsSync(path.join(DIR, 'data', 'pocketpilot.db')));
  fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${ok} installer checks passed`);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
