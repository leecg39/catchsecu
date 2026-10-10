import { legacyFormLanguageColumn } from "./qa-legacy-language";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { db } from "../src/server/db";
import { env } from "../src/server/env";

// Frozen pre-113 snapshots: assert the additive column was not backfilled, then hash their original columns.
function legacyTextColumn(key: string, value: unknown) {
  if (key === "textMaxLength") { assert.equal(value, null, "Frozen question acquired a text limit"); return undefined; }
  return legacyFormLanguageColumn(key, value);
}
const origin = new URL(env.BETTER_AUTH_URL).origin, database = new URL(env.DATABASE_URL);
assert.equal(origin, "http://localhost:3100"); assert.equal(database.pathname, "/catchsecu_dev");
assert(["localhost", "127.0.0.1"].includes(database.hostname));
const privateDir = ".local/rea-fullstack/form-authority", output = "docs/qa/R08-T02/authority-flow", file = privateDir + "/fixture.json";
type Fixture = { tag: string; email: string; password: string; cookie: string; userId: string; companyId: string; serviceId: string;
  formId: string; templateId: string; publishedId: string; removedFormId: string; removedTemplateId: string; fixedId: string; hash?: string; ready: boolean; snapshotSchema?: number };
let f: Fixture;
const checks: { action: string; status: number; code?: string }[] = [];
const save = () => writeFile(file, JSON.stringify(f, null, 2) + "\n", { mode: 0o600 });
async function request(action: string, path: string, status: number, body?: unknown, method = body === undefined ? "GET" : "POST", extra: Record<string, string> = {}) {
  const response = await fetch(origin + "/api/v1" + path, { method, headers: { origin, cookie: f.cookie, ...(body === undefined ? {} : { "content-type": "application/json" }),
    "idempotency-key": randomUUID(), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json().catch(() => null);
  checks.push({ action, status: response.status, code: value?.error?.code }); assert.equal(response.status, status, action + ": " + (value?.error?.code ?? ""));
  return { response, value };
}
async function snapshot() {
  return db.$transaction(async tx => ({
    company: await tx.company.findUniqueOrThrow({ where: { id: f.companyId } }),
    policy: await tx.securityPolicy.findUniqueOrThrow({ where: { tenantId: f.companyId } }),
    services: await tx.service.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
    forms: await tx.form.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" },
      include: { versions: { orderBy: { id: "asc" }, include: { questions: { orderBy: { order: "asc" }, include: { options: { orderBy: { order: "asc" } } } },
        documentBindings: { orderBy: { id: "asc" } } } }, publications: { orderBy: { id: "asc" } }, favorites: { orderBy: { memberId: "asc" } } } }),
    templates: await tx.formTemplate.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
    fixedUrls: await tx.fixedUrl.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
    audits: await tx.auditEvent.findMany({ where: { tenantId: f.companyId }, orderBy: { id: "asc" } }),
  }), { isolationLevel: "RepeatableRead" });
}
try {
  await mkdir(privateDir, { recursive: true, mode: 0o700 }); await mkdir(output, { recursive: true });
  const mode = process.argv[2];
  if (mode === "prepare") {
    assert(!await access(file).then(() => true, () => false), "Existing fixture must not be replaced");
    const tag = randomUUID().slice(0, 8);
    f = { tag, email: "rea-form-authority-" + tag + "@example.test", password: randomBytes(20).toString("hex") + "Aa!1", cookie: "", userId: "",
      companyId: "", serviceId: "", formId: "", templateId: "", publishedId: "", removedFormId: "", removedTemplateId: "", fixedId: "", ready: false, snapshotSchema: 111 }; await save();
    await request("register dedicated QA owner", "/auth/sign-up/email", 200, { email: f.email, password: f.password, name: "폼 권한 검증 소유자" });
    const user = await db.user.findUniqueOrThrow({ where: { email: f.email } }); f.userId = user.id;
    // Identity bootstrap only; this is not email-delivery acceptance evidence.
    await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
    const login = await request("login dedicated QA owner", "/auth/sign-in/email", 200, { email: f.email, password: f.password });
    f.cookie = login.response.headers.getSetCookie().map(item => item.split(";", 1)[0]).join("; "); await save();
    f.companyId = (await request("create QA company", "/companies", 201, { name: "폼 현재 권한 시험 " + tag, publicName: "폼 QA" })).value.id;
    f.serviceId = (await db.service.findFirstOrThrow({ where: { tenantId: f.companyId } })).id; await save();
    const input = { serviceId: f.serviceId, title: "권한 검증 폼", content: { body: "합성 질문과 선택", consentRequired: false, consentPurpose: "", retentionDays: 30,
      maxResponses: 20, questions: [{ id: randomUUID(), type: "단문형 답변", label: "이름", required: true },
        { id: randomUUID(), type: "객관식 답변", label: "선택", required: false, options: ["하나", "둘"] }] } };
    f.formId = (await request("create form", "/forms", 201, input)).value.id; await save();
    f.templateId = (await request("create template", "/templates", 201, { ...input, title: "권한 검증 템플릿", category: "QA" })).value.id; await save();
    await request("update form", "/forms/" + f.formId, 200, { version: 1, title: "HTTP 수정 폼" }, "PATCH");
    await request("reject stale form version", "/forms/" + f.formId, 409, { version: 1, title: "저장되면 안 됨" }, "PATCH");
    assert.equal((await request("read saved form", "/forms/" + f.formId, 200)).value.title, "HTTP 수정 폼");
    await request("favorite form", "/forms/" + f.formId + "/favorite", 200, undefined, "PUT");
    await request("remove favorite", "/forms/" + f.formId + "/favorite", 204, undefined, "DELETE");
    f.publishedId = (await request("copy form", "/forms/" + f.formId + "/copy", 201, { title: "게시 검증 복사 폼" })).value.id; await save();
    await request("publish copied form", "/forms/" + f.publishedId + "/publish", 201, { version: 1 });
    await request("pause published form", "/forms/" + f.publishedId + "/pause", 200, { version: 2 });
    await request("resume published form", "/forms/" + f.publishedId + "/resume", 200, { version: 3 });
    f.fixedId = (await request("create fixed URL", "/fixed-urls", 201, { formId: f.publishedId, name: "QA URL" })).value.id; await save();
    await request("update fixed URL", "/fixed-urls/" + f.fixedId, 200, { version: 1, name: "수정 QA URL" }, "PATCH");
    await request("revoke fixed URL", "/fixed-urls/" + f.fixedId, 204, undefined, "DELETE", { "if-match": "2" });
    await request("update template", "/templates/" + f.templateId, 200, { version: 1, title: "HTTP 수정 템플릿" }, "PATCH");
    await request("reject stale template version", "/templates/" + f.templateId, 409, { version: 1, title: "저장되면 안 됨" }, "PATCH");
    f.removedFormId = (await request("use template", "/templates/" + f.templateId + "/use", 201, { version: 2, serviceId: f.serviceId, title: "삭제 시험 폼" })).value.id; await save();
    await request("archive form", "/forms/" + f.removedFormId, 204, undefined, "DELETE", { "if-match": "1" });
    assert.equal((await request("deletion check", "/forms/" + f.removedFormId + "/deletion", 200)).value.canPurge, true);
    await request("purge form", "/forms/" + f.removedFormId + "/purge", 204, undefined, "DELETE", { "if-match": "2" });
    await request("purged form hidden", "/forms/" + f.removedFormId, 404);
    f.removedTemplateId = (await request("create disposable template", "/templates", 201, { ...input, title: "삭제 시험 템플릿", category: "QA" })).value.id; await save();
    await request("delete template", "/templates/" + f.removedTemplateId, 204, undefined, "DELETE", { "if-match": "1" });
    await request("deleted template hidden", "/templates/" + f.removedTemplateId, 404);
    await request("list forms", "/forms", 200); await request("list templates", "/templates?scope=company", 200);
    f.ready = true; await save();
    await writeFile(output + "/http.json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", emailVerifiedByDatabaseSetup: true, checks }, null, 2) + "\n");
    console.log(JSON.stringify({ ready: true, checks: checks.length }));
  } else {
    f = JSON.parse(await readFile(file, "utf8")); assert(f.ready); assert(!f.hash || mode === "verify", "Frozen fixture permits verify only");
    if (mode === "denied-template" || mode === "denied-form") {
      const template = mode === "denied-template";
      const row = template ? await db.formTemplate.findUniqueOrThrow({ where: { id: f.templateId } }) : await db.form.findUniqueOrThrow({ where: { id: f.formId } });
      assert.equal(row.title, template ? "HTTP 수정 템플릿" : "Ego 수정 폼"); assert.equal(row.version, template ? 2 : 3);
      await writeFile(output + "/" + mode + "-db.json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", id: row.id, title: row.title, version: row.version, rejectedWriteAbsent: true }, null, 2) + "\n");
      console.log(JSON.stringify({ result: "passed", mode, version: row.version }));
    } else if (mode === "deny" || mode === "restore") {
      await db.securityPolicy.update({ where: { tenantId: f.companyId }, data: { requireMfa: mode === "deny" } });
      // Scoped QA policy manipulation is intentional and recorded; not an admin UI acceptance claim.
      await writeFile(output + "/" + mode + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), scopedQaPolicySetup: true, requireMfa: mode === "deny" }, null, 2) + "\n");
      console.log(JSON.stringify({ requireMfa: mode === "deny" }));
    } else if (mode === "freeze" || mode === "verify") {
      const state = await snapshot(), main = state.forms.find(row => row.id === f.formId);
      assert.equal(main?.title, "Ego 수정 폼"); assert.equal(main.version, 3);
      assert.equal(state.templates.find(row => row.id === f.templateId)?.title, "Ego 수정 템플릿");
      assert.equal(state.templates.find(row => row.id === f.templateId)?.version, 3);
      assert.equal(state.forms.length, 2); assert.equal(state.templates.length, 1);
      assert.equal(state.forms.find(row => row.id === f.publishedId)?.status, "published");
      assert.equal(state.fixedUrls[0].status, "revoked"); assert.equal(state.policy.requireMfa, false);
      assert.equal(await db.form.count({ where: { id: f.removedFormId } }), 0);
      assert.equal(await db.formTemplate.count({ where: { id: f.removedTemplateId } }), 0);
      // Preserve the pre-migration frozen hash, while rejecting any backfill of its three additive fields.
      const hashState = (f.snapshotSchema ?? 109) >= 111 ? state : { ...state, forms: state.forms.map(form => ({ ...form,
        versions: form.versions.map(({ optionSchemaVersion, ...version }) => {
          assert.equal(optionSchemaVersion, 0);
          return { ...version, questions: version.questions.map(question => ({ ...question, options: question.options.map(({ stableKey, label, ...option }) => {
            assert.equal(stableKey, null); assert.equal(label, null); return option;
          }) })) };
        }) })) };
      const hash = createHash("sha256").update(JSON.stringify(hashState, legacyTextColumn)).digest("hex");
      let readAuditDelta = 0;
      if (mode === "freeze") { f.hash = hash; await save(); }
      else if (hash !== f.hash) {
        // Exact independently recorded read rows only; the original frozen fixture is never changed.
        const delta: { baselineHash: string; fullHash: string; addedAudits: { id: string; action: string; hash: string }[] } =
          JSON.parse(await readFile("docs/qa/R08-T02/identities/f1-read-audit-delta.json", "utf8"));
        assert.equal(delta.baselineHash, f.hash); assert.equal(hash, delta.fullHash); assert.equal(delta.addedAudits.length, 2);
        const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value, legacyTextColumn)).digest("hex");
        for (const added of delta.addedAudits) {
          const row = state.audits.find(audit => audit.id === added.id); assert(row);
          assert(["analytics.dashboard_viewed", "marketing.summary_viewed"].includes(row.action));
          assert.equal(row.action, added.action); assert.equal(digest(row), added.hash);
        }
        const original = { ...hashState, audits: hashState.audits.filter(row => !delta.addedAudits.some(added => added.id === row.id)) };
        assert.equal(digest(original), f.hash, "Non-read frozen DB state changed"); readAuditDelta = 2;
      }
      await writeFile(output + "/" + mode + ".json", JSON.stringify({ checkedAt: new Date().toISOString(), result: "passed", hash, baselineHash: f.hash, readAuditDelta, matched: mode === "verify",
        forms: state.forms.map(row => ({ id: row.id, title: row.title, version: row.version, status: row.status })), templates: state.templates.map(row => ({ id: row.id, title: row.title, version: row.version })),
        fixedUrls: state.fixedUrls.length, auditCount: state.audits.length, rejectedEditsAbsent: true }, null, 2) + "\n");
      console.log(JSON.stringify({ result: "passed", mode, hash, auditCount: state.audits.length }));
    } else throw new Error("Unknown mode");
  }
} finally { await db.$disconnect(); }
