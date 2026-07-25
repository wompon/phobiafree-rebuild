const fs = require('fs');
const path = require('path');
const DIR = 'C:\\Users\\steve\\phobia-pages';
const CHAT = 'https://phobiafree-chat.soyuzlaunch.workers.dev';
const btnAnchor = '<input id="textChatInput" type="text" placeholder="Type a message..."';
const btnInject = '<label style="cursor:pointer;background:#e8f4f5;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:1rem;" title="Send a file">\uD83D\uDCCE<input type="file" id="visitorFileInput" style="display:none" onchange="sendVisitorFile()"></label>' + btnAnchor;
const fnAnchor = 'function sendTextMessage() {';
const visitorFn = `function sendVisitorFile(){var input=document.getElementById('visitorFileInput');if(!input||!input.files.length)return;var file=input.files[0];input.value='';var vid=sessionStorage.getItem('pfvid');if(!vid)return;var box=document.getElementById('textChatMessages');if(box){var d=document.createElement('div');d.style.cssText='max-width:85%;padding:0.5rem 0.75rem;border-radius:12px 12px 2px 12px;font-size:0.82rem;background:#124d52;color:#fff;align-self:flex-end;margin-left:auto;';d.textContent='\uD83D\uDCCE '+file.name;box.appendChild(d);box.scrollTop=box.scrollHeight;}var fd=new FormData();fd.append('file',file);fetch('${CHAT}',{method:'POST',body:fd}).then(function(r){return r.json();}).then(function(data){if(!data.ok)return;var nm=(data.name||'').toLowerCase();var isImg=nm.endsWith('.png')||nm.endsWith('.jpg')||nm.endsWith('.jpeg')||nm.endsWith('.gif')||nm.endsWith('.webp');fetch('${CHAT}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vid:vid,from:'visitor',type:isImg?'image':'link',text:data.name,url:data.url})}).catch(function(){});}).catch(function(){});}\n`;
const fnInject = visitorFn + fnAnchor;
const dashCallOld = 'function(m){chatAppend(vid,m.from,m.text);}';
const dashCallNew = 'function(m){chatAppendMsg(vid,m);}';
const dashAnchor = "function chatAppend(vid,from,text){var box=document.getElementById('cmsgs_'+vid);if(!box)return;var d=document.createElement('div');d.className='cmsg '+(from==='steven'?'me':'them');d.textContent=text;box.appendChild(d);box.scrollTop=box.scrollHeight;}";
const dashFn = dashAnchor + `\nfunction chatAppendMsg(vid,m){if(!m.url){chatAppend(vid,m.from,m.text);return;}var box=document.getElementById('cmsgs_'+vid);if(!box)return;var me=(m.from==='steven');var div=document.createElement('div');div.className='cmsg '+(me?'me':'them');var u=(m.url||'').toLowerCase();var isImg=(m.type==='image')||u.endsWith('.png')||u.endsWith('.jpg')||u.endsWith('.jpeg')||u.endsWith('.gif')||u.endsWith('.webp');if(isImg){div.innerHTML='<a href="'+m.url+'" target="_blank"><img src="'+m.url+'" style="max-width:160px;border-radius:6px;display:block;"></a>';}else{div.innerHTML='<a href="'+m.url+'" target="_blank" style="color:#9ecbd0;">\uD83D\uDCCE '+(m.text||'file')+'</a>';}box.appendChild(div);box.scrollTop=box.scrollHeight;}`;
let pages = 0, dash = 0;
for (const f of fs.readdirSync(DIR)) {
  if (!f.toLowerCase().endsWith('.html')) continue;
  const p = path.join(DIR, f);
  let c = fs.readFileSync(p, 'utf8');
  const before = c;
  if (f.toLowerCase() === 'visitors.html') {
    if (c.includes(dashAnchor) && !c.includes('function chatAppendMsg')) c = c.replace(dashAnchor, dashFn);
    c = c.split(dashCallOld).join(dashCallNew);
    if (c !== before) { fs.writeFileSync(p, c, 'utf8'); dash++; console.log('  dashboard patched: ' + f); }
  } else {
    if (c.includes(btnAnchor) && !c.includes('visitorFileInput')) c = c.replace(btnAnchor, btnInject);
    if (c.includes(fnAnchor) && !c.includes('function sendVisitorFile')) c = c.replace(fnAnchor, fnInject);
    if (c !== before) { fs.writeFileSync(p, c, 'utf8'); pages++; console.log('  page patched: ' + f); }
  }
}
console.log('\nVisitor pages with upload added: ' + pages);
console.log('Dashboard patched: ' + dash + '  (want 1)');
