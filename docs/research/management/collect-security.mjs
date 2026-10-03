const fs=await import('node:fs/promises');
const root='/Users/user01/Desktop/캐쳐시큐/catchsecu-clone';
const routes=JSON.parse(await fs.readFile(root+'/src/data/route-manifest.json','utf8')).filter(r=>/^\/security(\/|$)/.test(r.path));
const task=await taskSpace(29),page=task.page('p3');
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
for(const route of routes){
 const slug=route.path.slice(1).replaceAll('/','--');
 await page.goto(route.sourceUrl);
 await page.waitForLoadState();
 const data=await page.evaluate(()=>{const props=['fontFamily','fontSize','fontWeight','lineHeight','color','backgroundColor','padding','margin','width','height','display','gap','border','borderRadius','boxShadow','position','overflow','minWidth','maxWidth','transition']; const els=[...document.body.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height});return {url:location.href,text:document.body.innerText,viewport:{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth},elements:els.map(e=>({tag:e.tagName,cls:typeof e.className==='string'?e.className:'',text:e.children.length===0?e.textContent:null,style:Object.fromEntries(props.map(k=>[k,getComputedStyle(e)[k]])),rect:{x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}})),assets:[...document.images].map(i=>({src:i.src,alt:i.alt})),links:[...document.querySelectorAll('a')].map(a=>({text:a.innerText,href:a.href}))}});
 await fs.writeFile(root+'/docs/research/management/'+slug+'.json',JSON.stringify(data,null,2));
 await page.screenshot({path:root+'/docs/design-references/management/'+slug+'.png',fullPage:true});
 console.log(JSON.stringify({path:route.path,url:data.url,text:data.text.slice(-3300)}));
}
