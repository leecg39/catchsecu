/* global taskSpace, root */
// Read-only auth entry smoke. Does not claim full authentication acceptance.
const fs = await import('node:fs/promises'), {join} = await import('node:path');
const fixture = JSON.parse(await fs.readFile(join(root,'.local/mock-page-fixtures.json'),'utf8'));
if (fixture.origin !== 'http://catchsecu-mock.localhost:3189') throw Error('Dedicated Mock origin required');
const task = await taskSpace(56); if (task.ownership !== 'agent') throw Error('Agent control required');
const page = task.page('p1'), dir=join(root,'.local/auth-entry-pages'), out=join(root,'docs/qa/mock-completion/auth-entry-pages');
await fs.mkdir(dir,{recursive:true}); await fs.mkdir(out,{recursive:true});
const entries = [
 ['/login','아직 계정이 없으신가요?'], ['/signup','회원가입'],
 ['/password-change-email','비밀번호 찾기'], ['/password-change-email/complete','이메일을 확인해주세요.'],
 ['/expire/code','인증 시간이 만료되었습니다.'], ['/login-failed','로그인에 실패했습니다.'],
 ['/gpki/fail','로그인에 실패했습니다.'], ['/saeol/fail/mock-org','로그인에 실패했습니다.'],
 ['/oauth2/fail','로그인에 실패했습니다.'], ['/login/saml/fail','로그인에 실패했습니다.'],
 ['/login/oauth2','회사 SSO 로그인'], ['/login/saml','회사 SSO 로그인'], ['/login/saml/start','회사 SSO 로그인'],
 ['/login/gpki','GPKI 조직 인증'], ['/login/saeol','새올 조직 인증'], ['/gwloginUser/login','그룹웨어 조직 인증'],
 ['/oauth2/signup','회원가입'],
 ['/two-step-setting','현재 비밀번호를 확인한 후 인증 앱을 등록합니다.'],
 ['/two-step','현재 비밀번호를 확인한 후 인증 앱을 등록합니다.'],
 ['/login-otp','인증 앱의 6자리 인증코드를 입력해주세요.'], ['/auth-code','인증 앱의 6자리 인증코드를 입력해주세요.'],
 ['/login-email','코드를 요청한 뒤 메일을 확인해주세요.'],
 ['/passwordChange','비밀번호 변경'], ['/password-change-rule','비밀번호 변경'],
 ['/not-allow-ip','허용되지 않은 IP 접근 제한'],
 ['/link/oauth2','의 내 SSO 연결 계정을 관리합니다.'], ['/link/oauth2/verified','의 내 SSO 연결 계정을 관리합니다.'],
 ['/logout','이 기기의 로그인 세션을 종료합니다.'],
];
const report = {checkedAt:new Date().toISOString(),browser:'Ego Lite',spaceId:56,
 scope:'read-only auth entry and explicit failure routes; no successful IdP acceptance or full workflow claim',
 realProviderAcceptance:false,results:[],workflows:[],result:'incomplete'};
const instrument = await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{window.__entryErrors=[];addEventListener('error',e=>window.__entryErrors.push(String(e.message)));addEventListener('unhandledrejection',e=>window.__entryErrors.push(String(e.reason)));const old=console.error;console.error=(...args)=>{window.__entryErrors.push(args.map(String).join(' '));old.apply(console,args);};})();`});
const wait = text => page.waitForFunction(text=>document.body.innerText.includes(text),text,{timeout:15000});
try {
 for (let index=0; index<entries.length; index++) {
  const [path,marker]=entries[index],r={path,marker,widths:[],result:'incomplete'};report.results.push(r);
  try {
   await page.goto(fixture.origin+'/dashboard',{waitUntil:'domcontentloaded'});
   await page.goto(fixture.origin+path,{waitUntil:'domcontentloaded'});await wait(marker);
   await page.waitForFunction(()=>!/인증 설정을 확인|비밀번호 정책을 확인|접근할 수 있는 회사를 불러오는/.test(document.body.innerText),undefined,{timeout:15000});
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
 await page.goto(fixture.origin+'/login',{waitUntil:'domcontentloaded'});await wait('아직 계정이 없으신가요?');
 await page.fill('input[name="password"]','Synthetic-visibility-only-2026');
 await page.click('button[aria-label="비밀번호 표시 전환"]');
 if(await page.evaluate(()=>document.querySelector('input[name="password"]').type)!=='text')throw Error('Password visibility did not change');
 await page.click('button[aria-label="비밀번호 표시 전환"]');
 if(await page.evaluate(()=>document.querySelector('input[name="password"]').type)!=='password')throw Error('Password masking did not return');
 report.workflows.push('login-password-toggle-and-remask');
 await page.goto(fixture.origin+'/login/oauth2',{waitUntil:'domcontentloaded'});await wait('회사 SSO 로그인');
 await page.fill('input[name="ssoAddress"]','https://outside.example.test/login');
 await page.click('loc=role:button[name="회사 계정으로 로그인"]');await wait('현재 사이트의 회사 SSO 로그인 주소');
 if(new URL(await page.url()).pathname!=='/login/oauth2')throw Error('Off-origin SSO navigation escaped');
 report.workflows.push('off-origin-sso-address-denied-with-input-preserved');
 if(await page.evaluate(()=>document.querySelector('input[name="ssoAddress"]').value)!=='https://outside.example.test/login')throw Error('Rejected SSO input was lost');
 await page.goto(fixture.origin+'/login-otp',{waitUntil:'domcontentloaded'});await wait('인증 앱의 6자리 인증코드를 입력해주세요.');
 await page.fill('input[name="code"]','abcdef');
 if(!await page.evaluate(()=>document.querySelector('input[name="code"]').validity.patternMismatch))throw Error('OTP accepted non-digits');
 await page.click('loc=role:button[name="복구코드 사용"]');await wait('일회용 복구코드를 입력해주세요.');
 if(!await page.evaluate(()=>{const e=document.querySelector('input[name="code"]');return e.value===''&&e.maxLength===30&&e.inputMode==='text';}))throw Error('Recovery code mode did not reset OTP');
 await page.click('loc=role:button[name="인증코드 사용"]');await wait('인증 앱의 6자리 인증코드를 입력해주세요.');
 if(!await page.evaluate(()=>{const e=document.querySelector('input[name="code"]');return e.maxLength===6&&e.inputMode==='numeric';}))throw Error('OTP mode did not return');
 report.workflows.push('otp-digits-and-recovery-mode-reset');
 report.result=report.results.every(r=>r.result==='passed')?'passed':'failed';
}catch(cause){report.result='failed';report.error=String(cause);throw cause;}
finally {
 await page.cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:instrument.identifier});
 await page.cdp('Emulation.clearDeviceMetricsOverride');
 await fs.writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
}
console.log({result:report.result,routes:report.results.length,failed:report.results.filter(r=>r.result!=='passed').map(r=>r.path)});
console.log(await page.snapshot());
if(report.result!=='passed')throw Error('Auth entry page smoke failed');
