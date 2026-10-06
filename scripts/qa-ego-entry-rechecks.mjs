/* global taskSpace, root */
const fs=await import('node:fs/promises');const {join}=await import('node:path');
const f=JSON.parse(await fs.readFile(join(root,'.local/mock-page-fixtures.json'),'utf8'));
if(f.origin!=='http://catchsecu-mock.localhost:3189')throw Error('Mock origin required');
const task=await taskSpace(56);if(task.ownership!=='agent')throw Error('Control required');const page=task.page('p1');
const dir=join(root,'.local/ego-authenticated-pages/rechecks');await fs.mkdir(dir,{recursive:true});
const results=[];
const instrument=await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{window.__qaErrors=[];addEventListener('error',e=>window.__qaErrors.push(String(e.message)));addEventListener('unhandledrejection',e=>window.__qaErrors.push(String(e.reason)));})();`});
try{
 for(const [path,expected,text] of [['/mail','/mail','발신 주소 관리'],['/sms','/sms','발신번호 관리'],['/pay/method','/pay/license-service','라이선스'],['/pay/billing-policy','/pay/license-service','라이선스']]){
  await page.goto(f.origin+'/dashboard',{waitUntil:'domcontentloaded'});await page.goto(f.origin+path,{waitUntil:'domcontentloaded'});
  await page.waitForURL(f.origin+expected,{timeout:8000});
  await page.waitForFunction(t=>document.body.innerText.includes(t)&&!/(불러오는 중|조회 중)/.test(document.body.innerText),text,{timeout:8000});
  const widths=[];
  for(const width of [1440,768,390]){
   await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const state=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,errors:window.__qaErrors||[],alerts:[...document.querySelectorAll('[role=alert]')].map(x=>x.textContent).filter(Boolean)}));
   await fs.writeFile(join(dir,path.replaceAll('/','_')+'-'+width+'.json'),JSON.stringify(state,null,2));
   await page.screenshot({path:join(dir,path.replaceAll('/','_')+'-'+width+'.png')});
   widths.push({width,overflow:state.overflow,errorCount:state.errors.length,alertCount:state.alerts.length});
  }
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(t=>document.body.innerText.includes(t),text,{timeout:8000});
  await page.evaluate(()=>history.back());await page.waitForURL('**/dashboard',{timeout:8000});
  results.push({path,expectedFinalPath:expected,widths,reloaded:true,back:true,result:widths.every(w=>!w.overflow&&!w.errorCount&&!w.alertCount)?'passed':'failed'});
 }
}finally{await page.cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:instrument.identifier});await page.cdp('Emulation.clearDeviceMetricsOverride');}
const report={checkedAt:new Date().toISOString(),browser:'Ego Lite',spaceId:56,results};await fs.writeFile(join(root,'docs/qa/mock-completion/ego-authenticated/rechecks.json'),JSON.stringify(report,null,2)+'\n');console.log(report);console.log(await page.snapshot());if(results.some(x=>x.result!=='passed'))throw Error('Entry recheck failed');
