import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const urls=JSON.parse(await readFile('docs/research/app.catchsecu.com/asset-urls.json','utf8'));
const results=[];
for(let i=0;i<urls.length;i+=4){await Promise.all(urls.slice(i,i+4).map(async url=>{try{const u=new URL(url);const dest=path.join('public/assets',u.pathname);await mkdir(path.dirname(dest),{recursive:true});const res=await fetch(url);if(!res.ok)throw new Error(String(res.status));await writeFile(dest,Buffer.from(await res.arrayBuffer()));results.push({url,path:dest,status:'downloaded'});}catch(e){results.push({url,status:'failed',error:String(e)});}}));}
await writeFile('docs/research/app.catchsecu.com/assets.json',JSON.stringify(results,null,2));
console.log({downloaded:results.filter(x=>x.status==='downloaded').length,failed:results.filter(x=>x.status==='failed').length});
