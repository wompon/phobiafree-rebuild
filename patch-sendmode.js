const fs = require('fs');
const path = require('path');
const DIR = 'C:\\Users\\steve\\phobia-pages';
const CHAT = 'https://phobiafree-chat.soyuzlaunch.workers.dev';
const vHelpersAnchor = 'function appendTextMessage(from, text, msgId) {';
const vHelpers = `function appendTextImage(from, url, msgId){if(msgId&&shownMsgIds[msgId])return;if(msgId)shownMsgIds[msgId]=true;var box=document.getElementById('textChatMessages');if(!box)return;var div=document.createElement('div');var s=from==='steven';div.style.cssText='max-width:80%;padding:3px;border-radius:10px;'+(s?'background:#e8f4f5;align-self:flex-start;':'background:#124d52;align-self:flex-end;margin-left:auto;');div.innerHTML='<a href="'+url+'" target="_blank"><img src="'+url+'" style="max-width:200px;border-radius:7px;display:block;"></a>';box.appendChild(div);box.scrollTop=box.scrollHeight;}
function appendTextFile(from, label, url, msgId){if(msgId&&shownMsgIds[msgId])return;if(msgId)shownMsgIds[msgId]=true;var box=document.getElementById('textChatMessages');if(!box)return;var div=document.createElement('div');var s=from==='steven';div.style.cssText='max-width:85%;padding:0.5rem 0.75rem;border-radius:12px;font-size:0.82rem;'+(s?'background:#e8f4f5;color:#124d52;align-self:flex-start;':'background:#124d52;color:#fff;align-self:flex-end;margin-left:auto;');div.innerHTML='<a href="'+url+'" target="_blank" style="color:inherit;">\uD83D\uDCCE '+(label||'file')+'</a>';box.appendChild(div);box.scrollTop=box.scrollHeight;}
`;
const vBranchAnchor = "if (m.type === 'link') {";
const vBranchNew = "if (m.type === 'image') { appendTextImage('steven', m.url, m.id); } else if (m.type === 'file') { appendTextFile('steven', m.text, m.url, m.id); } else if (m.type === 'link') {";
const dTitleOld = 'title="Send file">';
const dTitleNew = 'title="Pop onto their screen">';
const dIconAnchor = "  h+='\uD83D\uDCCE</label>';";
const dIconNew = `  h+='\uD83D\uDDA5\uFE0F</label>';
  h+='<label class="csnd" style="cursor:pointer;background:#30363d;display:flex;align-items:center;justify-content:center;" title="Send to their chat">';
  h+='<input type="file" id="cfileC_'+vid+'" style="display:none" onchange="chatSendFileChat(\\''+vid+'\\')">';
  h+='\uD83D\uDCAC</label>';`;
const dFnAnchor = 'function chatSendFile(vid) {';
const dFnNew = `function chatSendFileChat(vid){var input=document.getElementById('cfileC_'+vid);if(!input||!input.files.length)return;var file=input.files[0];input.value='';chatAppend(vid,'steven','\uD83D\uDCCE Uploading '+file.name+'...');var fd=new FormData();fd.append('file',file);fetch('${CHAT}',{method:'POST',body:fd}).then(function(r){return r.json();}).then(function(data){if(!data.ok){chatAppend(vid,'steven','Upload failed: '+(data.error||'unknown'));return;}var nm=(data.name||'').toLowerCase();var isImg=nm.endsWith('.png')||nm.endsWith('.jpg')||nm.endsWith('.jpeg')||nm.endsWith('.gif')||nm.endsWith('.webp');var type=isImg?'image':'file';chatAppendMsg(vid,{from:'steven',type:type,text:data.name,url:data.url});fetch('${CHAT}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vid:vid,from:'steven',type:type,text:data.name,url:data.url})}).then(function(r){return r.json();}).then(function(d){if(d.ts)getVS(vid).lastTs=d.ts;}).catch(function(){});}).catch(function(){chatAppend(vid,'steven','Upload failed.');});}
${dFnAnchor}`;
let pages = 0, dash = 0;
for (const f of fs.readdirSync(DIR)) {
  if (!f.toLowerCase().endsWith('.html')) continue;
  const p = path.join(DIR, f);
  let c = fs.readFileSync(p, 'utf8');
  const before = c;
  if (f.toLowerCase() === 'visitors.html') {
    if (c.includes(dTitleOld)) c = c.replace(dTitleOld, dTitleNew);
    if (c.includes(dIconAnchor) && !c.includes('cfileC_')) c = c.replace(dIconAnchor, dIconNew);
    if (c.includes(dFnAnchor) && !c.includes('function chatSendFileChat')) c = c.replace(dFnAnchor, dFnNew);
    if (c !== before) { fs.writeFileSync(p, c, 'utf8'); dash++; console.log('  dashboard updated'); }
  } else {
    if (c.includes(vHelpersAnchor) && !c.includes('function appendTextImage')) c = c.replace(vHelpersAnchor, vHelpers + vHelpersAnchor);
    if (c.includes(vBranchAnchor) && !c.includes("m.type === 'image'")) c = c.replace(vBranchAnchor, vBranchNew);
    if (c !== before) { fs.writeFileSync(p, c, 'utf8'); pages++; console.log('  page updated: ' + f); }
  }
}
console.log('\nVisitor pages updated: ' + pages);
console.log('Dashboard updated: ' + dash + '  (want 1)');
