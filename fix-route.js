const fs=require('fs');
const p='chat-worker.js';
let s=fs.readFileSync(p,'utf8');
let added=false;
if(!s.includes("startsWith('/admin/')")){
  const A="      const path = url.pathname;";
  if(s.includes(A)){ s=s.replace(A, A+"\n      if (path.startsWith('/admin/')) return await handleAdmin(path, request, env);"); added=true; }
}
fs.writeFileSync(p,s,'utf8');
console.log('route present:', s.includes("startsWith('/admin/')"), '| handler present:', s.includes('async function handleAdmin'), '| added now:', added);
