/* global taskSpace, root */
const fs=await import('node:fs/promises'),{join}=await import('node:path'),{createHash}=await import('node:crypto');
const fixture=JSON.parse(await fs.readFile(join(root,'.local/mock-subject-workflow.json'),'utf8'));
if(fixture.origin!=='http://catchsecu-mock.localhost:3189')throw Error('Dedicated Mock origin required');
const task=await taskSpace(56);if(task.ownership!=='agent')throw Error('Agent control required');const page=task.page('p1');
const historyUrl=new URL(await page.url());if(!/^\/infoOwner\/agree-history\/[0-9a-f-]{36}$/.test(historyUrl.pathname))throw Error('Verified subject history required');
const sessionId=historyUrl.pathname.split('/').at(-1),out=join(root,'docs/qa/mock-completion/subject-withdrawal'),screens=join(root,'.local/subject-withdrawal');await fs.mkdir(out,{recursive:true});await fs.mkdir(screens,{recursive:true});
const report={checkedAt:new Date().toISOString(),browser:'Ego Lite',spaceId:56,scope:'dedicated Mock browser authentication, cancellation and confirmation workflow; no original screen fidelity or real SMTP claim',realProviderAcceptance:false,results:[],workflows:[],result:'incomplete'};
const hash=x=>createHash('sha256').update(x).digest('hex'),wait=text=>page.waitForFunction(text=>document.body.innerText.includes(text),text,{timeout:15000});
const instrument=await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{window.__withdrawErrors=[];addEventListener('error',e=>window.__withdrawErrors.push(String(e.message)));addEventListener('unhandledrejection',e=>window.__withdrawErrors.push(String(e.reason)));})();`});
async function check(path,marker) {
 const result={path,widths:[],reload:false,result:'incomplete'};report.results.push(result);
 if(new URL(await page.url()).pathname!==path)throw Error('Withdrawal route mismatch');await wait(marker);
 for(const width of [1440,768,390]) {
  await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const state=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent),errors:window.__withdrawErrors||[],failedResources:performance.getEntriesByType('resource').filter(r=>r.responseStatus>=400).map(r=>r.responseStatus)}));
  result.widths.push({width,overflow:state.overflow,alerts:state.alerts.length,errors:state.errors.length,failedResources:state.failedResources});
  if(state.overflow||state.alerts.length||state.errors.length||state.failedResources.length)throw Error('Withdrawal screen check failed');
  await page.screenshot({path:join(screens,path.split('/').at(-1)+'-'+width+'.png')});
 }
 await page.reload();await wait(marker);result.reload=true;result.result='passed';
}
try {
 await page.click('loc=role:button[name="동의 철회 요청"]');await page.waitForURL('**/infoOwner/form-interrupt?*',{timeout:15000});
 await check('/infoOwner/form-interrupt','이 응답의 동의를 철회하시겠습니까?');
 await page.click('loc=role:button[name="철회 취소"]');await page.waitForURL('**/infoOwner/agree-history/*',{timeout:15000});await page.waitForSelector('loc=role:button[name="동의 철회 요청"]');report.workflows.push('request-cancel-and-retained-consent');
 await page.click('loc=role:button[name="동의 철회 요청"]');await page.waitForURL('**/infoOwner/form-interrupt?*',{timeout:15000});await wait('이 응답의 동의를 철회하시겠습니까?');
 const confirmationUrl=await page.url(),requestId=new URL(confirmationUrl).searchParams.get('request');
 await page.click('loc=role:button[name="철회 확정"]');await page.waitForURL('**/infoOwner/formComplete?*',{timeout:15000});
 await check('/infoOwner/formComplete','동의 철회가 완료되었습니다.');report.workflows.push('request-confirm-and-persisted-completion');
 const response=await page.fetch('/api/v1/subjects/me/withdrawals/'+requestId,{headers:{'X-Subject-Session':sessionId}});if(response.status!==200||JSON.parse(response.body).status!=='completed')throw Error('Committed withdrawal is missing');
 report.persistedResult={status:response.status,withdrawalStatus:'completed',requestSha256:hash(requestId)};
 await page.goto(confirmationUrl);await wait('동의 철회가 완료되었습니다.');if(await page.evaluate(()=>[...document.querySelectorAll('button')].some(e=>e.textContent==='철회 확정')))throw Error('Completed withdrawal reopened');report.workflows.push('completed-confirmation-cannot-reopen');
 await page.goto(fixture.origin+historyUrl.pathname);await wait(' 철회 완료');
 if(await page.evaluate(()=>[...document.querySelectorAll('button')].some(e=>e.textContent==='동의 철회 요청')))throw Error('Withdrawn consent offers another withdrawal');report.workflows.push('history-shows-withdrawn-without-repeat-action');
 report.result='passed';
}catch(error){report.result='failed';report.error=String(error);throw error;}
finally{await page.cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:instrument.identifier});await page.cdp('Emulation.clearDeviceMetricsOverride');await fs.writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log({result:report.result,routes:report.results.length,workflows:report.workflows.length});console.log(await page.snapshot());
