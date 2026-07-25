const fs=require('fs');
const p='chat-worker.js';
let s=fs.readFileSync(p,'utf8');

// store last twilio response in D1 chat_status row id=2
const a=`    const rt = await resp.text();
    console.log('TWILIO_RESP', resp.status, rt.slice(0, 500));
    return resp.ok;`;
const b=`    const rt = await resp.text();
    try { await env.phobiafree_db.prepare('INSERT INTO chat_status (id, status, updated_at) VALUES (2, ?, ?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at').bind(('HTTP '+resp.status+' '+rt).slice(0,800), Math.floor(Date.now()/1000)).run(); } catch(e){}
    return resp.ok;`;
if(s.includes(a)) s=s.replace(a,b);

// add GET /lasterr route
const c=`      if (path.endsWith('/sms')) return await handleInboundSms(request, env);`;
const d=`      if (path.endsWith('/sms')) return await handleInboundSms(request, env);
      if (path.endsWith('/lasterr')) { const row = await env.phobiafree_db.prepare('SELECT status, updated_at FROM chat_status WHERE id=2').first(); return json({ lasterr: row ? row.status : 'none yet', at: row ? row.updated_at : 0 }); }`;
if(s.includes(c)) s=s.replace(c,d);

fs.writeFileSync(p,s,'utf8');
console.log(s.includes('/lasterr')?'patched ok':'FAILED');
