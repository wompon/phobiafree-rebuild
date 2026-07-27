const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PHOBIAS = JSON.parse(fs.readFileSync(path.join(ROOT, 'bento/phobias.json'), 'utf8'));
const tpl = fs.readFileSync(path.join(ROOT, 'bento/services.template.html'), 'utf8');

const html = PHOBIAS.map((p) => {
  const src = `/${p.slug}/img/${p.image}`;
  return [
    `      <a class="service-thumb" href="/${p.slug}">`,
    `        <span class="service-thumb-media">`,
    `          <img src="${src}" alt="" loading="lazy" decoding="async" width="360" height="450">`,
    `        </span>`,
    `        <span class="service-thumb-label">${p.label}</span>`,
    `      </a>`,
  ].join('\n');
}).join('\n');

fs.writeFileSync(path.join(ROOT, 'public/services.html'), tpl.replace('__SERVICES_HTML__', html));
console.log('wrote public/services.html with', PHOBIAS.length, 'thumbs');
