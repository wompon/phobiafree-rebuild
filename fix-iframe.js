const fs=require('fs');
const p='C:\\Users\\steve\\phobia-pages\\visitors.html';
let s=fs.readFileSync(p,'utf8');
const n=(s.match(/https:\/\/phobiafree\.pages\.dev\//g)||[]).length;
s=s.split('https://phobiafree.pages.dev/').join('/');
fs.writeFileSync(p,s,'utf8');
console.log('replaced '+n+' pages.dev refs (want 4); remaining '+(s.match(/phobiafree\.pages\.dev/g)||[]).length);
