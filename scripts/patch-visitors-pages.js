const fs = require('fs');
const path = 'public/visitors.html';
let html = fs.readFileSync(path, 'utf8');
const phobias = require('../bento/phobias.json');

const urlLines = [];
const labelLines = [];
for (const p of phobias) {
  urlLines.push(`  '${p.slug}': '/${p.slug}?notrack=1',`);
  urlLines.push(`  '${p.latin}': '/${p.slug}?notrack=1',`);
  const label = p.label.replace(/'/g, "\\'");
  labelLines.push(`  '${p.slug}':'${label}',`);
  labelLines.push(`  '${p.latin}':'${label}',`);
}
urlLines.push(`  'my_fear': '/my_fear?notrack=1',`);
urlLines.push(`  'my-fear': '/my_fear?notrack=1',`);
labelLines.push(`  'my_fear':'My Fear',`);
labelLines.push(`  'my-fear':'My Fear',`);

const newUrls = `var PAGE_URLS = {
  'home':            '/index.html?notrack=1&nowelcome=1',
  'welcome':         '/index.html?notrack=1',
  'welcome-home':             '/welcome-home.html?notrack=1',
  'welcome-fear':             '/welcome-fear.html?notrack=1',
  'welcome-fear-selected':    '/welcome-fear-selected.html?notrack=1',
  'welcome-curious':          '/welcome-curious.html?notrack=1',
  'welcome-curious-selected': '/welcome-curious-selected.html?notrack=1',
  'welcome-why':              '/welcome-why.html?notrack=1',
  'welcome-why-selected':     '/welcome-why-selected.html?notrack=1',
  'welcome-friend':           '/welcome-friend.html?notrack=1',
${urlLines.join('\n')}
};
function getPageUrl(slug){
  if (PAGE_URLS[slug]) return PAGE_URLS[slug];
  if (slug && /^fear-of-/.test(slug)) return '/'+slug+'?notrack=1';
  if (slug === 'my_fear' || slug === 'my-fear') return '/my_fear?notrack=1';
  return PAGE_URLS['home'];
}`;

html = html.replace(
  /var PAGE_URLS = \{[\s\S]*?\};\s*function getPageUrl\(slug\)\{ return PAGE_URLS\[slug\]\|\|PAGE_URLS\['home'\]; \}/,
  newUrls
);

const newLabels = `var pageLabels = {
${labelLines.join('\n')}
  'home':'Home','welcome':'Welcome'
};`;

html = html.replace(/var pageLabels = \{[\s\S]*?\};/, newLabels);

fs.writeFileSync(path, html);
console.log('updated visitors.html PAGE_URLS + pageLabels');
