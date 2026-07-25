const fs=require('fs');
const p='chat-worker.js';
let s=fs.readFileSync(p,'utf8');
const a=`      body: new URLSearchParams({ From: env.TWILIO_FROM, To: to, Body: body }).toString(),
    });
    return resp.ok;`;
const b=`      body: new URLSearchParams({ From: env.TWILIO_FROM, To: to, Body: body }).toString(),
    });
    const rt = await resp.text();
    console.log('TWILIO_RESP', resp.status, rt.slice(0, 500));
    return resp.ok;`;
if(s.includes(a)){s=s.replace(a,b);fs.writeFileSync(p,s,'utf8');console.log('patched sendSMS logging');}
else if(s.includes('TWILIO_RESP')){console.log('already patched');}
else{console.log('ANCHOR NOT FOUND');}
