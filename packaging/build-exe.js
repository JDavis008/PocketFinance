// Builds dist\PocketFinance-Server.exe: the server + web app + Android APK in one free Windows exe.
//   node packaging/build-exe.js
// Uses Node's single-executable-application feature: bundle with esbuild, embed files as SEA assets,
// stamp icon/version with rcedit, inject the blob into a copy of node.exe with postject.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const OUT = path.join(ROOT, 'dist', 'PocketFinance-Server.exe');
// npx needs a shell on Windows (it's a .cmd); real executables must not use one (paths with spaces)
const run = (cmd, args) => { const r = cp.spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: cmd === 'npx' && process.platform === 'win32' }); if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}${r.error ? ', ' + r.error.message : ''})`); };
const walk = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name)).split(path.sep).join('/')]);

fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });

// 1. one CommonJS file with the server and its dependencies (node: built-ins such as node:sqlite stay external)
run('npx', ['esbuild', 'packaging/sea-main.js', '--bundle', '--platform=node', '--target=node24', '--format=cjs', '--log-level=warning', `--outfile=${path.join(BUILD, 'sea-bundle.cjs')}`]);

// 2. files the server reads at run time, embedded as assets (extracted to the install folder)
const files = [
  ...walk(path.join(ROOT, 'public')).map(f => 'public/' + f),
  'node_modules/chart.js/dist/chart.umd.min.js',
  'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  'PocketFinance.ico',
];
if (fs.existsSync(path.join(ROOT, 'dist', 'PocketFinance.apk'))) files.push('dist/PocketFinance.apk');
const assets = Object.fromEntries(files.map(f => [f, path.join(ROOT, f)]));
fs.writeFileSync(path.join(BUILD, 'manifest.json'), JSON.stringify({ files, built: new Date().toISOString() }));
assets['manifest.json'] = path.join(BUILD, 'manifest.json');
fs.writeFileSync(path.join(BUILD, 'sea-config.json'), JSON.stringify({
  main: path.join(BUILD, 'sea-bundle.cjs'), output: path.join(BUILD, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, assets,
}, null, 2));
run(process.execPath, ['--experimental-sea-config', path.join(BUILD, 'sea-config.json')]);

// 3. a copy of this Node runtime, with our icon and name, then inject the app
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.copyFileSync(process.execPath, OUT);
const rcedit = path.join(ROOT, 'node_modules', 'rcedit', 'bin', process.arch === 'x64' ? 'rcedit-x64.exe' : 'rcedit.exe');
if (fs.existsSync(rcedit)) {
  run(rcedit, [OUT, '--set-icon', path.join(ROOT, 'PocketFinance.ico'), '--set-version-string', 'FileDescription', 'PocketFinance Server',
    '--set-version-string', 'ProductName', 'PocketFinance Server', '--set-version-string', 'CompanyName', 'PocketFinance', '--set-version-string', 'OriginalFilename', 'PocketFinance-Server.exe',
    '--set-version-string', 'InternalName', 'PocketFinance-Server', '--set-version-string', 'LegalCopyright', 'Free to use', '--set-file-version', '1.2.0', '--set-product-version', '1.2.0']);
} else console.warn('rcedit not found — the exe keeps the Node icon');
run('npx', ['postject', OUT, 'NODE_SEA_BLOB', path.join(BUILD, 'sea-prep.blob'), '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', '--overwrite']);

const mb = (fs.statSync(OUT).size / 1048576).toFixed(1);
console.log(`\nBuilt ${OUT} (${mb} MB, ${files.length} embedded files)`);
