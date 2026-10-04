import { db } from "../src/server/db";
import { readFile } from "node:fs/promises";
import { env } from "../src/server/env";
import { connect } from "node:tls";
const base = new URL(env.BETTER_AUTH_URL).origin;
const pw = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json","utf8"));
const res = await fetch(base+"/api/v1/auth/sign-in/email",{method:"POST",redirect:"manual",headers:{origin:base,"content-type":"application/json"},body:JSON.stringify({email:"owner@catchsecu.local.test",password:pw["owner@catchsecu.local.test"]})});
if (res.status!==200) { console.log("login fail",res.status); process.exit(1); }
const cookie = res.headers.getSetCookie().map(v=>v.split(";")[0]).join("; ");
const { requireContext } = await import("../src/server/context");
const { startEmailVerification, confirmSenderEmail } = await import("../src/server/senders");
const { runOneJob } = await import("../src/server/jobs");
const ctx = await requireContext(new Headers({cookie}), "sender.manage");
const senderId = "fbfa3afd-d533-4b44-85ab-05c5605b2bca";
const sender = await db.sender.findUniqueOrThrow({where:{id:senderId}});
const req = await startEmailVerification(ctx, senderId, sender.version, "qa-live-"+Date.now());
console.log("verification id:", req.id, "expires:", req.expiresAt);
const job = await db.job.findFirstOrThrow({where:{dedupeKey:"mail:sender-verification:"+req.id}});
await runOneJob("qa-live-worker");
const after = await db.job.findUniqueOrThrow({where:{id:job.id}});
console.log("job:", after.status, "attempts:", after.attempts);
if (after.status!=="done") { console.log("not delivered"); process.exit(1); }
// IMAP: fetch newest message body
const sock = connect({host:"imap.hostinger.com",port:993});
let buf = "";
sock.on("data", d => { buf += d.toString("utf8"); });
const send = (c:string) => sock.write(c+"\r\n");
const sleep = (ms:number) => new Promise(r=>setTimeout(r,ms));
await new Promise(r => sock.on("secureConnect", r));
send(`A001 LOGIN "admin@soverin.cloud" "${process.env.SMTP_PASSWORD}"`); await sleep(2000);
send('A002 SELECT INBOX'); await sleep(1500);
const mCount = buf.match(/\* (\d+) EXISTS/); const n = Number(mCount?.[1]);
send(`A003 FETCH ${n} (BODY[TEXT])`); await sleep(3000);
const m = buf.match(/BODY\[TEXT\][^\n]*\n([\s\S]*?)\n?\)?\s*A003/);
const body = Buffer.from((m?m[1]:"").trim(), "base64").toString("utf8");
send('A004 LOGOUT'); sock.end();
const code = body.match(/(\d{6})/)?.[1];
console.log("received body:", body.slice(0,120).replace(/\n/g," "), "| code:", code);
if (!code) { console.log("no code"); process.exit(1); }
const conf = await confirmSenderEmail(ctx, senderId, {version:req.version, verificationId:req.id, code}, "qa-live-confirm-"+Date.now());
console.log("confirm:", JSON.stringify(conf));
const s = await db.sender.findUniqueOrThrow({where:{id:senderId}});
console.log("FINAL sender:", s.status, "env:", s.environment, "verifiedAt:", s.verifiedAt);
await db.$disconnect();
