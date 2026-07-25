#!/usr/bin/env node
/**
 * Photos sent "on page" were blank because showLinkPanel always used an iframe.
 * Use <img> for image URLs instead.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public');
const OLD =
  "    + '<iframe src=\"' + url + '\" style=\"flex:1;border:none;width:100%;display:block;\" allow=\"camera;microphone;fullscreen\"></iframe>'";
const NEW =
  "    + ((/\\.(png|jpe?g|gif|webp)(\\?|#|$)/i.test(url) || /\\/file\\/[^\"']+\\.(png|jpe?g|gif|webp)/i.test(url))" +
  " ? '<div style=\"flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;background:#0d1117;\"><img src=\"' + url + '\" alt=\"\" style=\"max-width:100%;max-height:100%;object-fit:contain;display:block;\"></div>'" +
  " : '<iframe src=\"' + url + '\" style=\"flex:1;border:none;width:100%;display:block;\" allow=\"camera;microphone;fullscreen\"></iframe>')";

let n = 0;
for (const f of fs.readdirSync(DIR)) {
  if (!f.toLowerCase().endsWith('.html')) continue;
  const p = path.join(DIR, f);
  let c = fs.readFileSync(p, 'utf8');
  if (!c.includes(OLD)) continue;
  fs.writeFileSync(p, c.split(OLD).join(NEW), 'utf8');
  n += 1;
  console.log('patched', f);
}
console.log('done:', n, 'files');
