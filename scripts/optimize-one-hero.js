/**
 * Optimize a single hero image in R2 to WebP.
 * Usage: node scripts/optimize-one-hero.js fear-of-roaches
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const BUCKET = 'phobiafree-chat-files';
const slug = process.argv[2];
if (!slug) {
  console.error('Usage: node scripts/optimize-one-hero.js <slug>');
  process.exit(1);
}

const meta = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'bento', 'pages', slug, 'page.json'), 'utf8')
);
const photoUrl = meta.photoUrl || '';
const m = photoUrl.match(/^\/([^/]+)\/img\/(.+)$/);
if (!m) {
  console.error('No photoUrl on page');
  process.exit(1);
}

const urlSlug = m[1];
const file = m[2];
const base = file.replace(/\.[^.]+$/, '');
const srcKey = `site-img/${urlSlug}/img/${file}`;
const webpKey = `site-img/${urlSlug}/img/${base}.webp`;
const tmpSrc = path.join(os.tmpdir(), `${urlSlug}__src`);
const tmpWebp = path.join(os.tmpdir(), `${urlSlug}__${base}.webp`);

async function main() {
  execSync(`npx wrangler r2 object get "${BUCKET}/${srcKey}" --remote --file "${tmpSrc}"`, {
    stdio: 'inherit',
  });
  const src = fs.readFileSync(tmpSrc);
  const webp = await sharp(src)
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  fs.writeFileSync(tmpWebp, webp);
  execSync(
    `npx wrangler r2 object put "${BUCKET}/${webpKey}" --file "${tmpWebp}" --content-type "image/webp" --remote`,
    { stdio: 'inherit' }
  );
  fs.unlinkSync(tmpSrc);
  fs.unlinkSync(tmpWebp);
  console.log(`ok: ${src.length} -> ${webp.length} bytes (${webpKey})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
