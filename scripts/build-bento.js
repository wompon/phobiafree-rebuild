/**
 * Build bento phobia pages from newincludes + pages/<slug>/.
 *
 * Usage: node scripts/build-bento.js
 *
 * Reads:
 *   bento/template.html
 *   bento/newincludes/*.html
 *   bento/pages/<slug>/page.json + body.html
 *   bento/styles.css
 *
 * Writes:
 *   public/<slug>.html
 *   public/<assetDir>/styles.css  (photo URL set for that page)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BENTO = path.join(ROOT, 'bento');
const INC = path.join(BENTO, 'newincludes');
const PAGES = path.join(BENTO, 'pages');
const PUBLIC = path.join(ROOT, 'public');

function fill(str, map) {
  let out = str;
  for (const [k, v] of Object.entries(map)) {
    out = out.split('{{' + k + '}}').join(v == null ? '' : String(v));
  }
  return out;
}

function loadInclude(name) {
  const p = path.join(INC, name + '.html');
  if (!fs.existsSync(p)) throw new Error('missing include: ' + name);
  return fs.readFileSync(p, 'utf8');
}

function applyIncludes(tpl) {
  return tpl.replace(/\{\{INCLUDE:([a-z0-9-]+)\}\}/gi, (_, name) => loadInclude(name));
}

/** Prefer selected option matching selectedPhobiaSlug; fall back to page value. */
function markSelectedPhobia(modalHtml, selectedSlug) {
  let html = modalHtml.replace(/\sselected(?=\s|>)/g, '');
  if (!selectedSlug) {
    return html.replace(/(<option\s+value=""\s+data-slug="")/, '$1 selected');
  }
  const re = new RegExp(
    '(<option\\s+value="[^"]*"\\s+data-slug="' + selectedSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '")',
    'i'
  );
  if (!re.test(html)) {
    console.warn('  warn: selectedPhobiaSlug not found in modal:', selectedSlug);
    return modalHtml;
  }
  return html.replace(re, '$1 selected');
}

function buildPage(slug) {
  const dir = path.join(PAGES, slug);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'page.json'), 'utf8'));
  const body = fs.readFileSync(path.join(dir, 'body.html'), 'utf8');

  let tpl = fs.readFileSync(path.join(BENTO, 'template.html'), 'utf8');
  tpl = applyIncludes(tpl);

  // Patch modal selected option before final token fill
  const modalMarker = loadInclude('modal');
  const patchedModal = markSelectedPhobia(modalMarker, meta.selectedPhobiaSlug || '');
  tpl = tpl.replace(modalMarker, patchedModal);

  const photoUrl = meta.photoUrl || '';
  const webpUrl = photoUrl.replace(/\.(png|jpe?g)$/i, '.webp');
  const webpDisk = webpUrl ? path.join(PUBLIC, webpUrl.replace(/^\//, '')) : '';
  const webpSource =
    webpDisk && fs.existsSync(webpDisk)
      ? `<source srcset="${webpUrl}" type="image/webp">`
      : '';
  const colorStyle = pageColorStyleTag(meta.colors);

  const html = fill(tpl, {
    TITLE: meta.title,
    DESCRIPTION: meta.description,
    CSS_HREF: meta.cssHref || '/' + (meta.assetDir || meta.slug) + '/styles.css',
    PAGE_COLOR_STYLE: colorStyle,
    PHOTO_URL: photoUrl,
    PHOTO_WEBP_SOURCE: webpSource,
    BODY: body,
    PF_CURRENT_SLUG: meta.pfCurrentSlug || meta.slug,
    PF_SAME_PAGE_SLUGS: JSON.stringify(meta.pfSamePageSlugs || { [meta.slug]: true }),
  });

  if (/\{\{[A-Z0-9_]+\}\}/.test(html)) {
    const left = html.match(/\{\{[A-Z0-9_]+\}\}/g);
    throw new Error(slug + ' still has tokens: ' + [...new Set(left)].join(', '));
  }

  const outHtml = path.join(PUBLIC, meta.slug + '.html');
  fs.writeFileSync(outHtml, html);
  console.log('  wrote', path.relative(ROOT, outHtml));

  // CSS: shared file with photo URL for this page
  const assetDir = meta.assetDir || meta.slug;
  const cssOutDir = path.join(PUBLIC, assetDir);
  fs.mkdirSync(cssOutDir, { recursive: true });
  let css = fs.readFileSync(path.join(BENTO, 'styles.css'), 'utf8');
  // Normalize any existing hero url then set page photo
  css = css.replace(
    /url\(["']?[^"')]*hero-boarding\.png["']?\)|url\(["']?\/[^"')]+\/img\/[^"')]+["']?\)/,
    'url("' + meta.photoUrl + '")'
  );
  // Prefer explicit background-image on .page-photo
  if (/\.page-photo\s*\{[^}]*background-image:\s*[^;]+;/.test(css)) {
    css = css.replace(
      /(\.page-photo\s*\{[^}]*background-image:\s*)[^;]+;/,
      '$1url("' + meta.photoUrl + '");'
    );
  }
  css = applyPageColors(css, meta.colors);
  fs.writeFileSync(path.join(cssOutDir, 'styles.css'), css);
  console.log('  wrote', path.relative(ROOT, path.join(cssOutDir, 'styles.css')));
}

function sanitizeHex(v) {
  const s = String(v || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  return null;
}

function pageColorsRootCss(colors) {
  if (!colors || typeof colors !== 'object') return '';
  const lines = [];
  const teal = sanitizeHex(colors.teal);
  const tealBright = sanitizeHex(colors.tealBright);
  const bg = sanitizeHex(colors.bg);
  const sky = sanitizeHex(colors.sky);
  const gold = sanitizeHex(colors.gold);
  if (teal) lines.push(`  --teal: ${teal};`);
  if (tealBright) lines.push(`  --teal-bright: ${tealBright};`);
  if (bg) {
    lines.push(`  --bg: ${bg};`);
    lines.push(`  --bg-deep: ${bg};`);
  }
  if (sky) lines.push(`  --sky: ${sky};`);
  if (gold) lines.push(`  --gold: ${gold};`);
  if (!lines.length) return '';
  return `:root {\n${lines.join('\n')}\n}`;
}

function applyPageColors(css, colors) {
  const root = pageColorsRootCss(colors);
  if (!root) return css;
  return css + '\n/* per-page colors from editor */\n' + root + '\n';
}

function pageColorStyleTag(colors) {
  const root = pageColorsRootCss(colors);
  if (!root) return '';
  const bg = sanitizeHex(colors?.bg);
  const theme = bg ? `\n<meta name="theme-color" content="${bg}">` : '';
  return `<style id="pf-page-colors">${root}</style>${theme}`;
}

function main() {
  const slugs = fs
    .readdirSync(PAGES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => fs.existsSync(path.join(PAGES, name, 'page.json')));

  if (!slugs.length) {
    console.error('No pages found under bento/pages/');
    process.exit(1);
  }

  console.log('build-bento:', slugs.join(', '));
  for (const slug of slugs) buildPage(slug);
  console.log('done');
}

main();
