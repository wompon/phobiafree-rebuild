#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public');
const LEAVE = `function leaveNow(){try{var payload=JSON.stringify({vid:vid});if(navigator.sendBeacon){navigator.sendBeacon("/track?leave=1",new Blob([payload],{type:"application/json"}));}else{fetch("/track?leave=1",{method:"POST",headers:{"Content-Type":"application/json"},body:payload,keepalive:true}).catch(function(){});}}catch(e){}}window.addEventListener("pagehide",leaveNow);window.addEventListener("beforeunload",leaveNow);`;

let n = 0;
for (const f of fs.readdirSync(DIR)) {
  if (!f.startsWith('welcome-') || !f.endsWith('.html')) continue;
  const p = path.join(DIR, f);
  let c = fs.readFileSync(p, 'utf8');
  const before = c;
  c = c.split('fetch("//track"').join('fetch("/track"');
  if (!c.includes('/track?leave=1') && c.includes('setInterval(send,5000)')) {
    c = c.replace(
      'setInterval(send,5000);setTimeout(send,500);',
      LEAVE + 'setInterval(send,5000);setTimeout(send,500);',
    );
  }
  if (c !== before) {
    fs.writeFileSync(p, c, 'utf8');
    n += 1;
    console.log('patched', f);
  }
}
console.log('done', n);
