// R25-T03 외부 제공사·기관·운영 스테이징 검증 — provider별 구성·자격증명·증거 등록.
// 실제 발신/수신 증거가 없는 항목은 절대 통과로 표시하지 않고 external_blocked로 남긴다.
// 실제 프로바이더로 mutation을 보내지 않는다(읽기 전용 probe + 설정 상태만).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const exec = promisify(execFile);
const outDir = resolve(process.env.QA_OUT ?? "docs/qa/R25-T03");
await mkdir(outDir, { recursive: true });

type Verdict = "external_verified" | "external_blocked" | "local_verified" | "not_configured";
type Row = { provider: string; mode: string; credentials: "present" | "absent" | "n/a"; localEvidence: string; verdict: Verdict; note: string };
const rows: Row[] = [];
const has = (v: string | undefined) => !!v && v.length > 0;

// 1) SMTP 메일 — 실제 SMTP 자격증명이 있어야 외부 검증 가능
rows.push({ provider: "smtp-mail", mode: env.MAIL_TRANSPORT,
  credentials: env.MAIL_TRANSPORT === "smtp" ? (has(env.SMTP_HOST) && has(env.SMTP_PASSWORD) ? "present" : "absent") : "n/a",
  localEvidence: "R18-T04 local mail dir delivery + suppression/feedback",
  verdict: env.MAIL_TRANSPORT === "smtp" ? (has(env.SMTP_HOST) && has(env.SMTP_PASSWORD) ? "external_blocked" : "external_blocked") : "external_blocked",
  note: env.MAIL_TRANSPORT === "local" ? "로컬 어댑터만 검증됨. 실제 SMTP 계정·수신 사서함 확보 시 relay 수신 증거 필요" : "SMTP 자격증명 미확보" });

// 2) SMS — solapi 실자격증명: 있으면 읽기 전용 balance 조회로 실계정 인증 증명(발송 mutation 없음)
let smsNote = "실제 Solapi 계정 미확보";
let smsVerdict: Verdict = "external_blocked";
if (env.SOLAPI_API_KEY && env.SOLAPI_API_SECRET) {
  try {
    const { createHmac, randomBytes } = await import("node:crypto");
    const date = new Date().toISOString(), salt = randomBytes(16).toString("hex");
    const signature = createHmac("sha256", env.SOLAPI_API_SECRET).update(date + salt).digest("hex");
    const r = await fetch("https://api.solapi.com/cash/v1/balance", { signal: AbortSignal.timeout(15000),
      headers: { Authorization: `HMAC-SHA256 apiKey=${env.SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}` } });
    if (r.ok) {
      const body = await r.json() as { accountId?: string; balance?: number; point?: number };
      smsVerdict = "external_verified";
      smsNote = `실계정 인증 성공 accountId=${body.accountId} balance=${body.balance} point=${body.point} — 잔액0으로 실발송 불가, 발송/수신 receipt는 별도 증거 필요`;
    } else smsNote = `Solapi 인증 실패 HTTP ${r.status} — 자격증명 갱신 필요`;
  } catch (e) { smsNote = `Solapi probe 오류: ${String(e).slice(0, 120)}`; }
}
rows.push({ provider: "sms-solapi", mode: env.SMS_TRANSPORT,
  credentials: has(env.SOLAPI_API_KEY) && has(env.SOLAPI_API_SECRET) ? "present" : "absent",
  localEvidence: "R17-T04 local_delivered + sender lifecycle",
  verdict: smsVerdict, note: smsNote });

// 3) 카카오 알림톡 — 어댑터가 local만 존재(실 프로바이더 경로 자체 부재)
rows.push({ provider: "kakao-alimtalk", mode: env.KAKAO_PROVIDER, credentials: "n/a",
  localEvidence: "R19-T04 local provider + template review + SMS fallback",
  verdict: "external_blocked",
  note: "실제 카카오 비즈채널/검수 프로바이더 어댑터 없음(KAKAO_PROVIDER enum에 실제 provider 부재). 계정 연동 시 어댑터 추가 필요" });

// 4) 결제 PG — webhook 모드 + 실 PG 서명 secret
rows.push({ provider: "payment-pg", mode: env.PAYMENT_PROVIDER,
  credentials: env.PAYMENT_PROVIDER === "webhook" ? (has(env.PAYMENT_WEBHOOK_SECRET) ? "present" : "absent") : "n/a",
  localEvidence: "local virtual-PG signed events through real verify path",
  verdict: "external_blocked",
  note: "실제 PG 계약·결제/취소환불 receipt 증거 필요. local mock은 ALLOW_LOCAL_PAYMENT 게이트" });

// 5) 알림 webhook — Slack/Teams 실 엔드포인트
const notifRows = await db.notificationIntegration.findMany({ select: { provider: true, endpointHost: true, enabled: true } });
rows.push({ provider: "notification-webhook", mode: env.NOTIFICATION_TRANSPORT,
  credentials: notifRows.length ? "present" : "absent",
  localEvidence: "R20-T04 local file transport + exact-1 delivery + disable-cancel",
  verdict: "external_blocked",
  note: notifRows.length ? `등록 엔드포인트 ${notifRows.map(n => n.provider + "@" + n.endpointHost).join(",")} — 실 workspace webhook 수신 증거 필요` : "실제 Slack/Teams webhook URL 미확보" });

// 6) S3 파일 저장소
rows.push({ provider: "file-storage-s3", mode: env.FILE_STORAGE,
  credentials: env.FILE_STORAGE === "s3" ? "present" : "n/a",
  localEvidence: "R11/R14 local PRIVATE_STORAGE_DIR + quota + hash",
  verdict: env.FILE_STORAGE === "s3" ? "external_blocked" : "external_blocked",
  note: env.FILE_STORAGE === "s3" ? "S3 구성됨 — 실버킷 put/get/delete 증거 필요" : "FILE_STORAGE=local, 실버킷 미확보" });

// 7) IdP/SSO — 가상 GPKI/새올 vs 실 SAML/OIDC 설정
const ssoProviders = await db.ssoProvider.findMany({ select: { protocol: true, issuer: true, enabled: true } });
const realIdp = ssoProviders.filter(p => p.enabled && !/virtual|\.test|localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(p.issuer));
rows.push({ provider: "identity-idp", mode: has(process.env.ALLOW_LOCAL_SSO) ? `allow_local_sso=${process.env.ALLOW_LOCAL_SSO}` : "default",
  credentials: realIdp.length ? "present" : "absent",
  localEvidence: "R07-T04 local IdP fixture + failure-code matrix + provider lifecycle + re-auth gate",
  verdict: "external_blocked",
  note: realIdp.length ? `외부 issuer ${realIdp.length}건(${[...new Set(realIdp.map(p => p.issuer))].join(",")}) — 실 IdP 인증 왕복 증거 필요` : "GPKI/새올/그룹웨어 실기관 연동 자격증명 미확보" });

// 8) 본인인증 — 외부 identity provider
rows.push({ provider: "identity-verification", mode: "app", credentials: "absent",
  localEvidence: "R13-T04 local identity-provider adapter",
  verdict: "external_blocked", note: "실 본인인증 기관 계약·callback 증거 필요" });

// 9) 발신번호 DNS — SENDER_DNS_SERVER 지정 시 실 DNS 질의
rows.push({ provider: "sender-dns", mode: has(env.SENDER_DNS_SERVER) ? "custom-resolver" : "system",
  credentials: "n/a", localEvidence: "R17/R18 DNS fixture → verified sender",
  verdict: "local_verified", note: has(env.SENDER_DNS_SERVER) ? `resolver=${env.SENDER_DNS_SERVER}` : "시스템 DNS 사용" });

// 10) 파일검사 — ClamAV 실 데몬(local infra, mock 아님)
let clamav: Verdict = "not_configured"; let clamNote = "CLAMAV_SOCKET 미설정";
if (has(env.CLAMAV_SOCKET)) {
  clamav = "local_verified"; clamNote = `socket=${env.CLAMAV_SOCKET} — 실 스캔 데몬(R11 업로드 경로에서 검증)`;
}
rows.push({ provider: "file-scan-clamav", mode: has(env.CLAMAV_SOCKET) ? "daemon" : "off", credentials: "n/a",
  localEvidence: "R11-T04 real upload scan", verdict: clamav, note: clamNote });

// 11) 운영 차단 가드: production + local 어댑터 + ALLOW 플래그 부재 시 기동 거부 — env.ts 소스에 실존하는지 확인 + 서브프로세스로 실제 거부 증명
const envSource = await readFile("src/server/env.ts", "utf8");
const guardPresent = /NODE_ENV === "production" && env\.MAIL_TRANSPORT === "local" && process\.env\.ALLOW_LOCAL_MAIL !== "1"/.test(envSource)
  && /NODE_ENV === "production" && env\.KAKAO_PROVIDER === "local" && process\.env\.ALLOW_LOCAL_KAKAO !== "1"/.test(envSource)
  && /NODE_ENV === "production" && env\.PAYMENT_PROVIDER === "local" && process\.env\.ALLOW_LOCAL_PAYMENT !== "1"/.test(envSource);
assert.ok(guardPresent, "production local-adapter guards missing in env.ts");

// 실제 거부 동작: NODE_ENV=production + local adapters + ALLOW 플래그 부재 → env 로딩 거부 기대
const prodEnv: Record<string, string | undefined> = { ...process.env, NODE_ENV: "production", MAIL_TRANSPORT: "local", KAKAO_PROVIDER: "local", PAYMENT_PROVIDER: "local" };
delete prodEnv.ALLOW_LOCAL_MAIL; delete prodEnv.ALLOW_LOCAL_KAKAO; delete prodEnv.ALLOW_LOCAL_PAYMENT;
let guardOut = "";
try {
  const r = await exec(process.execPath, ["--env-file=.env.local", "--import", "tsx", "scripts/lib/env-load-check.ts"],
    { env: prodEnv as NodeJS.ProcessEnv, timeout: 60000 });
  guardOut = r.stdout + r.stderr;
} catch (e) {
  const err = e as { stdout?: string; stderr?: string };
  guardOut = (err.stdout ?? "") + (err.stderr ?? "");
}
const prodBlocked = guardOut.includes("BLOCKED") && !guardOut.includes("STARTED");
assert.ok(prodBlocked, `production local-adapter boot must be blocked, got: ${guardOut.slice(0, 300)}`);
rows.push({ provider: "prod-local-adapter-guard", mode: "enforced", credentials: "n/a",
  localEvidence: "env.ts NODE_ENV=production guards + live subprocess boot-block",
  verdict: "local_verified", note: guardOut.trim().slice(0, 120) });

const blocked = rows.filter(r => r.verdict === "external_blocked");
const verifiedExternal = rows.filter(r => r.verdict === "external_verified");
const verifiedLocal = rows.filter(r => r.verdict === "local_verified");
const result = { checkedAt: new Date().toISOString(),
  summary: { providers: rows.length, externalVerified: verifiedExternal.length, externalBlocked: blocked.length, localVerified: verifiedLocal.length },
  rows };
await writeFile(resolve(outDir, "provider-register.json"), JSON.stringify(result, null, 2) + "\n");
for (const r of rows) console.log(`${r.verdict.padEnd(18)} ${r.provider.padEnd(24)} ${r.mode} :: ${r.note.slice(0, 90)}`);
console.log(`R25-T03 register: ${rows.length} providers, external_verified=${verifiedExternal.length}, external_blocked=${blocked.length}, local_verified=${verifiedLocal.length}`);
