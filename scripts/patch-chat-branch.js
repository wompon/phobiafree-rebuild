#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public');

const OLD = `          if (m.type === 'link') {
            if (typeof appendTextLink === 'function') appendTextLink('steven', m.text, m.url, m.id);
          } else {
            if (typeof appendTextMessage === 'function') appendTextMessage('steven', m.text, m.id);
          }`;

const NEW = `          if (m.type === 'image') {
            if (typeof appendTextImage === 'function') appendTextImage('steven', m.url, m.id, m.text);
          } else if (m.type === 'file') {
            if (typeof appendTextFile === 'function') appendTextFile('steven', m.text, m.url, m.id);
          } else if (m.type === 'chat_link') {
            if (typeof appendTextChatLink === 'function') appendTextChatLink('steven', m.text, m.url, m.id);
          } else if (m.type === 'link') {
            if (typeof appendTextLink === 'function') appendTextLink('steven', m.text, m.url, m.id);
          } else {
            if (typeof appendTextMessage === 'function') appendTextMessage('steven', m.text, m.id);
          }`;

let n = 0;
for (const f of fs.readdirSync(DIR)) {
  if (!f.toLowerCase().endsWith('.html') || f.toLowerCase() === 'visitors.html') continue;
  const p = path.join(DIR, f);
  let c = fs.readFileSync(p, 'utf8');
  if (!c.includes("if (m.type === 'link')")) continue;
  if (c.includes("m.type === 'image'")) continue;
  if (!c.includes(OLD)) {
    // try flexible replace around the link branch
    const re = /\n(\s*)if \(m\.type === 'link'\) \{\s*\n\s*if \(typeof appendTextLink === 'function'\) appendTextLink\('steven', m\.text, m\.url, m\.id\);\s*\n\s*\} else \{\s*\n\s*if \(typeof appendTextMessage === 'function'\) appendTextMessage\('steven', m\.text, m\.id\);\s*\n\s*\}/;
    if (!re.test(c)) {
      console.log('NO MATCH', f);
      continue;
    }
    c = c.replace(re, '\n$1' + NEW.trim().replace(/\n          /g, '\n$1'));
  } else {
    c = c.split(OLD).join(NEW);
  }
  fs.writeFileSync(p, c, 'utf8');
  n += 1;
  console.log('patched', f);
}
console.log('done', n);
