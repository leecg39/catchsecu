import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {Client} from 'pg';
const url=new URL(process.env.DATABASE_URL),suffix=randomBytes(8).toString('hex');
assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.equal(url.pathname,'/catchsecu_test');
const client=new Client({connectionString:url.href}),fresh='qa_sms_fresh_'+suffix,upgrade='qa_sms_upgrade_'+suffix;
const dir='docs/qa/mock-completion/provider-attempts';await mkdir(dir,{recursive:true});
const report={checkedAt:new Date().toISOString(),scope:'fresh full installation and focused legacy receipt-table upgrade rehearsal',result:'incomplete'};
await client.connect();const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
try {
 await client.query('CREATE SCHEMA "'+fresh+'"');
 const target=new URL(url);target.searchParams.set('schema',fresh);
 const install=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:{...process.env,DATABASE_URL:target.href},encoding:'utf8'});
 await writeFile(dir+'/fresh-install.log',(install.stdout+install.stderr).replaceAll(target.href,'[redacted]'));
 assert.equal(install.status,0);
 const rows=(await client.query('SELECT migration_name,checksum FROM "'+fresh+'"."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows;
 const migrations=(await readdir('prisma/migrations')).filter(n=>/^\d/.test(n));assert.equal(rows.length,migrations.length);
 for(const row of rows)assert.equal(row.checksum,createHash('sha256').update(await readFile('prisma/migrations/'+row.migration_name+'/migration.sql')).digest('hex'));
 report.fresh={migrations:rows.length,checksumMismatches:0};
 await client.query('CREATE SCHEMA "'+upgrade+'"');await client.query('SET search_path TO "'+upgrade+'"');
 await client.query(`CREATE TABLE "CampaignDelivery"(id TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,UNIQUE("tenantId",id));
 CREATE TABLE "Job"("campaignDeliveryId" TEXT,"dedupeKey" TEXT,"createdAt" TIMESTAMP(3));
 CREATE TABLE "SmsReceipt"(id TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"deliveryId" TEXT NOT NULL,"receiptId" TEXT NOT NULL,status TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "SmsReceipt_delivery_fkey" FOREIGN KEY("deliveryId") REFERENCES "CampaignDelivery"(id) ON DELETE RESTRICT ON UPDATE CASCADE);
 CREATE UNIQUE INDEX "SmsReceipt_deliveryId_key" ON "SmsReceipt"("deliveryId");
 CREATE UNIQUE INDEX "SmsReceipt_receiptId_key" ON "SmsReceipt"("receiptId");`);
 for(const attempt of [1,2,3]) {
  const id='delivery-'+attempt;await client.query('INSERT INTO "CampaignDelivery" VALUES($1,$2)',[id,'synthetic-tenant']);
  for(let n=1;n<=attempt;n++)await client.query('INSERT INTO "Job" VALUES($1,$2,$3)',[id,'campaign:'+id+':'+n,'2026-10-01T00:00:00Z']);
  await client.query('INSERT INTO "Job" VALUES($1,$2,$3)',[id,'campaign:'+id+':5','2026-10-03T00:00:00Z']);
  await client.query('INSERT INTO "SmsReceipt" VALUES($1,$2,$3,$4,$5,$6)',['receipt-'+attempt,'synthetic-tenant',id,'provider-'+attempt,'failed','2026-10-02T00:00:00Z']);
 }
 const select='SELECT id,"tenantId","deliveryId","receiptId",status,"createdAt" FROM "SmsReceipt" ORDER BY id',before=(await client.query(select)).rows;
 await client.query(await readFile('prisma/migrations/20261017140000_sms_receipt_attempts/migration.sql','utf8'));
 const after=(await client.query(select)).rows;assert.deepEqual(after,before);
 assert.deepEqual((await client.query('SELECT attempt FROM "SmsReceipt" ORDER BY id')).rows.map(x=>x.attempt),[1,2,3]);
 let guards=0;
 for(const sql of ['UPDATE "SmsReceipt" SET status=\'unknown\'','DELETE FROM "SmsReceipt"']) {
  await assert.rejects(client.query(sql),error=>error.code==='23514');guards++;
 }
 await client.query(`INSERT INTO "SmsReceipt"(id,"tenantId","deliveryId",attempt,"receiptId",status,"createdAt") VALUES('retry-receipt','synthetic-tenant','delivery-1',2,'retry-provider','provider_accepted',now())`);
 await assert.rejects(client.query(`INSERT INTO "SmsReceipt"(id,"tenantId","deliveryId",attempt,"receiptId",status,"createdAt") VALUES('cross-tenant','other-tenant','delivery-1',3,'wrong-provider','failed',now())`),error=>error.code==='23503');guards++;
 report.upgrade={receiptsPreserved:before.length,priorFieldsSha256:hash(before),preserved:hash(before)===hash(after),attempts:[1,2,3],futureJobsIgnored:true,newAttemptInserted:true,guards};report.result='passed';
}finally {
 await client.query('SET search_path TO public');await client.query('DROP SCHEMA IF EXISTS "'+fresh+'" CASCADE');await client.query('DROP SCHEMA IF EXISTS "'+upgrade+'" CASCADE');await client.end();
 await writeFile(dir+'/migration-report.json',JSON.stringify(report,null,2)+'\n');
}
console.log(report);
