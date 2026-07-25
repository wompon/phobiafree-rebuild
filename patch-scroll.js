const fs = require('fs');
const path = require('path');
const DIR = 'C:\\Users\\steve\\phobia-pages';
let scanned = 0, patched = 0;
for (const f of fs.readdirSync(DIR)) {
  if (!f.toLowerCase().endsWith('.html')) continue;
  scanned++;
  const p = path.join(DIR, f);
  const before = fs.readFileSync(p, 'utf8');
  let c = before;
  c = c.replace(/window\.scrollY\s*\/\s*scrollH/g, 'document.documentElement.scrollTop / scrollH');
  c = c.replace(/scrollY:\s*window\.scrollY/g, 'scrollY: document.documentElement.scrollTop');
  if (c !== before) { fs.writeFileSync(p, c, 'utf8'); patched++; console.log('  patched', f); }
}
console.log(`\nScanned ${scanned} html files, patched ${patched}.`);
if (patched === 0) console.log('Nothing matched — paste me the result.');
