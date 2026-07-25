/**
 * Build admin static pages from legacy PHP sources.
 * Usage: node scripts/build-admin-pages.js
 */
const fs = require('fs');
const path = require('path');

const LEGACY = path.join(
  process.env.USERPROFILE || '',
  'Documents/phobiafree.life/public_html/phobiafree.life'
);
const PUBLIC = path.join(__dirname, '..', 'public');

function patchVisitorsHtml(html) {
  let s = html;

  // API endpoints FIRST (before any .php → .html pass)
  s = s.replace(/fetch\('visitors\.php\?get_sessions=1'\)/g,
    "fetch('/api/sessions',{credentials:'include'})");
  s = s.replace(/fetch\('visitors\.php\?get_replay='\+vid\)/g,
    "fetch('/api/replay?vid='+encodeURIComponent(vid),{credentials:'include'})");
  s = s.replace(/chat_handler\.php/g, '/api/chat');
  s = s.replace(/cursor_track\.php/g, '/track');
  s = s.replace(/steven_status\.php/g, '/api/chat/status');

  s = s.replace(
    /var fd = new FormData\(\);\s*fd\.append\('delete_recording','1'\);\s*fd\.append\('vid', vid\);\s*fetch\('visitors\.php', \{method:'POST', body:fd\}\)/g,
    "fetch('/api/delete',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({vid:vid})})"
  );

  s = s.replace(
    /function setStatus\(s\)\{var d=new FormData\(\);d\.append\('action',s\);fetch\('\/api\/chat\/status',\{method:'POST',body:d\}\)\.catch\(function\(\)\{\}\);\}/g,
    "function setStatus(s){fetch('/api/chat/status',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:s})}).catch(function(){});}"
  );

  // Static page URLs in PAGE_URLS and chat quick links
  s = s.replace(/https:\/\/www\.phobiafree\.life\//g, '/');
  s = s.replace(/https:\/\/phobiafree\.life\//g, '/');
  s = s.replace(/\/([a-z0-9_-]+)\.php/g, '/$1.html');
  s = s.replace(/'\/\?notrack=1&nowelcome=1'/g, "'/index.html?notrack=1&nowelcome=1'");
  s = s.replace(/'\/\?notrack=1'/g, "'/index.html?notrack=1'");

  s = s.replace(
    /<form method="POST" style="margin:0;"><input type="hidden" name="logout" value="1"\/><button type="submit" class="btn-logout">Sign Out<\/button><\/form>/,
    '<button type="button" class="btn-logout" onclick="doLogout()">Sign Out</button>'
  );

  const statusInit = `
fetch('/api/chat/status',{credentials:'include'}).then(function(r){return r.json();}).then(function(d){
  var on=(d.status==='online'||d.status==='online_cam');
  isOnline=on;
  var b=document.getElementById('onlineBtn');
  if(!b)return;
  if(on){b.textContent='Online';b.style.background='#1a6b72';}else{b.textContent='Offline';b.style.background='#8b2020';}
}).catch(function(){});
`;

  s = s.replace('poll();', statusInit + 'poll();');

  return s;
}

function extractStyleBlock(html) {
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  return m ? m[1].trim() : '';
}

function buildVisitors() {
  const src = fs.readFileSync(path.join(LEGACY, 'visitors.php'), 'utf8');
  const dashStart = src.indexOf('<title>Visitors — PhobiaFree.life</title>');
  if (dashStart === -1) throw new Error('Could not find visitors dashboard in visitors.php');
  const htmlStart = src.lastIndexOf('<!DOCTYPE html>', dashStart);
  let dashboard = src.slice(htmlStart);

  let dashboardCss = extractStyleBlock(dashboard);
  // Dashboard used body as flex column; app shell is now #appShell.
  dashboardCss = dashboardCss.replace(
    /body\{font-family:'DM Sans',sans-serif;background:#0d1117;color:#fff;min-height:100vh;display:flex;flex-direction:column;\}/,
    ''
  );
  dashboard = patchVisitorsHtml(dashboard);
  const body = dashboard
    .replace(/^<!DOCTYPE html>[\s\S]*?<body>/i, '')
    .replace(/<\/body>[\s\S]*$/i, '');

  // Login styles scoped to #loginScreen so they don't override dashboard controls.
  const loginCss = `
#loginScreen{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem;background:#0d1117;}
#loginScreen .card{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:2.5rem;width:100%;max-width:360px;}
#loginScreen .logo{font-family:'Cinzel',serif;color:#1a6b72;text-align:center;margin-bottom:2rem;font-size:1.1rem;}
#loginScreen .logo span{color:#c9a84c;}
#loginScreen label{display:block;font-size:0.78rem;color:#8b949e;margin-bottom:0.4rem;}
#loginScreen input{width:100%;padding:0.65rem 0.85rem;background:#0d1117;border:1px solid #30363d;border-radius:3px;color:#fff;font-family:'DM Sans',sans-serif;font-size:0.88rem;outline:none;margin-bottom:1rem;}
#loginScreen input:focus{border-color:#1a6b72;}
#loginScreen button[type="submit"]{width:100%;padding:0.85rem;background:#1a6b72;color:#fff;border:none;border-radius:3px;font-family:'DM Sans',sans-serif;font-size:0.88rem;cursor:pointer;}
#loginScreen .err{color:#f87171;font-size:0.78rem;margin-bottom:1rem;text-align:center;}
#appShell{display:none;flex-direction:column;min-height:100vh;background:#0d1117;color:#fff;}
`;

  const out = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Visitors — PhobiaFree.life</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500&family=Cinzel&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'DM Sans',sans-serif;background:#0d1117;color:#fff;min-height:100vh;}
${loginCss}
${dashboardCss}
</style>
</head>
<body>
<div id="loginScreen">
  <div class="card">
    <div class="logo">Phobia<span>Free</span>.life</div>
    <div id="loginErr" class="err" style="display:none"></div>
    <form id="loginForm" onsubmit="return doLogin(event)">
      <label>Username</label><input type="text" id="loginUser" autofocus/>
      <label>Password</label><input type="password" id="loginPass"/>
      <button type="submit">Sign In</button>
    </form>
  </div>
</div>
<div id="appShell">
${body}
</div>
<script>
var API_OPTS = {credentials:'include'};
function showApp(){
  document.getElementById('loginScreen').style.display='none';
  var app=document.getElementById('appShell');
  app.style.display='flex';
}
async function checkAuth(){
  try{
    var r=await fetch('/api/sessions',API_OPTS);
    if(r.ok){showApp();return true;}
  }catch(e){}
  return false;
}
async function doLogin(e){
  e.preventDefault();
  var err=document.getElementById('loginErr');
  err.style.display='none';
  var r=await fetch('/api/login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:document.getElementById('loginUser').value,password:document.getElementById('loginPass').value})});
  var d=await r.json().catch(function(){return {};});
  if(!r.ok){err.textContent=d.error||'Invalid credentials.';err.style.display='block';return false;}
  showApp();
  return false;
}
async function doLogout(){
  await fetch('/api/logout',{method:'POST',credentials:'include'});
  location.reload();
}
checkAuth();
</script>
</body>
</html>`;

  fs.writeFileSync(path.join(PUBLIC, 'visitors.html'), out);
  console.log('  wrote visitors.html (' + Math.round(out.length / 1024) + ' KB)');
}

function buildVisitorLog() {
  const tpl = fs.readFileSync(path.join(__dirname, 'visitor-log-template.html'), 'utf8');
  fs.writeFileSync(path.join(PUBLIC, 'visitor_log.html'), tpl);
  console.log('  wrote visitor_log.html (' + Math.round(tpl.length / 1024) + ' KB)');
}

console.log('Building admin pages...');
buildVisitors();
buildVisitorLog();
console.log('Done.');
