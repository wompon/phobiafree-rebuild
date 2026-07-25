/** One-shot: bake my_fear body.html from template + phobia grid. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const tpl = fs.readFileSync(path.join(ROOT, 'bento/body.template.html'), 'utf8');
const copy = JSON.parse(fs.readFileSync(path.join(ROOT, 'bento/pages/my_fear/copy.json'), 'utf8'));
const phobias = JSON.parse(fs.readFileSync(path.join(ROOT, 'bento/phobias.json'), 'utf8'));

const map = {
  HERO_TAG: copy.heroTag,
  HERO_H1: copy.heroH1,
  HERO_P: copy.heroP,
  PROBLEM_H2: copy.problemH2,
  PROBLEM_P: copy.problemP,
  QUOTE: copy.quote,
  EXTERNAL_H3: copy.externalH3,
  EXTERNAL_P: copy.externalP,
  INTERNAL_H3: copy.internalH3,
  INTERNAL_P: copy.internalP,
  DEEPER_H3: copy.deeperH3,
  DEEPER_P: copy.deeperP,
  RELIEF_P: copy.reliefP,
  COST1_H3: copy.cost1H3,
  COST1_P: copy.cost1P,
  COST2_H3: copy.cost2H3,
  COST2_P: copy.cost2P,
  COST3_H3: copy.cost3H3,
  COST3_P: copy.cost3P,
  CTA_H2: copy.ctaH2,
  LABEL: copy.label,
};

let body = tpl;
for (const [k, v] of Object.entries(map)) {
  body = body.split('{{' + k + '}}').join(v == null ? '' : String(v));
}

const links = phobias
  .map((p) => `          <a class="service-link" href="/${p.slug}"><span>${p.label}</span></a>`)
  .join('\n');

const picker = `
  <section class="section" id="fears">
    <h2 class="section-title">Which fear is yours?</h2>
    <p class="section-lead">Open the page for your phobia — or book a consultation and tell us in the form.</p>
    <div class="bento">
      <article class="tile span-12">
        <div class="services-grid">
${links}
        </div>
      </article>
    </div>
  </section>
`;

body = body.replace('</main>', picker + '\n</main>');
fs.writeFileSync(path.join(ROOT, 'bento/pages/my_fear/body.html'), body);
console.log('wrote bento/pages/my_fear/body.html');
