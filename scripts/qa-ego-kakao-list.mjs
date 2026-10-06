/* global taskSpace, root */
const fs = await import('node:fs/promises');
const { join } = await import('node:path');
const fixture = JSON.parse(await fs.readFile(join(root, '.local/kakao-detail-fixture.json'), 'utf8'));
if (fixture.origin !== 'http://catchsecu-mock.localhost:3189') throw Error('Dedicated Mock origin required');
const task = await taskSpace(56); if (task.ownership !== 'agent') throw Error('Agent control required');
const page = task.page('p1'), dir = join(root, '.local/kakao-list-ui'), out = join(root, 'docs/qa/mock-completion/kakao-review-state');
await fs.mkdir(dir, { recursive: true }); await fs.mkdir(out, { recursive: true });
const report = { checkedAt: new Date().toISOString(), browser: 'Ego Lite', spaceId: 56, mockProvider: true, realProviderAcceptance: false, checks: [], viewports: [], result: 'incomplete' };
const waitText = text => page.waitForFunction(text => document.body.innerText.includes(text), text, { timeout: 15000 });
const click = async text => page.evaluate(text => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text); if (!button || button.matches(':disabled')) throw Error('Unavailable button ' + text); button.click(); }, text);
let instrumentation;
try {
  const response = await page.fetch('/api/v1/kakao/channels/' + fixture.channelId); if (response.status !== 200) throw Error('Owner session required');
  const channel = JSON.parse(response.body);
  await page.goto(fixture.origin + '/alimtalk/templates', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.querySelector('input[aria-label="채널 이름"]') && !document.querySelector('input[aria-label="채널 이름"]').matches(':disabled'), undefined, { timeout: 15000 });
  await page.fill('input[aria-label="채널 이름"]', '보존할 채널 입력'); await page.fill('input[aria-label="채널 검색용 아이디"]', channel.searchId); await click('채널 등록'); await waitText('같은 카카오 채널');
  if (!await page.evaluate(searchId => document.querySelector('input[aria-label="채널 이름"]').value === '보존할 채널 입력' && document.querySelector('input[aria-label="채널 검색용 아이디"]').value === searchId, channel.searchId)) throw Error('Failed registration lost draft');
  report.checks.push('channel-conflict-preserves-input');
  await page.fill('input[aria-label="채널 검색용 아이디"]', 'bad!'); await click('채널 등록'); await waitText('채널 검색용 아이디는 @'); report.checks.push('invalid-channel-identity-rejected');
  await page.selectOption('select[aria-label="템플릿 채널"]', fixture.channelId);
  const name = 'Mock 응답 유실 ' + Date.now().toString(36), body = '응답이 유실되어도 유지할 내용';
  await page.fill('input[aria-label="템플릿 이름"]', name); await page.fill('textarea[aria-label="템플릿 본문"]', body);
  await page.evaluate(() => {
    window.__qaOriginalFetch = window.fetch; window.__qaKakaoAttempts = []; let lost = false;
    window.fetch = async (url, init) => {
      if (url === '/api/v1/kakao/templates' && init?.method === 'POST') {
        window.__qaKakaoAttempts.push({ key: init.headers['Idempotency-Key'], body: init.body });
        const response = await window.__qaOriginalFetch(url, init);
        if (!lost && response.ok) { lost = true; throw new TypeError('Mock response lost after server acceptance'); }
        return response;
      }
      return window.__qaOriginalFetch(url, init);
    };
    const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '초안 저장'); button.click(); button.click();
  });
  await waitText('Mock response lost after server acceptance');
  const preserved = await page.evaluate(() => ({ name: document.querySelector('input[aria-label="템플릿 이름"]').value, body: document.querySelector('textarea[aria-label="템플릿 본문"]').value, count: window.__qaKakaoAttempts.length }));
  if (preserved.name !== name || preserved.body !== body || preserved.count !== 1) throw Error('Lost response or double click failed');
  report.checks.push('double-click-dispatches-once', 'accepted-response-loss-preserves-input');
  await click('초안 저장'); await waitText('템플릿 초안을 저장했습니다.');
  if (!await page.evaluate(() => window.__qaKakaoAttempts.length === 2 && window.__qaKakaoAttempts[0].key === window.__qaKakaoAttempts[1].key && window.__qaKakaoAttempts[0].body === window.__qaKakaoAttempts[1].body && document.querySelector('input[aria-label="템플릿 이름"]').value === '' && document.querySelector('textarea[aria-label="템플릿 본문"]').value === '')) throw Error('Retry key or successful reset failed');
  const list = await page.fetch('/api/v1/kakao/templates?serviceId=' + channel.serviceId); if (list.status !== 200 || JSON.parse(list.body).items.filter(row => row.name === name).length !== 1) throw Error('Retry created duplicates');
  report.checks.push('retry-reuses-identical-idempotency-key', 'one-server-template-after-retry', 'success-clears-template-input');
  await page.evaluate(() => { window.fetch = window.__qaOriginalFetch; delete window.__qaOriginalFetch; delete window.__qaKakaoAttempts; });
  for (const path of ['/alimtalk', '/alimtalk/templates']) {
    await page.goto(fixture.origin + path, { waitUntil: 'domcontentloaded' }); await waitText(channel.name); if (new URL(await page.url()).pathname !== path) throw Error('Unexpected route redirect');
    for (const width of [1440, 768, 390]) {
      await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      await page.screenshot({ path: join(dir, path === '/alimtalk' ? 'channels-' + width + '.png' : 'templates-' + width + '.png') });
      report.viewports.push({ path, width, overflow }); if (overflow) throw Error('List overflow at ' + width);
    }
  }
  instrumentation = await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const original=window.fetch;let failed=false;window.fetch=(url,init)=>{if(!failed&&typeof url==='string'&&url.startsWith('/api/v1/kakao/channels?')){failed=true;return Promise.resolve(new Response(JSON.stringify({error:{code:'MOCK_FAILURE',message:'Mock 채널 목록 조회 실패'}}),{status:503,headers:{'Content-Type':'application/json'}}));}return original(url,init);};})();` });
  await page.reload({ waitUntil: 'domcontentloaded' }); await waitText('Mock 채널 목록 조회 실패');
  if (!await page.evaluate(() => document.querySelector('input[aria-label="채널 이름"]').matches(':disabled') && document.querySelector('textarea[aria-label="템플릿 본문"]').matches(':disabled'))) throw Error('Failed list did not lock registration');
  report.checks.push('list-failure-shows-error-and-locks-registration'); await click('채널 다시 불러오기'); await waitText(channel.name);
  await page.waitForFunction(() => !document.querySelector('input[aria-label="채널 이름"]').matches(':disabled'), undefined, { timeout: 15000 });
  report.checks.push('list-retry-recovers-registration'); report.result = 'passed'; console.log(report);
} catch (cause) { report.error = String(cause); throw cause; }
finally {
  if (instrumentation) await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: instrumentation.identifier });
  await page.cdp('Emulation.clearDeviceMetricsOverride'); await fs.writeFile(join(out, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(await page.snapshot({ scope: 'full_page' }));
