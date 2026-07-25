/**
 * Load bento editor sources (R2 overrides on top of /editor-src Assets)
 * and compose live fear pages + CSS.
 */

const R2_PREFIX = 'editor/';

function fill(str, map) {
  let out = str;
  for (const [k, v] of Object.entries(map)) {
    out = out.split('{{' + k + '}}').join(v == null ? '' : String(v));
  }
  return out;
}

export const COPY_FIELDS = [
  { key: 'label', label: 'Label', rows: 1 },
  { key: 'title', label: 'SEO title', rows: 1 },
  { key: 'description', label: 'SEO description', rows: 2 },
  { key: 'heroTag', label: 'Hero tag (under brand)', rows: 1 },
  { key: 'heroH1', label: 'Hero headline', rows: 2 },
  { key: 'heroP', label: 'Hero supporting text', rows: 3 },
  { key: 'problemH2', label: 'Problem H2', rows: 1 },
  { key: 'problemP', label: 'Problem paragraph', rows: 4 },
  { key: 'quote', label: 'Quote', rows: 3 },
  { key: 'externalH3', label: 'External H3', rows: 1 },
  { key: 'externalP', label: 'External paragraph', rows: 3 },
  { key: 'internalH3', label: 'Internal H3', rows: 1 },
  { key: 'internalP', label: 'Internal paragraph', rows: 3 },
  { key: 'deeperH3', label: 'Deeper H3', rows: 1 },
  { key: 'deeperP', label: 'Deeper paragraph', rows: 3 },
  { key: 'reliefP', label: 'Relief / step 03', rows: 3 },
  { key: 'cost1H3', label: 'Cost 1 heading', rows: 1 },
  { key: 'cost1P', label: 'Cost 1 text', rows: 2 },
  { key: 'cost2H3', label: 'Cost 2 heading', rows: 1 },
  { key: 'cost2P', label: 'Cost 2 text', rows: 2 },
  { key: 'cost3H3', label: 'Cost 3 heading', rows: 1 },
  { key: 'cost3P', label: 'Cost 3 text', rows: 2 },
  { key: 'ctaH2', label: 'Final CTA heading', rows: 1 },
];

const BODY_TOKEN_MAP = {
  HERO_TAG: 'heroTag',
  HERO_H1: 'heroH1',
  HERO_P: 'heroP',
  PROBLEM_H2: 'problemH2',
  PROBLEM_P: 'problemP',
  QUOTE: 'quote',
  EXTERNAL_H3: 'externalH3',
  EXTERNAL_P: 'externalP',
  INTERNAL_H3: 'internalH3',
  INTERNAL_P: 'internalP',
  DEEPER_H3: 'deeperH3',
  DEEPER_P: 'deeperP',
  RELIEF_P: 'reliefP',
  COST1_H3: 'cost1H3',
  COST1_P: 'cost1P',
  COST2_H3: 'cost2H3',
  COST2_P: 'cost2P',
  COST3_H3: 'cost3H3',
  COST3_P: 'cost3P',
  CTA_H2: 'ctaH2',
  LABEL: 'label',
};

async function assetsGet(env, path) {
  if (!env.ASSETS) return null;
  const url = new URL(path.startsWith('/') ? path : '/' + path, 'https://phobiafree.life');
  const res = await env.ASSETS.fetch(new Request(url.toString()));
  if (res.status === 404) return null;
  return res;
}

export async function loadEditorText(env, relPath) {
  const clean = relPath.replace(/^\/+/, '');
  if (env.CHAT_FILES) {
    const obj = await env.CHAT_FILES.get(R2_PREFIX + clean);
    if (obj) return await obj.text();
  }
  const res = await assetsGet(env, '/editor-src/' + clean);
  if (!res) return null;
  return await res.text();
}

export async function loadEditorJson(env, relPath) {
  const text = await loadEditorText(env, relPath);
  if (text == null) return null;
  return JSON.parse(text);
}

export async function putEditorText(env, relPath, content, contentType = 'text/plain; charset=utf-8') {
  if (!env.CHAT_FILES) throw new Error('R2 not configured');
  const clean = relPath.replace(/^\/+/, '');
  await env.CHAT_FILES.put(R2_PREFIX + clean, content, {
    httpMetadata: { contentType },
  });
}

export async function hasEditorOverride(env, relPath) {
  if (!env.CHAT_FILES) return false;
  const head = await env.CHAT_FILES.head(R2_PREFIX + relPath.replace(/^\/+/, ''));
  return Boolean(head);
}

function markSelectedPhobia(modalHtml, selectedSlug) {
  let html = modalHtml.replace(/\sselected(?=\s|>)/g, '');
  if (!selectedSlug) {
    return html.replace(/(<option\s+value=""\s+data-slug="")/, '$1 selected');
  }
  const escaped = selectedSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(<option\\s+value="[^"]*"\\s+data-slug="' + escaped + '")', 'i');
  if (!re.test(html)) return modalHtml;
  return html.replace(re, '$1 selected');
}

export function bodyFromCopy(template, copy) {
  const map = {};
  for (const [token, key] of Object.entries(BODY_TOKEN_MAP)) {
    map[token] = copy[key] || '';
  }
  return fill(template, map);
}

export async function composeFearPage(env, slug) {
  const meta = await loadEditorJson(env, `pages/${slug}/page.json`);
  if (!meta) return null;
  let body = await loadEditorText(env, `pages/${slug}/body.html`);
  if (body == null) return null;

  let tpl = await loadEditorText(env, 'template.html');
  if (!tpl) return null;

  const includeNames = [...tpl.matchAll(/\{\{INCLUDE:([a-z0-9-]+)\}\}/gi)].map((m) => m[1]);
  const includes = {};
  for (const name of includeNames) {
    const html = await loadEditorText(env, `includes/${name}.html`);
    if (html == null) throw new Error('missing include: ' + name);
    includes[name] = html;
  }

  tpl = tpl.replace(/\{\{INCLUDE:([a-z0-9-]+)\}\}/gi, (_, name) => includes[name]);
  if (includes.modal) {
    const patched = markSelectedPhobia(includes.modal, meta.selectedPhobiaSlug || meta.slug);
    tpl = tpl.replace(includes.modal, patched);
  }

  const photoUrl = meta.photoUrl || `/${slug}/img/${meta.image || 'photo.png'}`;
  const versionQs = meta.photoVersion ? `?v=${meta.photoVersion}` : '';
  const photoUrlV = photoUrl + versionQs;
  // Only emit a WebP <source> when the file actually exists in R2. Chrome will
  // pick a missing .webp and leave the <img> broken (no PNG fallback).
  let webpSource = '';
  if (meta.hasWebp !== false && env.CHAT_FILES) {
    const webpPath = photoUrl.replace(/\.(png|jpe?g)$/i, '.webp');
    const wm = webpPath.match(/^\/([^/]+)\/img\/([^/?#]+)$/i);
    if (wm) {
      const head = await env.CHAT_FILES.head(`site-img/${wm[1]}/img/${wm[2]}`);
      if (head) {
        webpSource = `<source srcset="${webpPath}${versionQs}" type="image/webp">`;
      }
    }
  }

  const cssBase = meta.cssHref || '/' + (meta.assetDir || meta.slug) + '/styles.css';
  const cssVer = meta.colorsVersion || meta.photoVersion || '';
  const cssHref = cssVer ? `${cssBase}?v=${cssVer}` : cssBase;

  const html = fill(tpl, {
    TITLE: meta.title,
    DESCRIPTION: meta.description,
    CSS_HREF: cssHref,
    PAGE_COLOR_STYLE: pageColorStyleTag(meta.colors),
    PHOTO_URL: photoUrlV,
    PHOTO_WEBP_SOURCE: webpSource,
    BODY: body,
    PF_CURRENT_SLUG: meta.pfCurrentSlug || meta.slug,
    PF_SAME_PAGE_SLUGS: JSON.stringify(meta.pfSamePageSlugs || { [meta.slug]: true }),
  });

  return html;
}

const DEFAULT_PAGE_COLORS = {
  teal: '#0d5c63',
  tealBright: '#127a84',
  bg: '#e8eef3',
  sky: '#7eb8c9',
  gold: '#c9922a',
};

function sanitizeHex(v, fallback) {
  const s = String(v || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const r = s[1], g = s[2], b = s[3];
    return ('#' + r + r + g + g + b + b).toLowerCase();
  }
  return fallback;
}

/** Build :root override lines from page.json colors (or empty string). */
export function pageColorsRootCss(colors) {
  if (!colors || typeof colors !== 'object') return '';
  const teal = sanitizeHex(colors.teal, null);
  const tealBright = sanitizeHex(colors.tealBright, null);
  const bg = sanitizeHex(colors.bg, null);
  const sky = sanitizeHex(colors.sky, null);
  const gold = sanitizeHex(colors.gold, null);
  const lines = [];
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

/** Merge page.json colors into shared CSS as :root overrides. */
export function applyPageColors(css, colors) {
  const root = pageColorsRootCss(colors);
  if (!root) return css;
  return css + '\n/* per-page colors from editor */\n' + root + '\n';
}

export function pageColorStyleTag(colors) {
  const root = pageColorsRootCss(colors);
  if (!root) return '';
  const bg = sanitizeHex(colors?.bg, null);
  const theme = bg ? `\n<meta name="theme-color" content="${bg}">` : '';
  return `<style id="pf-page-colors">${root}</style>${theme}`;
}

export function normalizePageColors(colors) {
  const src = colors && typeof colors === 'object' ? colors : {};
  const out = {
    teal: sanitizeHex(src.teal, DEFAULT_PAGE_COLORS.teal),
    tealBright: sanitizeHex(src.tealBright, DEFAULT_PAGE_COLORS.tealBright),
    bg: sanitizeHex(src.bg, DEFAULT_PAGE_COLORS.bg),
    sky: sanitizeHex(src.sky, DEFAULT_PAGE_COLORS.sky),
    gold: sanitizeHex(src.gold, DEFAULT_PAGE_COLORS.gold),
  };
  const seed = sanitizeHex(src.seed, null);
  if (seed) out.seed = seed;
  return out;
}

export { DEFAULT_PAGE_COLORS };

export async function composePageCss(env, slug) {
  const meta = await loadEditorJson(env, `pages/${slug}/page.json`);
  if (!meta) return null;
  let css = await loadEditorText(env, 'styles.css');
  if (css == null) return null;
  const photoUrl = meta.photoUrl || `/${slug}/img/${meta.image || 'photo.png'}`;
  const versionQs = meta.photoVersion ? `?v=${meta.photoVersion}` : '';
  const photoUrlV = photoUrl + versionQs;
  css = css.replace(
    /url\(["']?[^"')]*hero-boarding\.png["']?\)|url\(["']?\/[^"')]+\/img\/[^"')]+["']?\)/,
    'url("' + photoUrlV + '")'
  );
  if (/\.page-photo\s*\{[^}]*background-image:\s*[^;]+;/.test(css)) {
    css = css.replace(
      /(\.page-photo\s*\{[^}]*background-image:\s*)[^;]+;/,
      '$1url("' + photoUrlV + '");'
    );
  }
  return applyPageColors(css, meta.colors);
}

export async function listEditorPages(env) {
  const manifest = await loadEditorJson(env, 'manifest.json');
  if (manifest?.pages?.length) return manifest.pages;
  // Fallback: known catalog from earlier deploy
  const phobias = await loadEditorJson(env, 'phobias.json');
  if (Array.isArray(phobias)) return phobias.map((p) => p.slug);
  return [];
}

export async function listIncludes(env) {
  const manifest = await loadEditorJson(env, 'manifest.json');
  if (manifest?.includes?.length) return manifest.includes;
  return ['head', 'page-photo', 'nav', 'footer', 'modal', 'consult-script', 'chat', 'tracker'];
}
