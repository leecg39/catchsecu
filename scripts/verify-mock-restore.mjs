import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir, lstat, cp, chmod } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
assert.ok([22,24].includes(Number(process.versions.node.split('.')[0])), 'Use supported Node22/24');
const config = parseEnv(await readFile('.local/mock-admin.env','utf8'));
const fixture = JSON.parse(await readFile('.local/mock-page-fixtures.json','utf8'));
const source = new URL(config.DATABASE_URL);
assert.equal(source.pathname,'/catchsecu_mock_admin');
assert.ok(['localhost','127.0.0.1'].includes(source.hostname));
assert.equal(source.port || '5432','5432', 'Local admin socket and source must use the same port');
assert.equal(fixture.storage,resolve('.local/mock-page-storage'));
assert.ok(Date.parse(fixture.viewer.expiresAt) > Date.now() + 60000, 'Refresh Mock page fixtures first');
const targetName = 'catchsecu_mock_restore_' + randomBytes(4).toString('hex');
const target = new URL(source); target.pathname = '/'+targetName;
const folder=resolve('.local/mock-restores',targetName), evidence=resolve(process.env.MOCK_RESTORE_EVIDENCE_DIR??'docs/qa/mock-completion/restore');
assert.ok(evidence.startsWith(resolve('docs/qa/mock-completion')+'/'),'Evidence must stay in the Mock QA folder');
await mkdir(folder,{recursive:true,mode:0o700}); await mkdir(evidence,{recursive:true});
const report={checkedAt:new Date().toISOString(), result:'running', evidenceLevel:'local mock logical database/object restore', externalPitrVerified:false, sourceDatabase:source.pathname.slice(1),targetDatabase:targetName,privateBackup:folder,steps:[]};
const save=()=>writeFile(join(evidence,'report.json'),JSON.stringify(report,null,2)+'\n'); await save();
function command(name,bin,args,env=process.env){
 const r=spawnSync(bin,args,{env,encoding:'utf8',maxBuffer:32*1024*1024});
 report.steps.push({name,exitCode:r.status});
 if(r.status!==0) throw Error(name+' failed ('+(r.error?.code??r.status)+'); no credentials or SQL rows logged');
 return r.stdout;
}
const pgEnv={...process.env,PGHOST:source.hostname,PGPORT:source.port||'5432',PGUSER:decodeURIComponent(source.username),PGPASSWORD:decodeURIComponent(source.password),PGDATABASE:source.pathname.slice(1)};
const hash=s=>createHash('sha256').update(s).digest('hex');
async function snapshot(url){
 const c=new pg.Client({connectionString:url.href}); await c.connect();
 try{
  const names=(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename);
  const tables={};
  for(const name of names){const q='"'+name.replaceAll('"','""')+'"';const r=await c.query(`SELECT row_to_json(t)::text AS row FROM ${q} t ORDER BY row_to_json(t)::text`); tables[name]={rows:r.rowCount,sha256:hash(r.rows.map(r=>r.row).join('\n'))};}
  const schema=(await c.query(`SELECT 'column' AS kind, table_name||'.'||column_name AS key, data_type||':'||udt_name||':'||is_nullable||':'||coalesce(column_default,'') AS value FROM information_schema.columns WHERE table_schema='public'
    UNION ALL SELECT 'constraint', cl.relname||'.'||co.conname, pg_get_constraintdef(co.oid,true) FROM pg_constraint co JOIN pg_class cl ON cl.oid=co.conrelid JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE n.nspname='public'
    UNION ALL SELECT 'index',tablename||'.'||indexname,indexdef FROM pg_indexes WHERE schemaname='public'
    UNION ALL SELECT 'function',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p')
    UNION ALL SELECT 'trigger',cl.relname||'.'||t.tgname,pg_get_triggerdef(t.oid,true) FROM pg_trigger t JOIN pg_class cl ON cl.oid=t.tgrelid JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
    UNION ALL SELECT 'enum',t.typname,string_agg(e.enumlabel,',' ORDER BY e.enumsortorder) FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' GROUP BY t.typname ORDER BY 1,2`)).rows;
  const migrations=(await c.query('SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows[0].n;
  const sequences=(await c.query("SELECT sequencename,start_value,min_value,max_value,increment_by,cycle,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows;
  return {tables,sequences,schemaEntries:schema.length,schemaSha256:hash(JSON.stringify(schema)),migrations};
 } finally{await c.end();}
}
async function files(root){
 const found={};
 async function visit(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name),stat=await lstat(path);assert.ok(!stat.isSymbolicLink(),'Mock storage must not contain symlinks');if(stat.isDirectory())await visit(path);else if(stat.isFile())found[path.slice(root.length+1)]=hash(await readFile(path));}}
 await visit(root); return Object.fromEntries(Object.entries(found).sort(([a],[b])=>a.localeCompare(b)));
}
try{
 const before=await snapshot(source), filesBefore=await files(fixture.storage);
 assert.ok(Object.keys(filesBefore).length>0,'Mock fixture objects required');
 const dump=join(folder,'database.dump');
 command('logical backup','pg_dump',['--format=custom','--no-owner','--no-acl','--file',dump],pgEnv); await chmod(dump,0o600);
 // Administrative connection uses the local OS account; never reuses app credentials.
 const adminEnv={...process.env};for(const k of Object.keys(adminEnv))if(k.startsWith('PG'))delete adminEnv[k];
 command('create isolated target','createdb',['--owner',decodeURIComponent(source.username),targetName],adminEnv);
 command('restore database','pg_restore',['--no-owner','--no-acl','--exit-on-error','--dbname',targetName,dump],{...pgEnv,PGDATABASE:targetName});
 const storage=join(folder,'storage');await cp(fixture.storage,storage,{recursive:true,errorOnExist:true,force:false});
 const restored=await snapshot(target), after=await snapshot(source), filesAfter=await files(fixture.storage), restoredFiles=await files(storage);
 assert.deepEqual(after,before,'Source database changed during backup');assert.deepEqual(restored,before,'Restored database differs');
 assert.deepEqual(filesAfter,filesBefore,'Source objects changed');assert.deepEqual(restoredFiles,filesBefore,'Restored objects differ');
 report.database=before;report.restoredDataEqual=true;report.sourceUnchanged=true;report.objects={count:Object.keys(filesBefore).length,sha256:hash(JSON.stringify(filesBefore)),restoredEqual:true};report.backupSha256=hash(await readFile(dump));await save();
 const apiReport=join(evidence,'api.json'); await writeFile(apiReport,'null\n');
 command('application reads in restored database',process.execPath,['--import','tsx','scripts/verify-mock-restored-data.ts'],{...process.env,...config,DATABASE_URL:target.href,BETTER_AUTH_URL:fixture.origin,PRIVATE_STORAGE_DIR:storage,FILE_STORAGE:'local',MAIL_TRANSPORT:'local',PAYMENT_PROVIDER:'local',MOCK_RESTORE_API_REPORT:apiReport});
 report.application=JSON.parse(await readFile(apiReport,'utf8'));
 assert.deepEqual(await snapshot(source),before,'Source changed during restored application operations');
 assert.deepEqual(await files(fixture.storage),filesBefore,'Source objects changed during restored destruction');
 report.sourceUnchangedAfterRestoredDestruction=true;report.result='passed';
} catch(error){report.result='failed';report.error=error instanceof assert.AssertionError?'Verification assertion failed':String(error.message);throw error;}
finally{report.finishedAt=new Date().toISOString();await save();}
console.log(JSON.stringify({result:report.result,migrations:report.database.migrations,tables:Object.keys(report.database.tables).length,objects:report.objects.count,applicationChecks:report.application.checks.length}));
