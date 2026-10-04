import { db } from "../src/server/db";
import { decrypt } from "../src/server/crypto";
import { env } from "../src/server/env";
const base = new URL(env.BETTER_AUTH_URL).origin;
const pubs = await db.documentPublication.findMany({where:{tenantId:"10000000-0000-4000-8000-000000000001"},select:{id:true,status:true,tokenCipher:true},take:3});
const out: Record<string,unknown> = {count:pubs.length};
for (const [i,p] of pubs.entries()) {
  const token = decrypt(p.tokenCipher);
  const rec: Record<string,unknown> = {};
  for (const k of ["P","C","OC"]) rec[k+"_page"] = (await fetch(`${base}/document/${k}/${token}`,{redirect:"manual"})).status;
  const apiRes = await fetch(`${base}/api/v1/public/documents/${token}`);
  rec.api = apiRes.status;
  rec.bodyFields = apiRes.status===200 ? Object.keys(await apiRes.json()).slice(0,10) : null;
  rec.headers = {robots: apiRes.headers.get("x-robots-tag"), referrer: apiRes.headers.get("referrer-policy")};
  out["pub"+i+":"+p.status] = rec;
}
console.log(JSON.stringify(out));
await db.$disconnect();
