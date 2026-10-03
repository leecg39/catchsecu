import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { services } from "../src/server/fixtures/catalog";

const origin = "http://localhost:3100";
const serviceId = services.a;
async function login(email: string) {
  const passwords = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8")) as Record<string, string>;
  const response = await fetch(origin + "/api/v1/auth/sign-in/email", {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email, password: passwords[email] }),
  });
  if (response.status !== 200) throw new Error(email + " 로그인 실패 " + response.status);
  return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
}
function call(path: string, method: string, cookie: string, body?: unknown, headers: Record<string, string> = {}) {
  return fetch(origin + path, { method, headers: { origin, cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}), redirect: "manual" });
}
const content = () => ({ body: "", questions: [{ id: randomUUID(), type: "단문형 답변", label: "이름", required: true }],
  consentRequired: false, consentPurpose: "", retentionDays: 365, maxResponses: 100 });
const input = (title: string) => ({ serviceId, title, content: content() });

async function main() {
  const owner = await login("owner@catchsecu.local.test");
  const viewer = await login("viewer@catchsecu.local.test");
  const statuses: Record<string, number> = {};
  statuses.health = (await fetch(origin + "/api/v1/health")).status;
  statuses.unauthenticated = (await fetch(origin + "/api/v1/forms")).status;
  statuses.notFound = (await call("/api/v1/forms/" + randomUUID(), "GET", owner)).status;
  statuses.badRequest = (await call("/api/v1/forms", "POST", owner, input("키 없음"))).status;
  statuses.validation = (await call("/api/v1/forms", "POST", owner, { serviceId, title: "" }, { "idempotency-key": "p01-invalid-title" })).status;
  statuses.forbidden = (await call("/api/v1/forms", "POST", viewer, input("권한 없음"), { "idempotency-key": "p01-viewer-denied" })).status;
  const key = "p01-same-key-" + randomUUID().replaceAll("-", "");
  const payload = input("P01 계약 A");
  const created = await call("/api/v1/forms", "POST", owner, payload, { "idempotency-key": key });
  const createdBody = await created.json() as { id: string; version: number };
  statuses.created = created.status;
  const replay = await call("/api/v1/forms", "POST", owner, payload, { "idempotency-key": key });
  statuses.replay = replay.status;
  statuses.idempotencyMismatch = (await call("/api/v1/forms", "POST", owner, input("P01 계약 다른 내용"), { "idempotency-key": key })).status;
  statuses.versionConflict = (await call("/api/v1/forms/" + createdBody.id, "PATCH", owner, { version: 999, title: "충돌" })).status;
  const read = await call("/api/v1/forms/" + createdBody.id, "GET", owner);
  statuses.read = read.status;
  if (!read.headers.get("x-request-id")) throw new Error("요청 ID 응답 헤더가 없습니다.");
  const second = await call("/api/v1/forms", "POST", owner, input("P01 계약 B"), { "idempotency-key": "p01-second-" + randomUUID().replaceAll("-", "") });
  statuses.second = second.status;
  const list = async () => (await (await call("/api/v1/forms?sort=name&direction=asc&search=P01%20%EA%B3%84%EC%95%BD&pageSize=100", "GET", owner)).json()) as { items: { id: string; title: string }[] };
  const firstList = await list(), secondList = await list();
  const stable = JSON.stringify(firstList.items.map(item => [item.id, item.title])) === JSON.stringify(secondList.items.map(item => [item.id, item.title]));
  const ordered = firstList.items.map(item => item.title).filter(title => title.startsWith("P01 계약")).join() === "P01 계약 A,P01 계약 B";
  statuses.deleted = (await call("/api/v1/forms/" + createdBody.id, "DELETE", owner, undefined, { "if-match": String(createdBody.version) })).status;
  const other = await second.json() as { id: string; version: number };
  await call("/api/v1/forms/" + other.id, "DELETE", owner, undefined, { "if-match": String(other.version) });
  let limited = 0;
  for (let attempt = 0; attempt < 12 && limited !== 429; attempt += 1)
    limited = (await fetch(origin + "/api/v1/auth/sign-in/email", { method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ email: "missing-p01@catchsecu.local.test", password: "wrong-password-1" }) })).status;
  statuses.rateLimited = limited;
  const expected = { health: 200, unauthenticated: 401, notFound: 404, badRequest: 400, validation: 422, forbidden: 403,
    created: 201, replay: 201, idempotencyMismatch: 409, versionConflict: 409, read: 200, second: 201, deleted: 204, rateLimited: 429 };
  const mismatches = Object.entries(expected).filter(([name, status]) => statuses[name] !== status);
  const report = { checkedAt: new Date().toISOString(), result: mismatches.length || !stable || !ordered ? "failed" : "passed",
    statuses, expected, stableSort: stable, titleOrder: ordered, mismatches };
  await mkdir("docs/qa/P01-T02", { recursive: true });
  await writeFile("docs/qa/P01-T02/api-contract.json", JSON.stringify(report, null, 2) + "\n");
  if (report.result !== "passed") throw new Error("API 계약 불일치 " + JSON.stringify({ mismatches, stable, ordered, statuses }));
  await writeFile("docs/qa/P01-T02/README.md", `# P01-T02 공통 API 계약

${report.checkedAt}. 로컬 서버에서 상태 코드, 같은 Idempotency-Key의 다른 본문 거부, 이름 정렬의 반복 조회 일치를 확인했다.

확인한 상태: 200, 201, 204, 400, 401, 403, 404, 409, 422, 429. 응답에는 \`X-Request-Id\`가 있다. 정렬 허용값은 createdAt와 name이고, 같은 조건의 두 목록은 ID와 제목 순서가 같다.

실행 당시 서버: http://localhost:3100. 결과: \`api-contract.json\`.
`);
  console.log(JSON.stringify({ result: report.result, statuses }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });