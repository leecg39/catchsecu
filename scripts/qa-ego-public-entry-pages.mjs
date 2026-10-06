/* global taskSpace, root */
// Read-only public/system entry smoke; original reference acceptance remains separate.
const fs = await import('node:fs/promises'), {join} = await import('node:path');
const fixture = JSON.parse(await fs.readFile(join(root,'.local/mock-page-fixtures.json'),'utf8'));
if (fixture.origin !== 'http://catchsecu-mock.localhost:3189') throw Error('Dedicated Mock origin required');
const task = await taskSpace(56); if (task.ownership !== 'agent') throw Error('Agent control required');
const page = task.page('p1'), dir=join(root,'.local/public-entry-pages'), out=join(root,'docs/qa/mock-completion/public-entry-pages');
await fs.mkdir(dir,{recursive:true}); await fs.mkdir(out,{recursive:true});
const entries = [
 ['/','대시보드'], ['/IE','대시보드'], ['/service/none','서비스 접근 권한'],
 ['/access-not-allow','권한이 없습니다.'], ['/help-center','캐치시큐 사용에 도움이 되는 가이드'],
 ['/infoOwner/find','답변하신 정보로 동의이력을 조회하실 수 있습니다.'],
 ['/infoOwner/find/complete','입력하신 이름과 이메일로 동의한 이력이 있다면'],
 ['/shared-privacy/verify','외부 열람자로 초대 받은 메일의 정보로'],
 ['/shared-privacy/email-verify','초대 정보가 일치하면 인증 메일이 전송됩니다.'],
 ['/kakao-playground','카카오 알림톡 미리보기 컴포넌트'],
 ['/pay/plus/fail/mock_declined','주문이 완료되지 않았습니다.'],
];
const noticeResponse=await page.fetch('/api/v1/notices?scope=published&pageSize=1');
if(noticeResponse.status!==200)throw Error('Published notice fixture lookup failed');
const notice=JSON.parse(noticeResponse.body).items[0];
if(!notice)throw Error('Published notice fixture required; do not invent an id');
entries.push(['/notice/'+notice.id,notice.title]);
const report = {checkedAt:new Date().toISOString(),browser:'Ego Lite',spaceId:56,
 scope:'read-only public/system entries; success data only for existing published notice; no complete consent/sharing/payment acceptance claim',
 realProviderAcceptance:false,results:[],workflows:[],result:'incomplete'};
const instrument = await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{window.__entryErrors=[];addEventListener('error',e=>window.__entryErrors.push(String(e.message)));addEventListener('unhandledrejection',e=>window.__entryErrors.push(String(e.reason)));const old=console.error;console.error=(...args)=>{window.__entryErrors.push(args.map(String).join(' '));old.apply(console,args);};})();`});
const wait = text => page.waitForFunction(text=>document.body.innerText.includes(text),text,{timeout:15000});
try {
 for (let index=0; index<entries.length; index++) {
  const [path,marker]=entries[index],r={path,marker,widths:[],result:'incomplete'};report.results.push(r);
  try {
   await page.goto(fixture.origin+'/dashboard',{waitUntil:'domcontentloaded'});
   await page.goto(fixture.origin+path,{waitUntil:'domcontentloaded'});await wait(marker);
   await page.waitForFunction(()=>!/인증 설정을 확인|비밀번호 정책을 확인|접근할 수 있는 회사를 불러오는|집계 중|집계를 불러오는|가이드를 불러오는|회사와 서비스 권한을 확인하는|요청 내역을 불러오는|현재 계정과 회사 권한을 확인하는/.test(document.body.innerText),undefined,{timeout:15000});
   r.pathMatches=new URL(await page.url()).pathname===path;
   for(const width of [1440,768,390]) {
    await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const state=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
     errors:window.__entryErrors||[],alerts:[...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent),
     failedResources:performance.getEntriesByType('resource').filter(r=>r.responseStatus>=400).map(r=>({status:r.responseStatus,path:new URL(r.name).pathname}))}));
    r.widths.push({width,overflow:state.overflow,errorCount:state.errors.length,alertCount:state.alerts.length,failedResources:state.failedResources});
    await page.screenshot({path:join(dir,index+'-'+width+'.png')});
   }
   await fs.writeFile(join(dir,index+'-snapshot.txt'),await page.snapshot({scope:'full_page'}));
   await page.reload({waitUntil:'domcontentloaded'});await wait(marker);r.reload=true;
   await page.evaluate(()=>history.back());await page.waitForURL('**/dashboard',{timeout:15000});r.back=true;
   r.result=r.pathMatches&&r.widths.every(w=>!w.overflow&&!w.errorCount&&!w.alertCount&&!w.failedResources.length)?'passed':'failed';
  }catch(cause){r.result='failed';r.error=String(cause);}
  await fs.writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log({path,result:r.result});
 }
 await page.goto(fixture.origin+'/loading',{waitUntil:'domcontentloaded'});
 await page.waitForURL('**/dashboard',{timeout:15000});report.workflows.push('loading-transition-uses-current-authority-and-redirects-dashboard');
 await page.goto(fixture.origin+'/shared-privacy/email-verify',{waitUntil:'domcontentloaded'});await wait('초대 정보가 일치하면 인증 메일이 전송됩니다.');
 await page.evaluate(()=>sessionStorage.removeItem('catchsecu.viewer.challenge'));
 await page.fill('input[placeholder="6자리 인증코드"]','123456');
 await page.click('loc=role:button[name="인증 확인"]');await wait('인증 요청이 없거나 10분이 지났습니다.');
 report.workflows.push('shared-email-verification-without-challenge-is-denied');
 report.result=report.results.every(r=>r.result==='passed')?'passed':'failed';
}catch(cause){report.result='failed';report.error=String(cause);throw cause;}
finally {
 await page.cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:instrument.identifier});
 await page.cdp('Emulation.clearDeviceMetricsOverride');
 await fs.writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
}
console.log({result:report.result,routes:report.results.length,failed:report.results.filter(r=>r.result!=='passed').map(r=>r.path)});
console.log(await page.snapshot());
if(report.result!=='passed')throw Error('Public entry page smoke failed');
