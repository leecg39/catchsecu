import { createHmac, randomBytes } from "node:crypto";
const key = process.env.SOLAPI_API_KEY!, secret = process.env.SOLAPI_API_SECRET!;
const date = new Date().toISOString(), salt = randomBytes(16).toString("hex");
const signature = createHmac("sha256", secret).update(date + salt).digest("hex");
const r = await fetch("https://api.solapi.com/messages/v4/send", { method: "POST",
  headers: { Authorization: `HMAC-SHA256 apiKey=${key}, date=${date}, salt=${salt}, signature=${signature}`, "content-type": "application/json" },
  body: JSON.stringify({ message: { to: "01029062908", from: "01029062908", text: "[캐챠시큐 QA] Solapi 실발송 검증" , type: "SMS" } }) });
console.log(r.status, await r.text());
