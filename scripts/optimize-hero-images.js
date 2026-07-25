/**
 * optimize-hero-images.js — convert every fear-page hero image in R2 to WebP.
 *
 * The hero photos live only in R2 (site-img/<slug>/img/<file>) and are large
 * PNGs (fear-of-flying was 1.6 MB). This downloads each, produces a resized WebP
 * (max 1600px wide, quality 80), and uploads it alongside the original as
 * <name>.webp. Live compose only emits a WebP <source> when that file exists in
 * R2 — a missing .webp must not be advertised, or Chrome leaves the hero blank.
 *
 * Re-run this any time you replace a hero image via /editor:
 *   node scripts/optimize-hero-images.js
 *
 * After a successful run, set hasWebp: true on each page.json (or re-upload is
 * enough — compose also HEADs R2). Upload clears hasWebp so PNG shows immediately.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const PAGES = path.join(ROOT, 'bento', 'pages');
const BUCKET = 'phobiafree-chat-files';
const MAX_WIDTH = 1600;
const QUALITY = 80;

function r2Get(key) {
  return execSync(`npx wrangler r2 object get "${BUCKET}/${key}" --remote --pipe`, {
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function r2Put(key, file) {
  execSync(
    `npx wrangler r2 object put "${BUCKET}/${key}" --file "${file}" --content-type "image/webp" --remote`,
    { stdio: 'pipe' }
  );
}

function kb(n) {
  return Math.round(n / 102.4) / 10 + ' KB';
}

async function main() {
  const slugs = fs
    .readdirSync(PAGES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((s) => fs.existsSync(path.join(PAGES, s, 'page.json')));

  let ok = 0, skip = 0, fail = 0, savedBytes = 0;

  for (const slug of slugs) {
    const meta = JSON.parse(fs.readFileSync(path.join(PAGES, slug, 'page.json'), 'utf8'));
    const photoUrl = meta.photoUrl || '';
    const m = photoUrl.match(/^\/([^/]+)\/img\/(.+)$/);
    if (!m) { console.log('  skip (no photoUrl):', slug); skip++; continue; }

    const urlSlug = m[1];
    const file = m[2];
    const base = file.replace(/\.[^.]+$/, '');
    const srcKey = `site-img/${urlSlug}/img/${file}`;
    const webpKey = `site-img/${urlSlug}/img/${base}.webp`;

    try {
      const src = r2Get(srcKey);
      if (!src || !src.length) { console.log('  skip (not in R2):', srcKey); skip++; continue; }

      const webp = await sharp(src)
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toBuffer();

      const tmp = path.join(os.tmpdir(), `${urlSlug}__${base}.webp`);
      fs.writeFileSync(tmp, webp);
      r2Put(webpKey, tmp);
      fs.unlinkSync(tmp);

      savedBytes += Math.max(0, src.length - webp.length);
      console.log(`  ${slug}: ${kb(src.length)} -> ${kb(webp.length)}  (${webpKey})`);
      ok++;
    } catch (e) {
      console.log('  FAIL:', slug, String(e).split('\n')[0]);
      fail++;
    }
  }

  console.log(`\ndone. converted=${ok} skipped=${skip} failed=${fail} saved~${kb(savedBytes)}`);
}

main();
