/**
 * Publish editable bento source into public/editor-src/ for the live editor.
 * Run: node scripts/publish-editor-src.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BENTO = path.join(ROOT, 'bento');
const OUT = path.join(ROOT, 'public', 'editor-src');

const COPY_KEYS = [
  'label',
  'title',
  'description',
  'heroTag',
  'heroH1',
  'heroP',
  'problemH2',
  'problemP',
  'quote',
  'externalH3',
  'externalP',
  'internalH3',
  'internalP',
  'deeperH3',
  'deeperP',
  'reliefP',
  'cost1H3',
  'cost1P',
  'cost2H3',
  'cost2P',
  'cost3H3',
  'cost3P',
  'ctaH2',
];

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFile(src, dest) {
  mkdirp(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  mkdirp(dest);
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function main() {
  if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
  mkdirp(OUT);

  copyFile(path.join(BENTO, 'template.html'), path.join(OUT, 'template.html'));
  copyFile(path.join(BENTO, 'body.template.html'), path.join(OUT, 'body.template.html'));
  copyFile(path.join(BENTO, 'styles.css'), path.join(OUT, 'styles.css'));
  if (fs.existsSync(path.join(BENTO, 'phobias.json'))) {
    copyFile(path.join(BENTO, 'phobias.json'), path.join(OUT, 'phobias.json'));
  }

  copyDir(path.join(BENTO, 'newincludes'), path.join(OUT, 'includes'));
  copyDir(path.join(BENTO, 'pages'), path.join(OUT, 'pages'));

  const phobias = JSON.parse(fs.readFileSync(path.join(BENTO, 'phobias.json'), 'utf8'));
  for (const p of phobias) {
    const copy = {};
    for (const k of COPY_KEYS) {
      if (p[k] != null) copy[k] = p[k];
    }
    copy.slug = p.slug;
    copy.image = p.image;
    copy.latin = p.latin;
    const dest = path.join(OUT, 'pages', p.slug, 'copy.json');
    mkdirp(path.dirname(dest));
    fs.writeFileSync(dest, JSON.stringify(copy, null, 2) + '\n');
  }

  const includes = fs.readdirSync(path.join(OUT, 'includes')).filter((f) => f.endsWith('.html'));
  const pages = fs
    .readdirSync(path.join(OUT, 'pages'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  fs.writeFileSync(
    path.join(OUT, 'manifest.json'),
    JSON.stringify(
      {
        includes: includes.map((f) => f.replace(/\.html$/, '')),
        pages,
        copyKeys: COPY_KEYS,
        publishedAt: new Date().toISOString(),
      },
      null,
      2
    ) + '\n'
  );

  console.log(
    `publish-editor-src: ${pages.length} pages, ${includes.length} includes → public/editor-src/`
  );
}

main();
