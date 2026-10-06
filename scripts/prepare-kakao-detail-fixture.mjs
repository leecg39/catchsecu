/* global taskSpace, root */
const fs=await import('node:fs/promises');const {join}=await import('node:path');
const f=JSON.parse(await fs.readFile(join(root,'.local/mock-page-fixtures.json'),'utf8'));
if(f.origin!=='http://catchsecu-mock.localhost:3189')throw Error('Dedicated Mock origin required');
const task=await taskSpace(56);if(task.ownership!=='agent')throw Error('Agent control required');const page=task.page('p1');
const response=await page.fetch('/api/v1/context');if(response.status!==200)throw Error('Mock owner session required');
if(JSON.parse(response.body).company.id!==f.companyId)throw Error('Wrong Mock company');
async function post(path,input){const response=await page.fetch('/api/v1'+path,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(input)});if(!response.ok)throw Error(path+' failed: '+response.status);return JSON.parse(response.body);}
const suffix=Date.now().toString(36);
const channel=await post('/kakao/channels',{serviceId:f.serviceId,name:'Mock 템플릿 QA 채널',searchId:'@mock'+suffix});await post('/kakao/channels/'+channel.id+'/verify',{});
const template=await post('/kakao/templates',{serviceId:f.serviceId,channelId:channel.id,name:'Mock 템플릿 '+suffix,body:'#{name}님 접수 안내',buttons:[{name:'확인',type:'WL',link:'https://example.test/receipt'}]});
const approved=await post('/kakao/templates/'+template.id+'/submit',{version:template.version});if(approved.status!=='approved')throw Error('Mock approval required');
await fs.writeFile(join(root,'.local/kakao-detail-fixture.json'),JSON.stringify({origin:f.origin,channelId:channel.id,templateId:template.id,name:template.name},null,2),{mode:0o600});
console.log({fixtureCreated:true,channelVerified:true,templateStatus:approved.status});
