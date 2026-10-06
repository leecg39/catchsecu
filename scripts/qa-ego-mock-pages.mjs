/* global taskSpace, root */
// Execute in ego-browser nodejs with `const root = <absolute repository path>` prepended.
// Reuses the user-authorized TaskSpace 56. Never creates or claims another space.
const {readFile,writeFile,mkdir}=await import('node:fs/promises');
const {join}=await import('node:path');
const f=JSON.parse(await readFile(join(root,'.local/mock-page-fixtures.json'),'utf8'));
if(f.origin!=='http://catchsecu-mock.localhost:3189'||f.database!=='/catchsecu_mock_admin')throw Error('Dedicated Mock origin/database required');
if([f.subject,f.viewer].some(v=>!v||Date.parse(v.expiresAt)<=Date.now()))throw Error('Refresh expired Mock fixtures');
const task=await taskSpace(56);if(task.ownership!=='agent')throw Error('TaskSpace control required');
const page=task.page('p1');
const runId=new Date().toISOString().replace(/[:.]/g,'-');
const dir=join(root,'.local/ego-mock-pages',runId),out=join(root,'docs/qa/mock-completion/ego-pages');
await mkdir(dir,{recursive:true});await mkdir(out,{recursive:true});
const report={runId,checkedAt:new Date().toISOString(),browser:'Ego Lite',spaceId:56,source:'current production build and dedicated Mock DB',results:[],result:'running'};
const save=()=>writeFile(join(dir,'report.json'),JSON.stringify(report,null,2)+'\n');
const marker=path=>path.startsWith('/pay/')?'결제가 확인됐습니다.':path.startsWith('/document/')?'합성 데이터 문서':path.startsWith('/file-view/')?'mock-proof.txt':path==='/shared-privacy/view'?'Mock 정보주체':path.includes('/action-history/')?'동의 처리 이력':path.includes('/agree-history/')?'Mock 동적 폼':'Mock 동적 폼';
const instrument=await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{window.__mockQaErrors=[];addEventListener('error',e=>window.__mockQaErrors.push(String(e.message)));addEventListener('unhandledrejection',e=>window.__mockQaErrors.push(String(e.reason)));const old=console.error;console.error=(...args)=>{window.__mockQaErrors.push(args.map(String).join(' '));old.apply(console,args);};})();`});
try{
 let index=0;
 for(const [path,route] of Object.entries(f.routes)){
  const r={path,index:index++,marker:marker(path),widths:[],status:'running'};report.results.push(r);
  try{
   await page.goto(f.origin+'/dashboard',{waitUntil:'domcontentloaded',timeout:15000});
   await page.goto(f.origin+route,{waitUntil:'domcontentloaded',timeout:15000});
   await page.waitForFunction(text=>document.body.innerText.includes(text),r.marker,{timeout:8000});
   r.pathMatches=new URL(await page.url()).pathname===route;
   for(const width of [1440,768,390]){
    await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:width===768?1024:900,deviceScaleFactor:1,mobile:false});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const state=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,width:document.documentElement.clientWidth,errors:window.__mockQaErrors||[],badResponses:performance.getEntriesByType('resource').filter(r=>r.responseStatus>=400).map(r=>({status:r.responseStatus,path:new URL(r.name).pathname})),alerts:[...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent)}));
    await writeFile(join(dir,`${r.index}-${width}.json`),JSON.stringify(state,null,2));
    r.widths.push({width,actualWidth:state.width,overflow:state.overflow,errorCount:state.errors.length,badResponseCount:state.badResponses.length,alertCount:state.alerts.length});
    await page.screenshot({path:join(dir,`${r.index}-${width}.png`),fullPage:false});
   }
   await writeFile(join(dir,`${r.index}-snapshot.txt`),await page.snapshot({scope:'full_page'}));
   await page.reload({waitUntil:'domcontentloaded',timeout:15000});
   await page.waitForFunction(text=>document.body.innerText.includes(text),r.marker,{timeout:8000});r.reloaded=true;
   await page.evaluate(()=>history.back());await page.waitForURL('**/dashboard',{timeout:15000});r.back=true;
   r.status=r.pathMatches&&r.widths.every(w=>!w.overflow&&!w.errorCount&&!w.badResponseCount&&!w.alertCount)?'passed':'failed';
  }catch(error){r.status='failed';r.failure='Navigation, expected content, capture, or history verification failed';await writeFile(join(dir,`${r.index}-failure.txt`),String(error));await writeFile(join(dir,`${r.index}-failure-snapshot.txt`),await page.snapshot({scope:'full_page'}));}
  await save();console.log(JSON.stringify({path:r.path,status:r.status}));
 }
 report.result=report.results.length===19&&report.results.every(r=>r.status==='passed')?'passed':'failed';report.finishedAt=new Date().toISOString();await save();
}finally{
 await page.cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:instrument.identifier});
 await page.cdp('Emulation.clearDeviceMetricsOverride');
}
await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({runId,result:report.result,checked:report.results.length,failed:report.results.filter(r=>r.status!=='passed').map(r=>r.path)}));
console.log(await page.snapshot());
if(report.result!=='passed')throw Error('Mock page QA failed; inspect private diagnostics');
