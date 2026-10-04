import { deliverSms } from "../src/server/sms-adapter";
async function main() {
  const r = await deliverSms({ transport: "solapi", jobId: "qa-solapi-" + Date.now(), to: "01029062908", from: "01029062908", text: "[캐챠시큐 QA] Solapi 실발송 검증 " + new Date().toISOString().slice(11, 19) });
  console.log(JSON.stringify(r));
}
main().catch(e => { console.log("ERROR:", e.status ?? "", e.code ?? "", e.message); process.exit(1); });
