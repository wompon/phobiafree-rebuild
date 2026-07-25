/**
 * build-phobia-pages.js
 *
 * Generates static HTML pages (one per phobia) from:
 *   - the per-phobia PHP data files (e.g. aerophobia.php — each defines a $phobia array)
 *   - phobia-template.php (the shared HTML structure)
 *   - the includes/ folder (head, nav, modal, chat, tracker, footer, phobia_map)
 *
 * WHY THIS EXISTS
 * The old site rendered these pages in PHP at request time. On Cloudflare Pages
 * there's no PHP — but these pages have NO per-request logic (they're pure
 * content), so we can render them ONCE at build time into plain .html files and
 * serve them as static assets. Fast, free, and no server needed.
 *
 * HOW IT WORKS
 * PHP arrays aren't directly readable by Node, so this script uses a tiny bit of
 * parsing to pull the key/value content out of each $phobia = [...] block, then
 * substitutes them into a JS port of the template. The template port lives in
 * template.js (you generate it once from phobia-template.php — see STEP 2 below).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SETUP STEPS
 *
 * STEP 1 — Upload the includes/ folder
 *   The template depends on these files which weren't in the original upload:
 *     includes/head.php, nav.php, phobia_map.php, modal.php, chat.php,
 *     tracker.php, footer.php, and section_order_init.php
 *   Drop them into ./php-source/includes/ so this script can read them.
 *
 * STEP 2 — Provide the template as JS
 *   Because the PHP template mixes <?php echo ?> into HTML, the cleanest path is
 *   to convert phobia-template.php into a JS template literal ONCE. This script
 *   will attempt an automatic conversion (see convertPhpTemplate below); review
 *   the output in ./generated/template.html before trusting it.
 *
 * STEP 3 — Run
 *   node build-phobia-pages.js
 *   Output lands in ./dist/<slug>.html — copy that folder into your Pages project.
 * ─────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'php-source');         // put the .php files here
const INCLUDES_DIR = path.join(SRC_DIR, 'includes');
const OUT_DIR = path.join(__dirname, 'dist');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ── Identify phobia data files ────────────────────────────────────────────
// A phobia data file is one that defines `$phobia = [` and includes the template.
// We skip the template itself, includes, handlers, and admin files.
function isPhobiaDataFile(filename, contents) {
  if (!filename.endsWith('.php')) return false;
  if (filename === 'phobia-template.php') return false;
  return /\$phobia\s*=\s*\[/.test(contents) && /include\s+'phobia-template\.php'/.test(contents);
}

// ── Parse a $phobia = [ ... ]; block into a JS object ─────────────────────
// Handles the shapes used in these files: 'key' => 'string', 'key' => "string",
// and 'key' => [ ['k'=>'v', ...], ... ] arrays of associative arrays.
// This is intentionally tailored to the actual files rather than a full PHP
// parser — review output for any page that uses an unusual structure.
function parsePhobiaArray(php) {
  const start = php.indexOf('$phobia');
  const open = php.indexOf('[', start);
  // find matching close bracket
  let depth = 0, i = open, end = -1;
  for (; i < php.length; i++) {
    if (php[i] === '[') depth++;
    else if (php[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = php.slice(open, end + 1);

  // Convert PHP array syntax to JSON-ish, then eval safely-ish.
  // PHP => becomes :, single quotes handled, trailing commas tolerated.
  // We do a careful transform rather than raw eval of arbitrary code.
  let js = body
    .replace(/=>/g, ':')
    .replace(/\barray\s*\(/g, '[')        // in case any array() syntax is used
    ;

  // PHP allows trailing commas in arrays (so does JS), and uses [] already here.
  // Single-quoted strings: convert to double-quoted with proper escaping.
  js = convertPhpStringsToJson(js);

  // Now it should be valid JSON5-ish; use Function to evaluate as a JS literal.
  // Inputs are your own content files, not user input.
  try {
    // eslint-disable-next-line no-new-func
    return Function('"use strict"; return (' + js + ');')();
  } catch (err) {
    throw new Error('Failed to parse $phobia array: ' + err.message + '\n--- transformed ---\n' + js.slice(0, 500));
  }
}

// Convert PHP single/double quoted strings into valid JSON double-quoted strings.
function convertPhpStringsToJson(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let str = '';
      i++;
      while (i < s.length) {
        const c = s[i];
        if (c === '\\') { str += c + s[i + 1]; i += 2; continue; }
        if (c === quote) { i++; break; }
        str += c;
        i++;
      }
      // Re-emit as a JSON string: escape double quotes and backslashes and newlines
      const escaped = str
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '');
      out += '"' + escaped + '"';
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

// ── Convert phobia-template.php into an HTML string with {{placeholders}} ──
// Replaces <?php echo $phobia['key']; ?> with {{key}}, handles the foreach
// blocks for problem_cards / failure_cards / success_cards / faq_extra, and
// inlines the includes. Output is reviewed by you before going live.
function buildTemplate() {
  const tplPath = path.join(SRC_DIR, 'phobia-template.php');
  if (!fs.existsSync(tplPath)) {
    throw new Error('phobia-template.php not found in ' + SRC_DIR);
  }
  let tpl = fs.readFileSync(tplPath, 'utf8');

  // Inline includes (read each include file's rendered HTML).
  // For includes that are pure HTML/CSS (head, nav, footer, modal, chat, tracker)
  // we inline them directly. phobia_map.php and section_order_init.php are logic;
  // we handle the one value we need (phobia label) separately.
  tpl = inlineIncludes(tpl);

  // Replace simple echoes: <?php echo $phobia['key']; ?>  ->  {{key}}
  tpl = tpl.replace(/<\?php\s+echo\s+\$phobia\['([a-z_]+)'\];\s*\?>/g, '{{$1}}');

  // Replace the page-level vars set at top of template
  tpl = tpl
    .replace(/<\?php\s+echo\s+\$page_title;\s*\?>/g, '{{title}}')
    .replace(/<\?php\s+echo\s+\$page_description;\s*\?>/g, '{{meta}}')
    .replace(/<\?php\s+echo\s+\$page_slug;\s*\?>/g, '{{slug}}')
    .replace(/<\?php\s+echo\s+\$page_phobia;\s*\?>/g, '{{phobia_label}}');

  // NOTE: foreach card loops are handled at render time by renderCards(), so we
  // leave a marker the renderer can find. We detect the three known grids.
  // (If the template's loop markup changes, update these markers.)

  return tpl;
}

function inlineIncludes(tpl) {
  const includeFiles = {
    "includes/head.php": true,
    "includes/nav.php": true,
    "includes/modal.php": true,
    "includes/chat.php": true,
    "includes/tracker.php": true,
    "includes/footer.php": true,
  };
  // Replace each `include 'includes/x.php';` (inside <?php ?>) with file contents.
  tpl = tpl.replace(/<\?php[\s\S]*?\?>/g, (block) => {
    let replaced = block;
    for (const inc of Object.keys(includeFiles)) {
      if (block.includes(inc)) {
        const incPath = path.join(SRC_DIR, inc);
        if (fs.existsSync(incPath)) {
          let incHtml = fs.readFileSync(incPath, 'utf8');
          // strip the include's own <?php ?> logic blocks for static output
          incHtml = incHtml.replace(/<\?php[\s\S]*?\?>/g, '');
          return incHtml; // replaces the whole php block with the include's HTML
        } else {
          return `<!-- MISSING INCLUDE: ${inc} — upload it to ${INCLUDES_DIR} -->`;
        }
      }
    }
    return replaced;
  });
  return tpl;
}

// ── Render card loops for one phobia ──────────────────────────────────────
function renderProblemCards(cards) {
  return cards.map(c => `
    <div class="problem-card">
      <div class="problem-icon">${c.icon || ''}</div>
      <h3>${c.h || ''}</h3>
      <p>${c.p || ''}</p>
    </div>`).join('\n');
}
function renderSuccessCards(cards) {
  return cards.map(c => `
    <div class="success-card">
      <div class="success-icon">${c.icon || ''}</div>
      <h3>${c.h || ''}</h3>
      <p>${c.p || ''}</p>
    </div>`).join('\n');
}
function renderFailureCards(cards) {
  return cards.map(c => `
    <div class="failure-card">
      <h3>${c.h || ''}</h3>
      <p>${c.p || ''}</p>
    </div>`).join('\n');
}
function renderFaq(items) {
  return items.map(f => `
    <div class="faq-item">
      <div class="faq-q">${f.q || ''}</div>
      <div class="faq-a">${f.a || ''}</div>
    </div>`).join('\n');
}

// ── Fill the template for one phobia ──────────────────────────────────────
function renderPage(template, phobia) {
  let html = template;

  // Card grids — replace the template's foreach output regions.
  // The simplest robust approach: regex out the original PHP foreach blocks
  // (already turned to leftover markup by buildTemplate) and inject rendered HTML.
  // Here we assume buildTemplate left the surrounding grid containers intact and
  // we replace their inner content by class name.
  html = injectGrid(html, 'problem-grid', renderProblemCards(phobia.problem_cards || []));
  html = injectGrid(html, 'success-grid', renderSuccessCards(phobia.success_cards || []));
  html = injectGrid(html, 'failure-grid', renderFailureCards(phobia.failure_cards || []));
  html = injectGrid(html, 'faq-list', renderFaq(phobia.faq_extra || []));

  // Simple scalar placeholders
  const scalars = ['title','meta','slug','headline','hero_sub','aspirational',
    'problem_headline','problem_sub','empathy_quote','step3_action','cta_headline'];
  for (const key of scalars) {
    const val = phobia[key] != null ? phobia[key] : '';
    html = html.split('{{' + key + '}}').join(val);
  }
  // phobia_label: derive from slug if no map available
  const label = phobia.phobia_label || prettifySlug(phobia.slug);
  html = html.split('{{phobia_label}}').join(label);

  // Any remaining unfilled placeholders -> empty (and log)
  const leftover = [...html.matchAll(/\{\{([a-z_]+)\}\}/g)].map(m => m[1]);
  if (leftover.length) {
    console.warn(`  ⚠ ${phobia.slug}: unfilled placeholders: ${[...new Set(leftover)].join(', ')}`);
    html = html.replace(/\{\{[a-z_]+\}\}/g, '');
  }
  return html;
}

// Replace inner HTML of <div class="NAME"> ... </div> with provided content.
// Tailored to the template's grid containers.
function injectGrid(html, className, inner) {
  const re = new RegExp(`(<div class="${className}">)([\\s\\S]*?)(</div>\\s*</section>)`);
  if (re.test(html)) {
    return html.replace(re, `$1\n${inner}\n$3`);
  }
  return html; // grid not found — leave untouched, warn in caller if needed
}

function prettifySlug(slug) {
  return (slug || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Main ──────────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`Source folder not found: ${SRC_DIR}`);
    console.error(`Create it and put the .php files (plus includes/) inside, then re-run.`);
    process.exit(1);
  }

  const template = buildTemplate();

  // Save the assembled template for your review
  fs.writeFileSync(path.join(OUT_DIR, '_template_preview.html'), template, 'utf8');
  console.log(`Template assembled → dist/_template_preview.html (review this).`);

  const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.php'));
  let count = 0;
  for (const file of files) {
    const full = path.join(SRC_DIR, file);
    if (fs.statSync(full).isDirectory()) continue;
    const contents = fs.readFileSync(full, 'utf8');
    if (!isPhobiaDataFile(file, contents)) continue;

    try {
      const phobia = parsePhobiaArray(contents);
      const html = renderPage(template, phobia);
      const outName = (phobia.slug || file.replace('.php', '')) + '.html';
      fs.writeFileSync(path.join(OUT_DIR, outName), html, 'utf8');
      console.log(`  ✓ ${outName}`);
      count++;
    } catch (err) {
      console.error(`  ✗ ${file}: ${err.message}`);
    }
  }
  console.log(`\nDone. Generated ${count} pages into ${OUT_DIR}`);
  console.log(`Next: review _template_preview.html and a couple of generated pages,`);
  console.log(`then copy dist/ into your Cloudflare Pages project.`);
}

main();
