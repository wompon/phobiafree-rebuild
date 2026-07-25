const fs = require('fs');
const path = require('path');
const DIR = 'C:\\Users\\steve\\phobia-pages';
const CHAT = 'https://phobiafree-chat.soyuzlaunch.workers.dev';
let scanned = 0, patched = 0;
for (const f of fs.readdirSync(DIR)) {
  if (!f.toLowerCase().endsWith('.html')) continue;
  scanned++;
  const p = path.join(DIR, f);
  const before = fs.readFileSync(p, 'utf8');
  let c = before;
  c = c.replace(/fetch\('chat_handler\.php\?vid='/g, "fetch('" + CHAT + "?vid='");
  c = c.replace(/fetch\('chat_handler\.php'/g, "fetch('" + CHAT + "'");
  c = c.replace(/fetch\('steven_status\.php'\)/g, "fetch('" + CHAT + "/status')");
  if (c !== before) { fs.writeFileSync(p, c, 'utf8'); patched++; console.log('  patched', f); }
}
console.log(`\nScanned ${scanned}, patched ${patched}.`);
