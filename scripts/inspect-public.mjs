const task=await taskSpace(29);const p=task.page('p1');
const fs=await import('node:fs/promises');
const root='/Users/user01/Desktop/캐쳐시큐/catchsecu-clone';
const props=['fontSize','fontWeight','fontFamily','lineHeight','letterSpacing','color','backgroundColor','padding','margin','width','height','maxWidth','minWidth','display','flexDirection','justifyContent','alignItems','gap','borderRadius','border','boxShadow','overflow','position','top','right','bottom','left','zIndex','transition'];
for(const width of [1440,768,390]){
 await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
 const data=await p.evaluate(props=>({url:location.href,bodyWidth:document.body.scrollWidth,html:document.querySelector('#root').outerHTML,links:[...document.querySelectorAll('link')].map(x=>({rel:x.rel,href:x.href})),nodes:[...document.querySelectorAll('#root *')].map(e=>({tag:e.tagName,cls:typeof e.className==='string'?e.className:'',text:e.childElementCount===0?e.textContent:null,rect:e.getBoundingClientRect().toJSON(),css:Object.fromEntries(props.map(k=>[k,getComputedStyle(e)[k]]))}))}),props);
 await fs.writeFile(root+'/docs/research/app.catchsecu.com/login-'+width+'.json',JSON.stringify(data,null,2));
 await p.screenshot({path:root+'/docs/design-references/app.catchsecu.com/login-'+width+'.png',fullPage:true});
}
await p.cdp('Emulation.clearDeviceMetricsOverride');console.log('로그인 1440/768/390 추출 완료');console.log(await p.snapshot());
