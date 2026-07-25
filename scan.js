const fs=require('fs');
const path=require('path');
const DIR='C:\\Users\\steve\\phobia-pages';
const hits={};
for(const f of fs.readdirSync(DIR)){
  if(!f.toLowerCase().endsWith('.html'))continue;
  const txt=fs.readFileSync(path.join(DIR,f),'utf8');
  const m=txt.match(/https?:\/\/[^"'\s)>]*phobiafree\.life[^"'\s)>]*|[\w.-]+\.php\b/g);
  if(m)m.forEach(u=>{hits[u]=(hits[u]||0)+1;});
}
const keys=Object.keys(hits).sort();
if(!keys.length){console.log('No references to phobiafree.life or .php found.');}
else{console.log('Still pointing at the old server:\n');keys.forEach(k=>console.log('  '+hits[k]+'x   '+k));console.log('\nDistinct targets: '+keys.length);}
