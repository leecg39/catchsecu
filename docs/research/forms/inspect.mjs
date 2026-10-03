const fs=await import('node:fs/promises');
const root='/Users/user01/Desktop/캐쳐시큐/catchsecu-clone';
const t=await taskSpace(29); const p=t.page('p2');
const manifest=JSON.parse(await fs.readFile(root+'/src/data/route-manifest.json','utf8')).filter(r=>r.path.startsWith('/form/')||r.path.startsWith('/basic/'));
const results=[];
await p.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
for(const r of manifest){
 if(r.dynamic){results.push({...r,inspection:'requires-real-record-no-id-observed'});continue;}
 await p.goto(r.sourceUrl);
 await p.waitForLoadState();
 const data=await p.evaluate(()=>{
 const props=['fontFamily','fontSize','fontWeight','lineHeight','color','backgroundColor','padding','margin','width','height','display','gap','gridTemplateColumns','border','borderRadius','position','transition'];
 return {url:location.href,text:document.body.innerText,dom:[...document.querySelectorAll('h1,h2,h3,button,input,select,textarea,[role="tab"], main, main div, .v-main *')].slice(0,500).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent?.trim().slice(0,150),placeholder:e.getAttribute('placeholder'),css:Object.fromEntries(props.map(x=>[x,getComputedStyle(e)[x]]))})),assets:[...document.images].map(e=>({src:e.src,alt:e.alt})),links:[...document.querySelectorAll('a')].map(e=>({text:e.textContent,href:e.href}))};});
 const slug=r.path.replaceAll('/','_').slice(1); await fs.writeFile(root+'/docs/research/forms/'+slug+'.json',JSON.stringify(data,null,2));
 await p.screenshot({path:root+'/docs/design-references/forms/'+slug+'-1440.png',fullPage:true});
 results.push({...r,actualUrl:data.url,inspection:data.url.endsWith('/dashboard')?'redirect-dashboard':'captured',textExcerpt:data.text.slice(-500)}); console.log(r.path,data.url,data.text.slice(-120));
}
await fs.writeFile(root+'/docs/research/forms/routes.json',JSON.stringify(results,null,2));
