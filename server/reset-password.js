// Forgot the owner password and email isn't set up? On the PC that runs PocketFinance: npm run reset-password
// Sets a new owner password and signs everyone out (household members keep their own passwords).
const readline = require('readline');
const sec = require('./security');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(r => rl.question(q, r));
(async () => {
  if (!sec.isSetUp()) { console.log('PocketFinance has no password yet. Open it in your browser to create one.'); process.exit(0); }
  const pw = await ask('New owner password (8+ characters): ');
  const again = await ask('Type it again: ');
  rl.close();
  if (pw.length < 8) { console.log('Use at least 8 characters. Nothing changed.'); process.exit(1); }
  if (pw !== again) { console.log("They don't match. Nothing changed."); process.exit(1); }
  if (sec.passwordInUse(pw)) { console.log('A household member already uses that password. Pick a different one. Nothing changed.'); process.exit(1); }
  sec.setPassword(pw); sec.destroyAllSessions();
  console.log('Done. Sign in with the new password (phones that signed in automatically will ask once).');
  process.exit(0);
})();
