import { readFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

const database = new URL(env.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(database.hostname) || database.pathname !== "/catchsecu_dev")
  throw new Error("Access denial QA only uses the local catchsecu_dev database.");
const base = new URL(env.BETTER_AUTH_URL).origin;
if (!["http://localhost:3100", "http://127.0.0.1:3100"].includes(base))
  throw new Error("Start the local app on port 3100 before running access denial QA.");
const email = "viewer@catchsecu.local.test";
const passwords = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8")) as Record<string, string>;
const companyId = "10000000-0000-4000-8000-000000000001";
let cookie = "", temporaryServiceId = "";
function check(value: unknown, message: string) { if (!value) throw new Error(message); }
async function get(path: string, currentCookie = cookie) {
  return fetch(base + path, { headers: currentCookie ? { cookie: currentCookie } : {}, redirect: "manual" });
}
try {
  const login = await fetch(base + "/api/v1/auth/sign-in/email", { method: "POST", redirect: "manual",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ email, password: passwords[email] }) });
  check(login.status === 200, `QA login failed: ${login.status}`);
  cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const anonymous = await get("/access-not-allow", "");
  check(anonymous.status === 307 && anonymous.headers.get("location")?.startsWith("/login"), "Anonymous access was not redirected to login");
  const denied = await get("/admin/notices");
  check(denied.status === 307 && denied.headers.get("location") === "/access-not-allow?reason=admin",
    "Non-admin route did not redirect with the admin reason");
  const adminPage = await get("/access-not-allow?reason=admin");
  check(adminPage.status === 200 && (await adminPage.text()).includes("시스템 운영자 권한이 필요한 화면입니다."),
    "Admin access denial page did not render the role reason");
  const service = await db.service.create({ data: { tenantId: companyId, name: "접근 거부 QA 서비스",
    externalName: "Access denial QA" } });
  temporaryServiceId = service.id;
  const options = await get("/api/v1/access-requests?scope=mine&pageSize=1");
  const optionsBody = await options.json();
  check(options.status === 200 && optionsBody.availableServices.some((item: { id: string }) => item.id === temporaryServiceId),
    "Direct viewer cannot request the temporary service");
  const servicePage = await get("/access-not-allow?reason=service");
  check(servicePage.status === 200 && (await servicePage.text()).includes("서비스 접근 권한이 없습니다."),
    "Service access denial page did not render the service reason");
  const rolePage = await get("/access-not-allow?reason=role");
  check(rolePage.status === 200 && (await rolePage.text()).includes("현재 역할로 사용할 수 없는 기능입니다."),
    "Role access denial page did not render the role reason");
  const expertPage = await get("/access-not-allow?reason=expert");
  check(expertPage.status === 200 && (await expertPage.text()).includes("전문가 배정 범위에 없는 서비스입니다."),
    "Expert access denial page did not render the assignment reason");
  console.log(JSON.stringify({ anonymous: anonymous.status, adminRedirect: denied.headers.get("location"),
    adminPage: adminPage.status, servicePage: servicePage.status, rolePage: rolePage.status,
    expertPage: expertPage.status, requestableServiceInApi: true, cleanup: "pending" }));
} finally {
  if (cookie) await fetch(base + "/api/v1/auth/sign-out", { method: "POST", headers: { origin: base, cookie } }).catch(() => null);
  if (temporaryServiceId) await db.service.delete({ where: { id: temporaryServiceId } });
  await db.$disconnect();
  console.log(JSON.stringify({ cleanup: "complete", temporaryServiceRemoved: !!temporaryServiceId }));
}
