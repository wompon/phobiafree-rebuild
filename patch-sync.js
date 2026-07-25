const fs=require('fs');
const p='C:\\Users\\steve\\phobia-pages\\visitors.html';
let s=fs.readFileSync(p,'utf8');
const RC = s.includes('chatAppendMsg(vid,m)') ? 'chatAppendMsg(vid,m)' : 'chatAppend(vid,m.from,m.text)';
let report=['render call: '+RC];
const fOld = "data.messages.filter(function(m){return m.from!=='steven';})";
const fNew = "data.messages.filter(function(m){if(!vs.seen)vs.seen={};if(vs.seen[m.id])return false;vs.seen[m.id]=true;if(m.from==='steven'){"+RC+";return false;}return true;})";
let c1=s.split(fOld).length-1; s=s.split(fOld).join(fNew); report.push('pollBg filter: '+c1+' (want 2)');
const oOld = "data.messages.forEach(function(m){"+RC+";})";
const oNew = "data.messages.forEach(function(m){if(!vs.seen)vs.seen={};vs.seen[m.id]=true;"+RC+";})";
let c2=s.split(oOld).length-1; s=s.split(oOld).join(oNew); report.push('chatOpen load: '+c2+' (want 1)');
["chatAppend(vid,'steven',txt);",
 "chatAppend(vid,'steven','\u{1F517} '+label);",
 "chatAppend(vid,'steven','\u{1F4CE} '+data.name);",
 "chatAppendMsg(vid,{from:'steven',type:type,text:data.name,url:data.url});"
].forEach(function(e){const n=s.split(e).length-1; if(n>0)s=s.split(e).join(''); report.push('echo ['+e.slice(0,22)+'..]: '+n);});
fs.writeFileSync(p,s,'utf8');
console.log(report.join('\n'));
