const fs=await import('node:fs/promises');const root='/Users/user01/Desktop/캐쳐시큐/catchsecu-clone';const p=(await taskSpace(29)).page('p2');
async function capture(name){const data=await p.evaluate(()=>{const props=['fontFamily','fontSize','fontWeight','lineHeight','color','backgroundColor','padding','margin','width','height','minWidth','maxWidth','display','gap','gridTemplateColumns','border','borderRadius','position','transition'];return {url:location.href,text:document.body.innerText,dom:[...document.querySelectorAll('#root *')].filter(e=>e.getBoundingClientRect().width>0).map(e=>({tag:e.tagName,cls:e.className?.toString(),text:e.childElementCount<2?e.textContent?.trim().slice(0,300):null,css:Object.fromEntries(props.map(x=>[x,getComputedStyle(e)[x]]))})),assets:[...document.images].map(e=>({src:e.src,alt:e.alt}))}});await fs.writeFile(root+'/docs/research/forms/'+name+'.json',JSON.stringify(data,null,2));await p.screenshot({path:root+'/docs/design-references/forms/'+name+'.png',fullPage:true});}
await capture('template-detail-1440');
await p.mouse.move(1100,750);await p.mouse.wheel(0,600);await capture('template-scroll');
await p.click('loc=css:[role="tab"] >> nth=1');await capture('template-company-tab');
await p.click('loc=css:[role="tab"] >> nth=0');
for(const width of [768,390]){await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await capture('template-detail-'+width);}
await p.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
for(const [path,ready,name] of [['/form/manage','데이터가 없습니다','manage'],['/form/fixed-url','고정URL 생성','fixed-url'],['/form/ai/basic-frame','항목 추가하기','basic-frame'],['/form/info-upload','라이선스 알아보기','upload'],['/basic/result/consent','접근할 수 없습니다.','consent-gate']]){
 await p.goto('https://app.catchsecu.com'+path);await p.waitForFunction(t=>document.body.innerText.includes(t),ready,{timeout:15000});
 for(const width of [1440,768,390]){await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await capture(name+'-detail-'+width);}
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
}
console.log('detail captures complete');
