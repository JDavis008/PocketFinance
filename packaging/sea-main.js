// PocketFinance Server for Windows — one free .exe (Node single executable application).
//   PocketFinance-Server.exe              install or update (no admin), start it hidden, open the app
//   PocketFinance-Server.exe --serve      run the server (used by the hidden start-up loop)
//   PocketFinance-Server.exe --uninstall  remove it (asks whether to keep your data)
// Options for testing: --no-shortcuts --no-open --no-wait, env PF_INSTALL_DIR, PORT.
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

const VERSION = '1.2.0';
const NAME = 'PocketFinance';
const EXE = 'PocketFinance-Server.exe';
const INSTALL = process.env.PF_INSTALL_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), NAME);
const APPDIR = path.join(INSTALL, 'app');
const DATA = path.join(INSTALL, 'data');
const TARGET = path.join(INSTALL, EXE);
const VBS = path.join(INSTALL, 'run-hidden.vbs');
const PORT = Number(process.env.PORT || 48140);
const flags = new Set(process.argv.filter(a => a.startsWith('--')));

let sea = null;
try { const s = require('node:sea'); if (s.isSea()) sea = s; } catch {}

const say = (...a) => console.log(...a);
const ps = script => cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', windowsHide: true });
const psq = s => `'${String(s).replace(/'/g, "''")}'`; // PowerShell single-quoted string

// ---------------------------------------------------------------- serve
function serve() {
  process.env.PP_ROOT = process.env.PP_ROOT || APPDIR;
  process.env.PP_DATA = process.env.PP_DATA || DATA;
  process.env.PP_PACKAGED = '1';
  fs.mkdirSync(process.env.PP_DATA, { recursive: true });
  const app = require('../server/index.js');
  app.start();
}

// ---------------------------------------------------------------- helpers
function stopRunning() {
  // the hidden start-up loop (wscript running our .vbs) and any server process from the install folder
  ps(`Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'wscript.exe' -and $_.CommandLine -like ${psq('*' + VBS + '*')}) -or ($_.ExecutablePath -eq ${psq(TARGET)} -and $_.ProcessId -ne ${process.pid}) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`);
}
function extractAssets() {
  if (!sea) throw new Error('Run the packaged PocketFinance-Server.exe to install.');
  const manifest = JSON.parse(sea.getAsset('manifest.json', 'utf8'));
  fs.rmSync(APPDIR, { recursive: true, force: true }); // replace the old app files; data is kept
  for (const rel of manifest.files) {
    const out = path.join(APPDIR, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(sea.getRawAsset(rel)));
  }
  return manifest.files.length;
}
function writeLoop() {
  const log = path.join(DATA, 'server.log');
  const cmd = `cmd /c ""${TARGET}" --serve >> "${log}" 2>&1"`;
  fs.writeFileSync(VBS, [
    "' Keeps PocketFinance Server running with no window; restarts it 5 seconds after it stops.",
    'Set sh = CreateObject("WScript.Shell")',
    'Do',
    `  sh.Run "${cmd.replace(/"/g, '""')}", 0, True`,
    '  WScript.Sleep 5000',
    'Loop', ''].join('\r\n'));
}
function shortcuts() {
  const r = ps(`
$ws = New-Object -ComObject WScript.Shell
$startup = [Environment]::GetFolderPath('Startup'); $desk = [Environment]::GetFolderPath('Desktop'); $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'PocketFinance'
New-Item -ItemType Directory -Force -Path $menu | Out-Null
$l = $ws.CreateShortcut((Join-Path $startup 'PocketFinance Server.lnk')); $l.TargetPath = "$env:WINDIR\\System32\\wscript.exe"; $l.Arguments = '"' + ${psq(VBS)} + '"'; $l.WorkingDirectory = ${psq(INSTALL)}; $l.Description = 'Starts PocketFinance Server (hidden)'; $l.Save()
$ico = ${psq(path.join(APPDIR, 'PocketFinance.ico'))}
foreach ($p in @((Join-Path $desk 'PocketFinance.url'), (Join-Path $menu 'PocketFinance.url'))) { Set-Content -LiteralPath $p -Value "[InternetShortcut]\`r\`nURL=http://127.0.0.1:${PORT}/\`r\`nIconFile=$ico\`r\`nIconIndex=0" -Encoding ascii }
$key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PocketFinance'
New-Item -Path $key -Force | Out-Null
$vals = @{ DisplayName = 'PocketFinance Server'; DisplayVersion = ${psq(VERSION)}; Publisher = 'PocketFinance'; DisplayIcon = $ico; InstallLocation = ${psq(INSTALL)};
  UninstallString = '"' + ${psq(TARGET)} + '" --uninstall'; URLInfoAbout = 'http://127.0.0.1:${PORT}/' }
foreach ($k in $vals.Keys) { Set-ItemProperty -Path $key -Name $k -Value $vals[$k] }
Set-ItemProperty -Path $key -Name NoModify -Value 1 -Type DWord; Set-ItemProperty -Path $key -Name NoRepair -Value 1 -Type DWord
Set-ItemProperty -Path $key -Name EstimatedSize -Value ${Math.round(dirSize(INSTALL) / 1024)} -Type DWord
'ok'`);
  if (!/ok/.test(r.stdout || '')) throw new Error('Could not create shortcuts: ' + (r.stderr || r.stdout || '').trim().slice(0, 300));
}
function dirSize(p) { let n = 0; try { for (const e of fs.readdirSync(p, { withFileTypes: true })) n += e.isDirectory() ? dirSize(path.join(p, e.name)) : fs.statSync(path.join(p, e.name)).size; } catch {} return n; }
function removeShortcuts() {
  ps(`$ErrorActionPreference = 'SilentlyContinue'
Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Startup')) 'PocketFinance Server.lnk') -Force
Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Desktop')) 'PocketFinance.url') -Force
Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Programs')) 'PocketFinance') -Recurse -Force
Remove-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PocketFinance' -Recurse -Force`);
}
async function waitUp(ms = 40000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/auth/status`, { signal: AbortSignal.timeout(2000) }); if (r.ok) return true; } catch {}
    await new Promise(r => setTimeout(r, 700));
  }
  return false;
}
function pause(msg = 'Press Enter to close this window.') {
  if (flags.has('--no-wait') || !process.stdin.isTTY) return Promise.resolve();
  say(`\n${msg}`);
  return new Promise(res => { process.stdin.resume(); process.stdin.once('data', () => { process.stdin.pause(); res(); }); });
}
function ask(q) {
  if (flags.has('--no-wait') || !process.stdin.isTTY) return Promise.resolve('');
  process.stdout.write(q);
  return new Promise(res => { process.stdin.resume(); process.stdin.once('data', d => { process.stdin.pause(); res(String(d).trim()); }); });
}

// ---------------------------------------------------------------- install
async function install() {
  say(`\n  PocketFinance Server ${VERSION} — free, private, runs on this PC\n  ${'-'.repeat(52)}`);
  say(`  Installing to ${INSTALL}`);
  fs.mkdirSync(DATA, { recursive: true });
  const updating = fs.existsSync(TARGET);
  stopRunning();
  await new Promise(r => setTimeout(r, 1200));
  if (path.resolve(process.execPath).toLowerCase() !== path.resolve(TARGET).toLowerCase()) {
    for (let i = 0; i < 10; i++) { try { fs.copyFileSync(process.execPath, TARGET); break; } catch (e) { if (i === 9) throw e; await new Promise(r => setTimeout(r, 800)); } }
  }
  const n = extractAssets();
  writeLoop();
  if (!flags.has('--no-shortcuts')) shortcuts();
  say(`  ${updating ? 'Updated' : 'Installed'} (${n} files). Your data folder: ${DATA}`);
  cp.spawn('wscript.exe', [VBS], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  process.stdout.write('  Starting the server');
  const up = await waitUp();
  say(up ? ' ... running.\n' : ' ... it did not answer yet.\n');
  if (!up) {
    say(`  Something else may already be using port ${PORT}, or it is still starting.\n  The log is in ${path.join(DATA, 'server.log')}`);
  } else {
    say(`  Open it any time:  http://127.0.0.1:${PORT}   (desktop shortcut: PocketFinance)`);
    say('  It starts by itself, hidden, every time you sign in to Windows.');
    say('\n  Your phone: install the PocketFinance app, then in PocketFinance on this PC go to');
    say('  Settings → Connect your phone and type the address it shows into the app.');
    say('\n  Uninstall: Windows Settings → Apps → PocketFinance Server.');
    if (!flags.has('--no-open')) cp.spawn('cmd.exe', ['/c', 'start', '""', `http://127.0.0.1:${PORT}/`], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
  await pause();
}

// ---------------------------------------------------------------- uninstall
async function uninstall() {
  say(`\n  Uninstalling PocketFinance Server from ${INSTALL}`);
  stopRunning();
  if (!flags.has('--no-shortcuts')) removeShortcuts();
  const purge = flags.has('--purge') || /^y/i.test(await ask('  Also delete your PocketFinance data (accounts, transactions, receipts)? [y/N] '));
  await new Promise(r => setTimeout(r, 800));
  fs.rmSync(APPDIR, { recursive: true, force: true });
  try { fs.rmSync(VBS, { force: true }); } catch {}
  if (purge) fs.rmSync(DATA, { recursive: true, force: true });
  // the running exe can't delete itself; a short-lived cmd removes it (and the folder if empty) once we exit
  // verbatim arguments: cmd needs the inner quotes exactly as written (Node would otherwise escape them as \")
  cp.spawn('cmd.exe', ['/d', '/s', '/c', `"ping -n 4 127.0.0.1 >nul & del /f /q "${TARGET}" & rmdir "${INSTALL}" 2>nul"`],
    { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
  say(purge ? '  Removed, including your data.' : `  Removed. Your data is still in ${DATA} (delete it yourself if you don't need it).`);
  await pause();
}

// ---------------------------------------------------------------- main
(async () => {
  try {
    if (flags.has('--serve')) return serve();
    if (flags.has('--uninstall')) return await uninstall();
    await install();
  } catch (e) {
    console.error(`\n  Something went wrong: ${e.message}`);
    await pause();
    process.exit(1);
  }
})();
