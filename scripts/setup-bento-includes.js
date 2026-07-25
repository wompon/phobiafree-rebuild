/**
 * One-time / refresh helper: split current public/fear-of-flying.html
 * into bento/newincludes + pages/fear-of-flying/{body,page.json} + template.
 * Run: node scripts/setup-bento-includes.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public/fear-of-flying.html'), 'utf8');
const INC = path.join(ROOT, 'bento/newincludes');
const PAGE = path.join(ROOT, 'bento/pages/fear-of-flying');

fs.mkdirSync(INC, { recursive: true });
fs.mkdirSync(PAGE, { recursive: true });

function sliceInclusive(src, startMarker, endMarkerAfter) {
  const i = src.indexOf(startMarker);
  if (i < 0) throw new Error('missing start: ' + startMarker);
  const j = src.indexOf(endMarkerAfter, i);
  if (j < 0) throw new Error('missing end after: ' + endMarkerAfter);
  return src.slice(i, j).trim();
}

const head = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="{{DESCRIPTION}}">
  <title>{{TITLE}}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,500&family=Sora:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="{{CSS_HREF}}">
  <style>.page-photo{background-image:url("{{PHOTO_URL}}");}</style>
  <script async src="https://www.googletagmanager.com/gtag/js?id=AW-18237377845"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'AW-18237377845');
    gtag('config', 'G-12NP1QWCDX');
  </script>
</head>
<body>
`;

fs.writeFileSync(path.join(INC, 'head.html'), head);
fs.writeFileSync(path.join(INC, 'page-photo.html'), '<div class="page-photo" aria-hidden="true"></div>\n');
fs.writeFileSync(path.join(INC, 'nav.html'), sliceInclusive(HTML, '<header class="nav"', '</header>') + '</header>\n');
fs.writeFileSync(path.join(INC, 'footer.html'), sliceInclusive(HTML, '<footer class="footer">', '</footer>') + '</footer>\n');

const modalStart = HTML.indexOf('<div class="modal-overlay"');
const scriptStart = HTML.indexOf('\n<script>', modalStart);
fs.writeFileSync(path.join(INC, 'modal.html'), HTML.slice(modalStart, scriptStart).trim() + '\n');

let script = HTML.slice(scriptStart, HTML.indexOf('</script>', scriptStart) + '</script>'.length).trim();
script = script.replace(/var PF_CURRENT_SLUG = '[^']*';/, "var PF_CURRENT_SLUG = '{{PF_CURRENT_SLUG}}';");
script = script.replace(
  /var PF_SAME_PAGE_SLUGS = \{[^}]*\};/,
  'var PF_SAME_PAGE_SLUGS = {{PF_SAME_PAGE_SLUGS}};'
);
fs.writeFileSync(path.join(INC, 'consult-script.html'), script + '\n');

const bodyMatch = HTML.match(/<section class="hero">[\s\S]*?<\/main>/);
if (!bodyMatch) throw new Error('body not found');
fs.writeFileSync(path.join(PAGE, 'body.html'), bodyMatch[0].trim() + '\n');

fs.writeFileSync(
  path.join(PAGE, 'page.json'),
  JSON.stringify(
    {
      slug: 'fear-of-flying',
      title: 'Fear of Flying — Fly Calm in One Session | PhobiaFree.life',
      description:
        'Overcome fear of flying in one peaceful Zoom session. No trance, no exposure, no long-term therapy. Certified clinical hypnotherapist.',
      cssHref: '/fear-of-flying/styles.css',
      photoUrl: '/fear-of-flying/img/hero-boarding.png',
      pfCurrentSlug: 'fear-of-flying',
      pfSamePageSlugs: { 'fear-of-flying': true, aerophobia: true },
      selectedPhobiaSlug: 'aerophobia',
      assetDir: 'fear-of-flying',
    },
    null,
    2
  ) + '\n'
);

fs.writeFileSync(
  path.join(ROOT, 'bento/template.html'),
  `{{INCLUDE:head}}
{{INCLUDE:page-photo}}
{{INCLUDE:nav}}

{{BODY}}

{{INCLUDE:footer}}

{{INCLUDE:modal}}

{{INCLUDE:consult-script}}

</body>
</html>
`
);

// Shared CSS source (photo overridden at build time / head style)
const cssSrc = path.join(ROOT, 'public/fear-of-flying/styles.css');
const cssDst = path.join(ROOT, 'bento/styles.css');
if (fs.existsSync(cssSrc)) fs.copyFileSync(cssSrc, cssDst);

console.log('setup-bento-includes: wrote newincludes + fear-of-flying page pack');
