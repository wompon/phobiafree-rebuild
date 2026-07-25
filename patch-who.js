const fs=require('fs');
const p='chat-worker.js';
let s=fs.readFileSync(p,'utf8');
let ok=true;
if(s.includes("if (from === 'visitor') {")) s=s.replace("if (from === 'visitor') {","if (from !== 'steven') {");
else if(!s.includes("if (from !== 'steven') {")){ ok=false; console.log('ANCHOR1 not found'); }
const a=`    const sms = '\u{1F4AC} #' + code + '  "' + t.slice(0, 140) + '"\\nReply: #' + code + ' your message';`;
const b=`    const sms = '\u{1F4AC} ' + vid + '  [#' + code + ']\\n"' + t.slice(0, 140) + '"\\nReply: #' + code + ' your message';`;
if(s.includes(a)) s=s.replace(a,b);
else if(!s.includes("[#' + code + ']")){ ok=false; console.log('ANCHOR2 not found'); }
fs.writeFileSync(p,s,'utf8');
console.log(ok?'patched ok':'CHECK ANCHORS');
