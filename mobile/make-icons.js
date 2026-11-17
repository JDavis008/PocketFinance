// Renders the PocketFinance logo into Android launcher icons (legacy + adaptive) with sharp.
const fs = require('fs'), path = require('path'), sharp = require('sharp');
const full = fs.readFileSync(path.join(__dirname, '..', 'public', 'icon.svg'));
fs.copyFileSync(path.join(__dirname, '..', 'public', 'icon.svg'), path.join(__dirname, 'www', 'icon.svg'));
// adaptive foreground: the logo artwork (coin, pocket, arrow) inside the 66% safe zone, on transparent
const art = full.toString().slice(full.toString().indexOf("<g id=\"art\">"), full.toString().lastIndexOf("</g>") + 4);
const fg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108"><g transform="translate(15.6 13.7) scale(1.2)">${art}</g></svg>`);
const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6d4aff"/><stop offset=".55" stop-color="#4f46e5"/><stop offset="1" stop-color="#0ea5a4"/></linearGradient></defs><rect width="108" height="108" fill="url(#g)"/></svg>`);
const res = path.join(__dirname, 'android', 'app', 'src', 'main', 'res');
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
(async () => {
  if (!fs.existsSync(res)) { console.log('android/ not created yet, skipping icons'); return; }
  for (const [d, s] of Object.entries(dens)) {
    const dir = path.join(res, `mipmap-${d}`); fs.mkdirSync(dir, { recursive: true });
    const legacy = Math.round(48 * s), adaptive = Math.round(108 * s);
    await sharp(full, { density: 600 }).resize(legacy, legacy).png().toFile(path.join(dir, 'ic_launcher.png'));
    const r = Math.round(legacy / 2);
    const mask = Buffer.from(`<svg width="${legacy}" height="${legacy}"><circle cx="${r}" cy="${r}" r="${r}"/></svg>`);
    await sharp(full, { density: 600 }).resize(legacy, legacy).composite([{ input: mask, blend: 'dest-in' }]).png().toFile(path.join(dir, 'ic_launcher_round.png'));
    await sharp(fg, { density: 600 }).resize(adaptive, adaptive).png().toFile(path.join(dir, 'ic_launcher_foreground.png'));
    await sharp(bg, { density: 600 }).resize(adaptive, adaptive).png().toFile(path.join(dir, 'ic_launcher_background.png'));
  }
  // adaptive icon uses the gradient image as background
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n  <background android:drawable="@mipmap/ic_launcher_background"/>\n  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n`;
  const any = path.join(res, 'mipmap-anydpi-v26'); fs.mkdirSync(any, { recursive: true });
  fs.writeFileSync(path.join(any, 'ic_launcher.xml'), xml); fs.writeFileSync(path.join(any, 'ic_launcher_round.xml'), xml);
  console.log('icons written');
})();
