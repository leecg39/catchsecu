import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";
import { tokenHash } from "../src/server/crypto";
import { unsubscribeToken, UNSUBSCRIBE_LIFETIME_MS } from "../src/server/email-policy";
import { actors, companies, externalScenarios, fixedSlug, noticeId, records, services, tokens } from "../src/server/fixtures/catalog";
import { buildRouteFixture, type FixtureBindings, type FixtureRoute } from "../src/server/fixtures/routes";

// Read-only: never reseed, reset existing state, or manufacture a callback.
const database = new URL(env.DATABASE_URL);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname));
assert.ok(["/catchsecu_dev", "/catchsecu_test"].includes(database.pathname));
const json = async <T,>(path: string): Promise<T> => JSON.parse(await readFile(path, "utf8"));
const active = await json<{ routeMatrix: string; sourceRoutes: string; additionalRoutes: string; tasks: string }>("docs/planning/active-plan.json");
const matrix = await json<Array<FixtureRoute & { ui_task: string; gate_task: string }>>(active.routeMatrix);
const source = await json<Array<{ path: string }>>(active.sourceRoutes);
const additional = await json<Array<{ path: string; task: string; gate: string }>>(active.additionalRoutes);
const tasks = await json<Array<{ id: string; acceptance: string[] }>>(active.tasks);
const taskIds = new Set(tasks.map(task => task.id));
assert.equal(matrix.length, source.length);
assert.deepEqual(new Set(matrix.map(row => row.path)), new Set(source.map(row => row.path)));
assert.equal(new Set(matrix.map(row => row.id)).size, matrix.length);
for (const row of [...matrix.map(row => ({ task: row.ui_task, gate: row.gate_task })), ...additional]) {
  assert.ok(taskIds.has(row.task)); assert.ok(taskIds.has(row.gate));
}
const bindings: FixtureBindings = {};
const out = "docs/qa/R00-T04/active-fixtures";
await mkdir(out, { recursive: true });
try {
  const [service, form, submission, question, file, publication, fixed, document, documentPublication, subject, template, order, notice, guide, support, importJob, unsubscribeJobs, actorRows] = await Promise.all([
    db.service.findFirst({ where: { id: services.a, tenantId: companies.a } }),
    db.form.findFirst({ where: { id: records.form, tenantId: companies.a, serviceId: services.a } }),
    db.submission.findFirst({ where: { id: records.submission, tenantId: companies.a, formVersionId: records.formVersion } }),
    db.question.findFirst({ where: { id: records.questionFile, tenantId: companies.a, formVersionId: records.formVersion } }),
    db.fileObject.findFirst({ where: { id: records.fileView, tenantId: companies.a, questionId: records.questionFile, status: "attached", scanStatus: "clean" } }),
    db.publication.findFirst({ where: { id: records.publication, tenantId: companies.a, tokenHash: tokenHash(tokens.publicForm), status: "active" } }),
    db.fixedUrl.findFirst({ where: { id: records.fixedUrl, tenantId: companies.a, slug: fixedSlug, publicationId: records.publication, status: "active" } }),
    db.document.findFirst({ where: { id: records.consentDocument, tenantId: companies.a, serviceId: services.a } }),
    db.documentPublication.findFirst({ where: { id: records.consentPublication, tenantId: companies.a, tokenHash: tokenHash(tokens.documentConsent), status: "active" } }),
    db.subjectAccessRequest.findFirst({ where: { tokenHash: tokenHash(tokens.subjectAccess), expiresAt: { gt: new Date() }, consumedAt: null } }),
    db.kakaoTemplate.findFirst({ where: { id: records.kakaoTemplate, tenantId: companies.a, serviceId: services.a } }),
    db.paymentOrder.findFirst({ where: { id: records.purchase, tenantId: companies.a } }),
    db.notice.findFirst({ where: { id: noticeId, status: "published" } }),
    db.guide.findFirst({ orderBy: { createdAt: "desc" } }),
    db.supportTicket.findFirst({ where: { id: records.supportTicket, tenantId: companies.a } }),
    db.importJob.findFirst({ where: { id: records.importJob, tenantId: companies.a, serviceId: services.a, status: "draft" } }),
    db.job.findMany({ where: {
      createdAt: { gt: new Date(Date.now() - UNSUBSCRIBE_LIFETIME_MS) },
      OR: [
        { status: "done", campaignDelivery: { is: { status: { in: ["accepted", "local_delivered"] }, campaign: { is: { channel: "email" } } } } },
        { status: "dead", campaignDelivery: { is: { status: "unknown", campaign: { is: { channel: "email" } } } } },
      ],
    }, include: { campaignDelivery: true }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.user.findMany({ where: { id: { in: actors.map(actor => actor.userId) } }, select: { id: true, emailVerified: true } }),
  ]);
  const bind = (key: keyof FixtureBindings, model: string, value: string | undefined, verified = true, limitation?: string) => {
    if (value) bindings[key] = { model, value, verified, ...(limitation ? { limitation } : {}) };
  };
  bind("service", "Service", service?.id); bind("form", "Form", form?.id);
  bind("submission", "Submission", submission?.id); bind("question", "Question", question?.id);
  bind("file", "FileObject", file?.id, file?.scanStatus === "clean", "제출에 연결된 검사 clean 파일; 다운로드 때 현재 권한을 별도 검사");
  bind("publicForm", "Publication", publication && form?.status === "published" ? tokens.publicForm : undefined);
  bind("fixedUrl", "FixedUrl", fixed && publication ? fixedSlug : undefined);
  bind("document", "Document", document?.id);
  bind("documentToken", "DocumentPublication", documentPublication ? tokens.documentConsent : undefined,
    !documentPublication?.expiresAt || documentPublication.expiresAt > new Date(), "P/C/OC 원본 의미 미확인. 같은 독립 게시문서로 라우팅만 검사");
  bind("subjectToken", "SubjectAccessRequest", subject ? tokens.subjectAccess : undefined);
  bind("kakaoTemplate", "KakaoTemplate", template?.id, true, "로컬 draft 템플릿; 카카오 승인 상태를 주장하지 않음");
  bind("paymentOrder", "PaymentOrder", order?.id, true, "로컬 pending 주문; 성공 URL만으로 paid 처리하지 않으며 실제 PG 승인 수용과 별개");
  bind("notice", "Notice", notice?.id); bind("guide", "Guide", guide?.id);
  bind("supportTicket", "SupportTicket", support?.id); bind("importJob", "ImportJob", importJob?.id);
  const unsubscribeJob = unsubscribeJobs.find(job => job.campaignDelivery && job.dedupeKey === "campaign:" + job.campaignDelivery.id + ":" + job.campaignDelivery.attempt);
  bind("unsubscribeToken", "Job+CampaignDelivery", unsubscribeJob ? unsubscribeToken(unsubscribeJob.id) : undefined, true,
    "실제 local_delivered/accepted 전달 원장에 바인딩된 90일 수신거부 토큰; 임의 job ID 사용 금지");
  const rows = matrix.map(row => buildRouteFixture(row, bindings));
  const extra = additional.map((row, index) => buildRouteFixture({
    id: "AR" + String(index + 1).padStart(3, "0"), path: row.path, domain: row.task.split("-")[0],
    page_acceptance: tasks.find(task => task.id === row.gate)!.acceptance.join("; "),
    actors: row.path.startsWith("/admin/") ? "플랫폼 관리자/지원담당" : "현재 회사의 해당 기능 권한 계정", api_operations: [],
  }, bindings));
  const all = [...rows, ...extra];
  assert.equal(new Set(all.map(row => row.template)).size, all.length);
  for (const row of all) {
    assert.equal(row.scenarios.length, 3);
    if (row.path) assert.ok(!/[:*]/.test(row.path), row.routeId + " unresolved parameter");
    assert.equal(row.execution, "not_run");
  }
  const stagingPolicies = externalScenarios.filter(item => item.grade === "staging");
  assert.ok(stagingPolicies.length > 0);
  for (const scenario of stagingPolicies) {
    assert.equal(scenario.releasePass, false);
    assert.ok(scenario.testTargetPolicy.includes("시험") || scenario.testTargetPolicy.includes("sandbox"));
  }
  const pending = all.filter(row => row.preparation !== "ready_for_execution");
  const missingActors = actors.filter(actor => !actorRows.some(row => row.id === actor.userId && row.emailVerified)).map(actor => actor.role + ":" + actor.tenantId);
  const report = {
    checkedAt: new Date().toISOString(), database: database.pathname.slice(1), readOnly: true,
    contractResult: "passed", contractComplete: all.every(row => row.scenarios.length === 3 && !!row.path),
    runtimeResult: "not_run", allCrudVerified: false,
    sourceRoutes: rows.length, concreteRoutes: rows.filter(row => !row.fallback).length,
    fallbackRoutes: rows.filter(row => row.fallback).length, additionalRoutes: extra.length,
    scenarioContracts: all.length * 3, pathsWithRealBindings: all.filter(row => row.path).length,
    sourcePathsConcrete: rows.every(row => !!row.path), additionalPathsConcrete: extra.every(row => !!row.path),
    stagingExternalTestPolicies: stagingPolicies.map(item => ({ id: item.id, policy: item.testTargetPolicy })), missingActors,
    preparationRequired: pending.map(row => ({ routeId: row.routeId, template: row.template, prerequisites: row.prerequisites })),
    strictReadiness: pending.length || missingActors.length ? "blocked" : "ready_for_execution",
    limitation: "DB 참조 및 시나리오 계약 검사. HTTP/브라우저 CRUD 실행과 외부 공급사 수용은 별도 수행.",
  };
  await writeFile(out + "/route-catalog.json", JSON.stringify({ source: rows, additional: extra }, null, 2) + "\n");
  await writeFile(out + "/result.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ contract: report.contractResult, runtime: report.runtimeResult, readiness: report.strictReadiness,
    source: rows.length, additional: extra.length, scenarios: report.scenarioContracts, preparationRequired: pending.length }));
  if (!process.argv.includes("--catalog-only") && report.strictReadiness === "blocked") process.exitCode = 2;
} finally { await db.$disconnect(); }
