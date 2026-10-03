import { strict as assert } from "node:assert";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { sha256 } from "../src/server/pdf-renderer";
const url = new URL(env.DATABASE_URL);
assert.equal(url.pathname, "/catchsecu_dev"); assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
const run = promisify(execFile), directory = "docs/qa/document-pdf/", tenantId = "1cf0bbc4-be6a-48c5-976a-9edfe2e093dc";
const scenarios = [
  { title:"문서 브라우저 QA 동의서 2026-10-02",number:1,file:"browser-document-v1.pdf" },
  { title:"문서 브라우저 QA 동의서 2026-10-02",number:3,file:"browser-document-v3.pdf" },
  { title:"문서 브라우저 QA 동의서 2026-10-02",number:3,file:"browser-public-v3.pdf" },
  { title:"PDF 여러 페이지 QA 2026-10-03",number:1,file:"browser-multipage.pdf" },
];
const evidence=[];
for (const scenario of scenarios) {
  const version=await db.documentVersion.findFirstOrThrow({where:{tenantId,number:scenario.number,document:{title:scenario.title}},include:{pdf:true}});
  assert.ok(version.pdf); const bytes=await readFile(directory+scenario.file);
  assert.equal(sha256(bytes),version.pdf.pdfHash);assert.deepEqual(new Uint8Array(bytes),version.pdf.bytes);
  const result=await run("/Users/user01/homebrew/bin/pdftotext",["-layout",directory+scenario.file,"-"]);
  const text=result.stdout, normalized=text.replace(/v\d+\s*\|\s*\d+\s*\/\s*\d+/g,"").replace(/\s/g,"");
  assert.ok(normalized.includes(version.contentHash));
  assert.ok(normalized.includes(version.renderedText.replace(/\s/g,"")), "PDF 본문 전체 대조 실패: "+scenario.file);
  assert.match(text,new RegExp("게시 버전 v"+scenario.number));
  const fonts=await run("/Users/user01/homebrew/bin/pdffonts",[directory+scenario.file]);
  assert.match(fonts.stdout,/NotoSansCJKkr-Regular.*yes\s+yes\s+yes/);
  const info=await run("/Users/user01/homebrew/bin/pdfinfo",[directory+scenario.file]);
  assert.equal(Number(info.stdout.match(/Pages:\s+(\d+)/)?.[1]),version.pdf.pageCount);
  await writeFile(directory+scenario.file.replace(/\.pdf$/,".txt"),text);
  await writeFile(directory+scenario.file.replace(/\.pdf$/,"-fonts.txt"),fonts.stdout);
  evidence.push({file:scenario.file,version:scenario.number,bytes:bytes.length,pages:version.pdf.pageCount,pdfHash:version.pdf.pdfHash,contentHash:version.contentHash,embeddedFont:true,exactSourceText:true});
}
assert.equal(evidence[1].pdfHash,evidence[2].pdfHash); assert.ok(evidence[3].pages>=3);
assert.ok((await readFile(directory+"browser-document-v1.txt","utf8")).includes("<script>window.__documentXss=1</script>"));
await writeFile(directory+"file-verification.json",JSON.stringify({checkedAt:new Date().toISOString(),result:"PASS",files:evidence},null,2)+"\n");
console.log(JSON.stringify({result:"PASS",files:evidence.length,pages:evidence.map(item=>item.pages)}));await db.$disconnect();
