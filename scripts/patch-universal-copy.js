const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pagesDir = path.join(ROOT, 'bento', 'pages');
const phobiasPath = path.join(ROOT, 'bento', 'phobias.json');
const phobias = JSON.parse(fs.readFileSync(phobiasPath, 'utf8'));

const NEW_RELIEF_START = 'By the end of your session you will feel your world shift.';

function afraidPhrase(fearShort, slug) {
  const s = String(fearShort || '').trim();
  if (/^fear of /i.test(s)) return 'afraid of ' + s.replace(/^fear of /i, '').trim();
  if (slug === 'my_fear') return 'afraid of it';
  if (!s) {
    return 'afraid of ' + String(slug || '').replace(/^fear-of-/, '').replace(/-/g, ' ');
  }
  return 'afraid of ' + s;
}

function newFootnote(fearShort, slug) {
  return (
    '"I can\'t remember ever being ' +
    afraidPhrase(fearShort, slug) +
    '" - the most common thing clients express after their session.'
  );
}

const bySlug = Object.fromEntries(phobias.map((p) => [p.slug, p]));
let bodyCount = 0;

for (const slug of fs.readdirSync(pagesDir)) {
  const bodyPath = path.join(pagesDir, slug, 'body.html');
  if (!fs.existsSync(bodyPath)) continue;
  let html = fs.readFileSync(bodyPath, 'utf8');
  const orig = html;
  const p = bySlug[slug] || (slug === 'my_fear' ? { fearShort: 'it', slug: 'my_fear' } : null);
  const fearShort =
    (p && p.fearShort) ||
    slug.replace(/^fear-of-/, '').replace(/-/g, ' ');
  const foot = newFootnote(fearShort, slug);

  html = html.replace(
    /<p class="footnote">[\s\S]*?<\/p>/,
    `<p class="footnote">${foot}</p>`
  );
  html = html.replace(/Many clients feel a shift the same day\./g, NEW_RELIEF_START);

  if (html !== orig) {
    fs.writeFileSync(bodyPath, html);
    bodyCount++;
    console.log('updated body', slug);
  }
}

for (const p of phobias) {
  if (typeof p.reliefP === 'string' && p.reliefP.includes('Many clients feel a shift the same day.')) {
    p.reliefP = p.reliefP.replace(/Many clients feel a shift the same day\./g, NEW_RELIEF_START);
  }
}
fs.writeFileSync(phobiasPath, JSON.stringify(phobias, null, 2) + '\n');
console.log('bodies updated:', bodyCount);
