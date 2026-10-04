import { connect } from "node:tls";
const sock = connect({host:"imap.hostinger.com",port:993});
let buf = "";
sock.on("data", d => { buf += d.toString("utf8"); });
const send = (c:string) => sock.write(c+"\r\n");
const sleep = (ms:number) => new Promise(r => setTimeout(r, ms));
await new Promise(r => sock.on("secureConnect", r));
send('A001 LOGIN "admin@soverin.cloud" "' + process.env.SMTP_PASSWORD + '"');
await sleep(2000);
send('A002 SELECT INBOX');
await sleep(1500);
send('A003 FETCH 18 (BODY[TEXT])');
await sleep(3000);
const m = buf.match(/BODY\[TEXT\][^\n]*\n([\s\S]*?)\n?\)?\s*A003/);
const raw = (m ? m[1] : buf).trim();
console.log("RAW>>>", raw.slice(0,600));
try { console.log("DECODED>>>", Buffer.from(raw, "base64").toString("utf8").slice(0,800)); } catch {}
send('A004 LOGOUT');
sock.end();
