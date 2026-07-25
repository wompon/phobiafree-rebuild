/**
 * Render legacy PHP site to static public/ for Cloudflare Assets.
 * Requires PHP CLI on PATH.
 *
 * Usage: node scripts/build-static.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const LEGACY = path.join(
  process.env.USERPROFILE || '',
  'Documents/phobiafree.life/public_html/phobiafree.life'
);
const PUBLIC = path.join(__dirname, '..', 'public');

const SKIP_PHP = new Set([
  'consult_handler.php', 'cursor_track.php', 'chat_handler.php', 'payment.php',
  'visitor_log.php', 'visitors.php', 'visitors.old.php', 'steven_status.php',
  'steven_live.php', 'set_status.php', 'install.php', 'migrate.php', 'migrate2.php',
  'server_test.php', 'pathtest.php', 'ordertest.php', 'section_order.php',
  'reorder.php', 'config.php', 'phobia-template.php', 'welcome_shared.php',
  'leave_message.php',
]);

const URL_PATCHES = [
  [/cursor_track\.php/g, '/track'],
  [/chat_handler\.php/g, '/api/chat'],
  [/steven_status\.php/g, '/api/chat/status'],
  [/consult_handler\.php\?action=get_slots/g, '/api/consult/slots'],
  [/consult_handler\.php/g, '/api/consult/book'],
  [/https:\/\/www\.phobiafree\.life/g, ''],
  [/https:\/\/phobiafree\.life/g, ''],
];

function rmrf(dir) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) rmrf(p);
    else fs.unlinkSync(p);
  }
}

function patchContent(html) {
  let s = html;
  for (const [re, rep] of URL_PATCHES) s = s.replace(re, rep);
  // welcome scene loads: /welcome-home.php → /welcome-home.html
  s = s.replace(/\/(welcome-[a-z-]+)\.php/g, '/$1.html');
  s = s.replace(/loadScene\('welcome-([^']+)'/g, "loadScene('welcome-$1'");
  // index.php SPA fetch URLs
  s = s.replace(/page \+ '\.php/g, "page + '.html");
  // internal page links
  s = s.replace(/href="\/([^"?#]+)\.php/g, 'href="/$1.html');
  s = s.replace(/href='\/([^'?#]+)\.php/g, "href='/$1.html");
  // GoDaddy/Cloudflare email-decode shim (not on Workers)
  s = s.replace(/<script[^>]*email-decode\.min\.js[^>]*><\/script>\s*/gi, '');
  return fixHtmlStructure(s);
}

/** PHP footer scripts sometimes render after </html> — tuck them back inside <body>. */
function fixHtmlStructure(html) {
  const closeIdx = html.lastIndexOf('</html>');
  if (closeIdx === -1) return html;
  const after = html.slice(closeIdx + 7).trim();
  if (!after) return html;
  const before = html.slice(0, closeIdx);
  const bodyClose = before.lastIndexOf('</body>');
  if (bodyClose === -1) return before + '\n' + after + '\n</html>';
  return before.slice(0, bodyClose) + '\n' + after + '\n' + before.slice(bodyClose) + '\n</html>';
}

function fixWelcomeCss() {
  const p = path.join(PUBLIC, 'welcome.css');
  if (!fs.existsSync(p)) return;
  let css = fs.readFileSync(p, 'utf8');
  // Legacy file was concatenated from PHP strings — unescape font names.
  css = css.replace(/\\'/g, "'");
  fs.writeFileSync(p, css);
}

function stripIndexBodyDuplicates(body) {
  return body
    .replace(/<meta name="viewport"[^>]*>\s*/i, '')
    .replace(/<link rel="stylesheet" href="\/welcome\.css">\s*/i, '')
    .replace(/<script src="\/welcome\.js"><\/script>\s*/i, '');
}

function renderPhp(phpPath) {
  const cwd = path.dirname(phpPath);
  const base = path.basename(phpPath);
  try {
  const out = execSync(`php -d display_errors=0 "${base}"`, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, QUERY_STRING: 'notrack=1' },
  });
  return patchContent(out);
  } catch (e) {
    console.warn('  SKIP (PHP error):', base, e.message?.slice(0, 120));
    return null;
  }
}

function copyDir(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, ent.name);
    const dest = path.join(destDir, ent.name);
    if (ent.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

function copyStatic() {
  const staticFiles = [
    'welcome.css', 'welcome.js', 'section_reorder_listener.js',
    'Officenaples.jpg',
  ];
  for (const f of staticFiles) {
    const src = path.join(LEGACY, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(PUBLIC, f));
      console.log('  asset:', f);
    }
  }
  copyDir(path.join(LEGACY, 'pdf-images'), path.join(PUBLIC, 'pdf-images'));
  if (fs.existsSync(path.join(PUBLIC, 'pdf-images'))) console.log('  asset: pdf-images/');
}

function buildIndex() {
  const indexPhp = path.join(LEGACY, 'index.php');
  const body = stripIndexBodyDuplicates(fs.readFileSync(indexPhp, 'utf8'));
  const html = patchContent(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PhobiaFree.life</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=DM+Sans:wght@300;400;500&family=Cinzel:wght@400;600&display=swap" rel="stylesheet"/>
  <link rel="stylesheet" href="/welcome.css">
  <script src="/welcome.js"></script>
</head>
<body>
${body}
</body>
</html>`);
  fs.writeFileSync(path.join(PUBLIC, 'index.html'), html);
}

function buildWelcomeScenes() {
  const files = fs.readdirSync(LEGACY).filter(f => f.startsWith('welcome-') && f.endsWith('.php'));
  for (const f of files) {
    const html = renderPhp(path.join(LEGACY, f));
    if (!html) continue;
    const out = f.replace(/\.php$/, '.html');
    fs.writeFileSync(path.join(PUBLIC, out), html);
    console.log('  welcome:', out);
  }
}

function buildPhobiaPages() {
  const files = fs.readdirSync(LEGACY).filter(f => f.endsWith('.php') && !SKIP_PHP.has(f) && !f.startsWith('welcome-'));
  for (const f of files) {
    const full = path.join(LEGACY, f);
    const src = fs.readFileSync(full, 'utf8');
    // Only render content pages (phobia data or full pages)
    const isPhobia = /\$phobia\s*=\s*\[/.test(src) && /phobia-template\.php/.test(src);
    const isStandalone = /<html/i.test(src) || /include\s+['"]includes\/head\.php/i.test(src);
    if (!isPhobia && !isStandalone) continue;

    const html = renderPhp(full);
    if (!html) continue;

    const outHtml = f.replace(/\.php$/, '.html');
    fs.writeFileSync(path.join(PUBLIC, outHtml), html);
    // Also write extensionless path via duplicate (worker can rewrite)
    console.log('  page:', outHtml);
  }
}

function buildPaymentPage() {
  const src = path.join(LEGACY, 'payment.php');
  if (!fs.existsSync(src)) return;
  const html = renderPhp(src);
  if (html) {
    fs.writeFileSync(path.join(PUBLIC, 'payment.html'), html);
    console.log('  page: payment.html');
  }
}

function buildAdminPages() {
  // visitors.html + visitor_log.html are built by build-admin-pages.js
  for (const f of ['consultation.php', 'terms.php', 'privacy.php']) {
    const full = path.join(LEGACY, f);
    if (!fs.existsSync(full)) continue;
    const html = renderPhp(full);
    if (!html) continue;
    fs.writeFileSync(path.join(PUBLIC, f.replace(/\.php$/, '.html')), html);
    console.log('  admin:', f.replace(/\.php$/, '.html'));
  }
}

if (!fs.existsSync(LEGACY)) {
  console.error('Legacy site not found:', LEGACY);
  process.exit(1);
}

console.log('Building static site from', LEGACY);
rmrf(PUBLIC);
fs.mkdirSync(PUBLIC, { recursive: true });

copyStatic();
fixWelcomeCss();
buildIndex();
buildWelcomeScenes();
buildPhobiaPages();
buildPaymentPage();
buildAdminPages();

// Admin SPA pages live outside the PHP render pipeline
try {
  execSync('node scripts/build-admin-pages.js', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
  });
} catch (e) {
  console.warn('  admin pages build skipped:', e.message?.slice(0, 80));
}

const count = fs.readdirSync(PUBLIC).length;
console.log(`\nDone — ${count} files in public/`);
