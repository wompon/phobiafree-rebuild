#!/usr/bin/env node
/**
 * Visitor pages only handled type=link and plain text, so chat photos became
 * a filename bubble. Add image/file/chat_link handlers.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public');

const HELPERS = `
function appendTextImage(from, url, msgId, label) {
  if (msgId && shownMsgIds[msgId]) return;
  if (msgId) shownMsgIds[msgId] = true;
  var box = document.getElementById('textChatMessages');
  if (!box) return;
  var div = document.createElement('div');
  var isSteven = from === 'steven';
  div.style.cssText = 'max-width:80%;padding:4px;border-radius:10px;'
    + (isSteven
      ? 'background:#e8f4f5;align-self:flex-start;border-radius:12px 12px 12px 2px;'
      : 'background:#124d52;align-self:flex-end;margin-left:auto;border-radius:12px 12px 2px 12px;');
  div.innerHTML = (isSteven ? '<div style="font-size:0.72rem;color:#6b6b6b;margin:2px 6px 4px;">Steven sent a photo</div>' : '')
    + '<a href="' + url + '" target="_blank" rel="noopener"><img src="' + url + '" alt="" style="max-width:200px;border-radius:7px;display:block;"></a>';
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}
function appendTextFile(from, label, url, msgId) {
  if (msgId && shownMsgIds[msgId]) return;
  if (msgId) shownMsgIds[msgId] = true;
  var box = document.getElementById('textChatMessages');
  if (!box) return;
  var div = document.createElement('div');
  var isSteven = from === 'steven';
  div.style.cssText = 'max-width:85%;padding:0.5rem 0.75rem;border-radius:12px;font-size:0.82rem;'
    + (isSteven
      ? 'background:#e8f4f5;color:#124d52;align-self:flex-start;border-radius:12px 12px 12px 2px;'
      : 'background:#124d52;color:#fff;align-self:flex-end;margin-left:auto;border-radius:12px 12px 2px 12px;');
  div.innerHTML = (isSteven ? '<div style="font-size:0.72rem;color:#6b6b6b;margin-bottom:4px;">Steven sent a file</div>' : '')
    + '<a href="' + url + '" target="_blank" rel="noopener" style="color:inherit;">📎 ' + (label || 'file') + '</a>';
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}
function appendTextChatLink(from, label, url, msgId) {
  if (msgId && shownMsgIds[msgId]) return;
  if (msgId) shownMsgIds[msgId] = true;
  var box = document.getElementById('textChatMessages');
  if (!box) return;
  var div = document.createElement('div');
  var isSteven = from === 'steven';
  div.style.cssText = 'max-width:90%;padding:0.5rem 0.75rem;border-radius:12px;font-size:0.82rem;'
    + (isSteven
      ? 'background:#e8f4f5;color:#124d52;align-self:flex-start;border-radius:12px 12px 12px 2px;'
      : 'background:#124d52;color:#fff;align-self:flex-end;margin-left:auto;border-radius:12px 12px 2px 12px;');
  div.innerHTML = (isSteven ? '<div style="font-size:0.72rem;color:#6b6b6b;margin-bottom:4px;">Steven shared:</div>' : '')
    + '<a href="' + url + '" target="_blank" rel="noopener" style="display:block;background:#124d52;color:#fff;padding:0.5rem 0.75rem;border-radius:6px;font-size:0.78rem;text-decoration:none;">🔗 ' + (label || 'link') + '</a>';
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}
`;

const OLD_BRANCH = `          if (m.type === 'link') {
            if (typeof appendTextLink === 'function') appendTextLink('steven', m.text, m.url, m.id);
          } else {
            if (typeof appendTextMessage === 'function') appendTextMessage('steven', m.text, m.id);
          }`;

const NEW_BRANCH = `          if (m.type === 'image') {
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

const ANCHOR = 'function appendTextMessage(from, text, msgId) {';

let helpers = 0;
let branches = 0;
for (const f of fs.readdirSync(DIR)) {
  if (!f.toLowerCase().endsWith('.html') || f.toLowerCase() === 'visitors.html') continue;
  const p = path.join(DIR, f);
  let c = fs.readFileSync(p, 'utf8');
  const before = c;

  if (c.includes(OLD_BRANCH)) {
    c = c.split(OLD_BRANCH).join(NEW_BRANCH);
    branches += 1;
  }

  if (c.includes(ANCHOR) && !c.includes('function appendTextImage')) {
    c = c.split(ANCHOR).join(HELPERS + ANCHOR);
    helpers += 1;
  }

  if (c !== before) {
    fs.writeFileSync(p, c, 'utf8');
    console.log('patched', f);
  }
}
console.log('branches:', branches, 'helpers:', helpers);
