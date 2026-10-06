/* global taskSpace, root */
// Observational smoke test: not a substitute for each route's full acceptance contract.
const {readFile,writeFile,mkdir}=await import('node:fs/promises');
const {join}=await import('node:path');
const f=JSON.parse(await readFile(join(root,'.local/mock-page-fixtures.json'),'utf8'));
if(f.origin!=='http://catchsecu-mock.localhost:3189')throw Error('Mock origin required');
const task=await taskSpace(56);if(task.ownership!=='agent')throw Error('User control required');
const page=task.page('p1');
const manifest=JSON.parse(await readFile(join(root,'src/data/route-manifest.json'),'utf8'));
const routes=manifest.map(r=>r.path).filter(p=>!p.includes(':')&&/^\/(?:set|log|basic|form|alimtalk|mail|sms|security|my-page|pay)(?:\/|$)|^\/(?:dashboard|privacy-detail|marketing-detail|compliance|integration\/message|notice|company-info)$/.test(p));
const runId=new Date().toISOString().replace(/[:.]/g,'-');
const dir=join(root,'.local/ego-authenticated-pages',runId),out=join(root,'docs/qa/mock-completion/ego-authenticated');await mkdir(dir,{recursive:true});await mkdir(out,{recursive:true});
const report={runId,checkedAt:new Date().toISOString(),scope:'authenticated Mock read-only route smoke; not full acceptance',results:[],result:'running'};
const save=()=>writeFile(join(dir,'report.json'),JSON.stringify(report,null,2)+'\n');
const instrument=await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{window.__qaErrors=[];addEventListener('error',e=>window.__qaErrors.push(String(e.message)));addEventListener('unhandledrejection',e=>window.__qaErrors.push(String(e.reason)));const old=console.error;console.error=(...args)=>{window.__qaErrors.push(args.map(String).join(' '));old.apply(console,args);};})();`});
try{
 for(const path of routes){
  const r={path,widths:[],status:'running'};report.results.push(r);
  try{
   await page.goto(f.origin+path,{waitUntil:'domcontentloaded',timeout:15000});
   await page.waitForFunction(()=>document.body.innerText.length>40&&!/(불러오는 중|조회 중|집계 중|로딩 중)/.test(document.body.innerText),undefined,{timeout:8000});
   r.pathMatches=new URL(await page.url()).pathname===path;
   for(const width of [1440,768,390]){
    await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const state=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,errors:window.__qaErrors||[],alerts:[...document.querySelectorAll('[role=alert]')].map(x=>x.textContent),badResponses:performance.getEntriesByType('resource').filter(x=>x.responseStatus>=400).map(x=>({status:x.responseStatus,path:new URL(x.name).pathname}))}));
    await writeFile(join(dir,`${report.results.length}-${width}.json`),JSON.stringify(state,null,2));
    r.widths.push({width,overflow:state.overflow,errorCount:state.errors.length,alertCount:state.alerts.length,badResponseCount:state.badResponses.length});
    if(state.overflow||state.errors.length||state.alerts.length||state.badResponses.length)await page.screenshot({path:join(dir,`${report.results.length}-${width}.png`)});
   }
   r.status=r.pathMatches&&r.widths.every(w=>!w.overflow&&!w.errorCount&&!w.alertCount&&!w.badResponseCount)?'smoke-passed':'needs-review';
  }catch(e){r.status='needs-review';await writeFile(join(dir,`${report.results.length}-error.txt`),String(e));}
  if(r.status!=='smoke-passed')await writeFile(join(dir,`${report.results.length}-snapshot.txt`),await page.snapshot({scope:'full_page'}));
  await save();
 }
 report.result=report.results.every(r=>r.status==='smoke-passed')?'smoke-passed':'needs-review';report.finishedAt=new Date().toISOString();await save();
}finally{await page.cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:instrument.identifier});await page.cdp('Emulation.clearDeviceMetricsOverride');}
await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({runId,result:report.result,count:report.results.length,review:report.results.filter(r=>r.status!=='smoke-passed').map(r=>r.path)}));console.log(await page.snapshot());
