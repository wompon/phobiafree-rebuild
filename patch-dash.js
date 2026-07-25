const fs = require('fs');
const F = 'C:\\Users\\steve\\phobia-pages\\visitors.html';
const CHAT = 'https://phobiafree-chat.soyuzlaunch.workers.dev';
let c = fs.readFileSync(F, 'utf8');
const n = (c.match(/__chat_disabled__/g) || []).length;
c = c.split('/__chat_disabled__').join(CHAT);
fs.writeFileSync(F, c, 'utf8');
console.log('Replaced ' + n + ' chat endpoints in visitors.html');
