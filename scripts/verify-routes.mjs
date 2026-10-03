import fs from 'node:fs/promises';
const routes=JSON.parse(await fs.readFile('src/data/route-manifest.json','utf8'));
const result=[];
for(let start=0;start<routes.length;start+=8){await Promise.all(routes.slice(start,start+8).map(async r=>{const url='http://localhost:3100'+r.path.replace(/:[^/]+/g,'demo');try{const res=await fetch(url);const html=await res.text();result.push({path:r.path,url,status:res.status,pass:res.ok&&!html.includes('Internal Server Error')});}catch(e){result.push({path:r.path,url,pass:false,error:String(e)})}}));}
const missing=await fetch('http://localhost:3100/unknown-qa-route');
const report={tested:result.length,passed:result.filter(x=>x.pass).length,unknownRouteStatus:missing.status,routes:result.sort((a,b)=>a.path.localeCompare(b.path))};await fs.writeFile('docs/research/route-http-check.json',JSON.stringify(report,null,2));console.log({tested:report.tested,passed:report.passed,unknownRouteStatus:report.unknownRouteStatus,failures:result.filter(x=>!x.pass)});
