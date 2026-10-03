const fs=await import('node:fs/promises');
const root='/Users/user01/Desktop/캐쳐시큐/catchsecu-clone';
const task=await taskSpace(29);const page=task.page('p4');
const routes=JSON.parse(await fs.readFile(root+'/src/data/route-manifest.json','utf8')).filter(x=>/^\/(sms|mail|alimtalk|kakao-playground|integration|pay|bill|creditBill)(\/|$)/.test(x.path));
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
const results=[];
for(const route of routes){
 if(route.dynamic||route.path==='/pay/cancel'){results.push({...route,observed:false,reason:route.dynamic?'실제 ID 필요':'취소 작업 안전상 미접속'});continue;}
 await page.goto(route.sourceUrl);
 try { await page.waitForFunction(()=>document.body.innerText.length>100,undefined,{timeout:6000}); } catch(error) { console.log('내용 대기 실패',route.path); }
 const data=await page.evaluate(()=>{
 const props=['fontFamily','fontSize','fontWeight','lineHeight','color','backgroundColor','padding','margin','width','height','display','position','gap','border','borderRadius','boxShadow','transition','minWidth','maxWidth','overflow'];
 const elements=[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height);
 return {url:location.href,text:document.body.innerText,viewport:{width:innerWidth,height:innerHeight},elements:elements.map(e=>({tag:e.tagName,cls:e.className?.toString(),text:e.children.length?null:e.textContent,styles:Object.fromEntries(props.map(p=>[p,getComputedStyle(e)[p]])),rect:{x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}})),images:[...document.images].map(e=>({src:e.currentSrc,alt:e.alt})),svgs:[...document.querySelectorAll('svg')].map(e=>e.outerHTML)};
 });
 const slug=route.path.slice(1).replaceAll('/','__');
 await fs.writeFile(root+'/docs/research/services/'+slug+'.json',JSON.stringify(data,null,2));
 await page.screenshot({path:root+'/docs/design-references/services/'+slug+'-1440.png',fullPage:true});
 results.push({...route,observed:true,resolvedUrl:data.url,restricted:data.text.includes('접근할 수 없습니다'),text:data.text.split('MY').pop().slice(0,1600)});
 console.log(route.path, data.url, data.text.split('MY').pop().slice(0,350));
 await fs.writeFile(root+'/docs/research/services/routes.json',JSON.stringify(results,null,2));
}
