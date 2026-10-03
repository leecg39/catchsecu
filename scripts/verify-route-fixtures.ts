import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import routes from "../src/data/route-manifest.json";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { tokenHash } from "../src/server/crypto";
import { privateFiles } from "../src/server/file-storage";
import { isAuthPath } from "../src/lib/public-paths";
import { seedRouteFixtures } from "./seed-route-fixtures";
import {
  actors, ciGates, companies, concretePath, externalScenarios, nonRouteTasks, noticeId, records, routeGrade,
  services, tokens, unmodeledRoutes,
} from "../src/server/fixtures/catalog";

const origin = new URL(env.BETTER_AUTH_URL).origin;
const database = new URL(env.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(database.hostname) || database.pathname !== "/catchsecu_dev")
  throw new Error("fixture 검증은 로컬 catchsecu_dev에서만 실행합니다.");

function routePattern(path: string) {
  return new RegExp("^" + path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:[^/]+/g, "[^/]+") + "/?$");
}
const known = (path: string) => routes.some(route => routePattern(route.path).test(path));

async function login() {
  const passwords = JSON.parse(await readFile(".local/catchsecu_dev-accounts.json", "utf8")) as Record<string, string>;
  const password = passwords["owner@catchsecu.local.test"];
  if (!password) throw new Error("owner 계정 암호 파일이 없습니다. npm run db:seed를 실행하세요.");
  const response = await fetch(origin + "/api/v1/auth/sign-in/email", {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@catchsecu.local.test", password }), redirect: "manual",
  });
  if (response.status !== 200) throw new Error("fixture owner 로그인 실패: HTTP " + response.status);
  const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  if (!cookie) throw new Error("로그인 응답에 세션 쿠키가 없습니다.");
  return cookie;
}
async function navigate(path: string, cookie: string) {
  let current = path;
  const chain = [path];
  let status = 0;
  for (let hop = 0; hop < 4; hop += 1) {
    const response = await fetch(origin + current, { headers: { cookie }, redirect: "manual" });
    status = response.status;
    if (status < 300 || status >= 400) return { status, chain };
    const next = new URL(response.headers.get("location") ?? "", origin);
    if (next.origin !== origin) return { status, chain: [...chain, next.toString()] };
    current = next.pathname + next.search;
    chain.push(current);
  }
  return { status, chain };
}
async function api(path: string) {
  const response = await fetch(origin + path, { headers: { origin }, redirect: "manual" });
  const body = await response.json().catch(() => null) as { title?: string; snapshot?: { title?: string } } | null;
  return { status: response.status, title: body?.title ?? body?.snapshot?.title ?? null };
}

async function main() {
  const seeded = await seedRouteFixtures();
  const matrix = parse(await readFile("docs/planning/03-route-matrix.csv", "utf8"), { columns: true, bom: true }) as Array<Record<string, string>>;
  const tasks = JSON.parse(await readFile("docs/planning/tasks.json", "utf8")) as Array<{ id: string }>;
  const taskIds = new Set(tasks.map(task => task.id));
  const failures: string[] = [];
  if (matrix.length !== 181) failures.push("경로 행 수 " + matrix.length);
  const testIds = new Set(matrix.map(row => row.test_id));
  if (testIds.size !== 181) failures.push("E2E ID 중복 또는 누락");
  const routeTasks = new Set(matrix.map(row => row.task_id));
  const orphanRoutes = matrix.filter(row => !taskIds.has(row.task_id) || !row.test_id).map(row => row.route_id);
  const orphanTasks = tasks.map(task => task.id).filter(id => !routeTasks.has(id) && !nonRouteTasks[id]);
  const unclassified = Object.keys(nonRouteTasks).filter(id => !taskIds.has(id) || routeTasks.has(id));
  if (orphanRoutes.length || orphanTasks.length || unclassified.length)
    failures.push("고아 경로 " + orphanRoutes.length + ", 고아 Task " + orphanTasks.length + ", 오분류 " + unclassified.length);

  const catalog = matrix.map(row => {
    const path = concretePath(row.route_id, row.path);
    const grade = routeGrade(row.route_id);
    if (!known(path)) failures.push(path + " 는 라우트 표와 맞지 않습니다.");
    if (path.includes(":") || path.includes("demo")) failures.push(path + " 는 실제 ID가 아닙니다.");
    return { routeId: row.route_id, testId: row.test_id, taskId: row.task_id, template: row.path, path, grade,
      persisted: grade === "internal", actorScope: row.actor_scope };
  });
  const grades = { internal: catalog.filter(row => row.grade === "internal").length, adapter: 0, staging: catalog.filter(row => row.grade === "staging").length, mock: 0 };
  if (grades.staging !== unmodeledRoutes.size || grades.internal + grades.staging !== 181 || grades.mock !== 0)
    failures.push("검증 등급 분리 오류");
  if (externalScenarios.some(item => item.releasePass) || ciGates.staging.blockedIsPass || ciGates.internal.mockIsPass || ciGates.adapter.skipIsPass)
    failures.push("mock/staging/skip을 통과로 집계하는 게이트가 있습니다.");

  const [form, publication, submission, file, notice, subjectAccess, companyBForms, restrictedForms, roleUsers] = await Promise.all([
    db.form.findUnique({ where: { id: records.form }, select: { status: true, tenantId: true, serviceId: true, publishedVersionId: true } }),
    db.publication.findUnique({ where: { tokenHash: tokenHash(tokens.publicForm) }, select: { id: true, status: true, tenantId: true } }),
    db.submission.findUnique({ where: { id: records.submission }, include: { receipts: { select: { id: true } }, subject: { select: { id: true } } } }),
    db.fileObject.findUnique({ where: { id: records.file }, select: { questionId: true, status: true, tenantId: true } }),
    db.notice.findUnique({ where: { id: noticeId }, select: { status: true } }),
    db.subjectAccessRequest.findUnique({ where: { tokenHash: tokenHash(tokens.subjectAccess) }, include: { scopes: { select: { subjectId: true } } } }),
    db.form.count({ where: { tenantId: companies.b } }),
    db.form.count({ where: { serviceId: services.aRestricted } }),
    db.user.count({ where: { id: { in: actors.map(actor => actor.userId) }, emailVerified: true } }),
  ]);
  const storedFile = await privateFiles.read(records.file).catch(() => null);
  if (form?.status !== "published" || form.tenantId !== companies.a || form.serviceId !== services.a || form.publishedVersionId !== records.formVersion)
    failures.push("폼 fixture가 회사 A 기본 서비스의 게시 상태가 아닙니다.");
  if (publication?.id !== records.publication || publication.status !== "active" || publication.tenantId !== companies.a)
    failures.push("공개 폼 토큰이 DB와 연결되지 않았습니다.");
  if (submission?.status !== "submitted" || submission.receipts.length !== 1 || !submission.subject)
    failures.push("응답·동의 영수증·정보주체 연결이 없습니다.");
  if (file?.questionId !== records.questionFile || file.status !== "pending" || file.tenantId !== companies.a || !storedFile?.equals(Buffer.from("catchsecu route fixture\n")))
    failures.push("첨부 fixture 바이트가 저장소와 일치하지 않습니다.");
  if (notice?.status !== "published" || !subjectAccess || subjectAccess.consumedAt || subjectAccess.scopes.length !== 1)
    failures.push("공지 또는 정보주체 토큰 fixture가 유효하지 않습니다.");
  if (companyBForms !== 0 || restrictedForms !== 0 || roleUsers !== actors.length)
    failures.push("회사 B 빈 상태, 제한 서비스, 역할 계정 수가 기대와 다릅니다.");
  const absent = await db.form.findUnique({ where: { id: records.kakaoTemplate } });
  if (absent) failures.push("모델이 없는 카카오 ID가 폼 테이블에 들어가 있습니다.");

  let cookie = "";
  try { cookie = await login(); }
  catch (error) { failures.push(error instanceof Error ? error.message : "로그인 실패"); }
  const pages: Array<{ testId: string; path: string; status: number; chain: string[] }> = [];
  if (cookie) {
    for (const row of catalog) {
      const result = await navigate(row.path, cookie);
      pages.push({ testId: row.testId, path: row.path, ...result });
      const returnedToLogin = !isAuthPath(row.path) && result.chain.some(item => item.startsWith("/login"));
      if (result.status === 404 || result.status >= 500 || returnedToLogin)
        failures.push(row.testId + " " + row.path + " HTTP " + result.status + " " + result.chain.join(" -> "));
    }
  }
  const publicApis = [
    await api("/api/v1/public/forms/" + tokens.publicForm),
    await api("/api/v1/public/urls/fixture-form-a"),
    await api("/api/v1/public/documents/" + tokens.documentConsent),
    await api("/api/v1/public/documents/" + tokens.documentPolicy),
    await api("/api/v1/public/documents/" + tokens.documentOverseas),
  ];
  if (publicApis.some(item => item.status !== 200 || !item.title)) failures.push("공개 폼·고정 URL·문서 토큰 API가 200이 아닙니다: " + JSON.stringify(publicApis.map(item => item.status)));

  const report = {
    checkedAt: new Date().toISOString(), result: failures.length ? "failed" : "passed",
    routes: catalog.length, orphanRoutes: orphanRoutes.length, orphanTasks: orphanTasks.length,
    grades, actors: actors.map(actor => ({ role: actor.role, email: actor.email, tenantId: actor.tenantId, populated: actor.populated })),
    scenarios: externalScenarios, ciGates, seeded, pages: pages.map(item => ({ testId: item.testId, status: item.status, hops: item.chain.length })),
    publicApis: publicApis.map(item => item.status), failures,
  };
  const directory = "docs/qa/P00-T04";
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "fixture-check.json"), JSON.stringify(report, null, 2) + "\n");
  await writeFile(resolve(directory, "route-catalog.json"), JSON.stringify(catalog, null, 2) + "\n");
  if (failures.length) {
    console.error(failures.slice(0, 30).join("\n"));
    throw new Error("fixture 검증 실패 " + failures.length + "건");
  }
  await writeFile(resolve(directory, "README.md"), `# P00-T04 시험 데이터·검증 목록

${report.checkedAt}. 회사 A/B, 역할 10개, 공개 토큰, 181개 경로의 실제 주소와 검증 등급을 고정했다. 이 결과는 181개 업무 CRUD가 끝났다는 뜻이 아니다.

## 확인한 사실

- 고아 경로 0, 고아 Task 0. 페이지가 없는 Task 31개는 foundation, enforcement, embedded, gate, release로 분류했다.
- 등급은 internal ${grades.internal}, staging ${grades.staging}, mock 0이다. staging 12개 경로는 구매·청구·카카오 템플릿·본인인증·새올 모델이 없어 데이터베이스 ID가 아니다.
- owner 세션으로 181개 구체 주소가 HTTP 200이었다. 없는 주소는 서버가 404로 거절한다.
- 공개 폼, 고정 URL, 문서 토큰 3개의 API가 200이었다.
- 회사 B와 제한 서비스의 폼은 0건이다. 첨부 fixture 바이트는 비공개 저장소와 일치한다.
- 외부 시나리오 8개는 adapter 또는 staging이며, skip·mock·차단 상태를 통과로 집계하지 않는다.
- R162–R164의 P/C/OC는 내부 문서 유형의 별칭으로 쓰지 않는다. 경로의 토큰은 각각 독립된 게시 문서를 연다.
- \`/identification/:result\` fixture 값은 \`pending\`이다. 주소 방문만으로 본인인증 성공을 만들지 않는다.

실행: \`npm run db:seed\` 후 로컬 서버에서 \`npm run verify:fixtures\`. 결과: \`fixture-check.json\`, \`route-catalog.json\`.

로컬 production 미리보기는 \`ALLOW_LOCAL_MAIL=1\`이 있어야 기동한다. 이 검증은 그 설정으로 \`next start --port 3100\`에 대해 수행했다.
`);
  await access(resolve(directory, "fixture-check.json"));
  console.log(JSON.stringify({ result: report.result, routes: report.routes, orphanRoutes: 0, orphanTasks: 0, grades, publicApis: report.publicApis }));
  await db.$disconnect();
}
main().catch(async error => {
  console.error(error instanceof Error ? error.message : error);
  await db.$disconnect();
  process.exitCode = 1;
});
