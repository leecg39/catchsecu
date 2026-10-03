import { createHash } from "node:crypto";
import { db } from "../src/server/db";
import { encrypt, tokenHash } from "../src/server/crypto";
import { privateFiles } from "../src/server/file-storage";
import { subjectHashes } from "../src/server/subject-identity";
import {
  actors, companies, externalScenarios, fixedSlug, noticeId, records, services, subjectContact, tokens, users,
} from "../src/server/fixtures/catalog";

const retention = new Date("2030-01-01T00:00:00.000Z");
const subjectAccessExpiry = new Date("2030-01-01T00:00:00.000Z");
const fileBytes = Buffer.from("catchsecu route fixture\n", "utf8");
const fileHash = createHash("sha256").update(fileBytes).digest("hex");

async function once<T>(find: () => Promise<T | null>, create: () => Promise<T>) {
  return await find() ?? await create();
}
function snapshot(type: "consent" | "privacy_policy" | "overseas_transfer", title: string) {
  const value = {
    schemaVersion: 1, type, title, body: title + " 본문입니다.", refusalNotice: "", rightsContact: "",
    effectiveDate: "2026-10-03", companyName: "캐치시큐 테스트 회사 A", serviceName: "기본 서비스", purposes: [], recipients: [],
  };
  const rendered = [title, value.body].join("\n");
  return { snapshot: value, renderedText: rendered, contentHash: createHash("sha256").update(rendered).digest("hex") };
}

export async function seedRouteFixtures() {
  const company = await db.company.findUnique({ where: { id: companies.a } });
  const owner = await db.user.findUnique({ where: { id: users.ownerA } });
  if (!company || !owner) throw new Error("회사 A와 역할 계정이 없습니다. npm run db:seed를 먼저 실행하세요.");
  const hashes = subjectHashes(subjectContact.name, subjectContact.email);
  await db.$transaction(async tx => {
    await tx.form.upsert({ where: { id: records.form }, update: {}, create: {
      id: records.form, tenantId: companies.a, serviceId: services.a, ownerId: users.ownerA,
      title: "라우트 fixture 폼", status: "draft", sourceType: "form",
    } });
    await once(() => tx.formVersion.findUnique({ where: { id: records.formVersion } }), async () => {
      const version = await tx.formVersion.create({ data: {
        id: records.formVersion, tenantId: companies.a, formId: records.form, number: 1, title: "라우트 fixture 폼",
        status: "draft", body: "고정 fixture 본문", consentPurpose: "라우트 이동 검증",
      } });
      for (const question of [
        { id: records.questionName, stableKey: "name", subjectRole: "name", type: "단문형 답변", label: "이름", order: 0 },
        { id: records.questionEmail, stableKey: "email", subjectRole: "email", type: "단문형 답변", label: "이메일", order: 1 },
        { id: records.questionFile, stableKey: "file", subjectRole: null, type: "파일 업로드", label: "첨부", order: 2 },
      ]) await tx.question.create({ data: {
        ...question, tenantId: companies.a, formVersionId: version.id, required: question.stableKey !== "file",
      } });
      return tx.formVersion.update({ where: { id: version.id }, data: { status: "published", publishedAt: new Date("2026-10-03T00:00:00.000Z") } });
    });
    await tx.form.update({ where: { id: records.form }, data: { status: "published", publishedVersionId: records.formVersion } });
    await once(() => tx.publication.findUnique({ where: { id: records.publication } }), async () => {
      const policy = await tx.securityPolicy.findUniqueOrThrow({ where: { tenantId: companies.a } });
      let approvalId: string | null = null;
      if (policy.requireApproval) {
        const ownerMember = await tx.membership.findUniqueOrThrow({ where: { tenantId_userId: { tenantId: companies.a, userId: users.ownerA } } });
        const reviewer = await tx.membership.findUniqueOrThrow({ where: { tenantId_userId: { tenantId: companies.a, userId: users.securityA } } });
        const approval = await tx.approvalRequest.create({ data: {
          id: records.approval, tenantId: companies.a, formId: records.form, formVersionId: records.formVersion,
          formRevision: 1, policyRevision: policy.approvalRevision, contentHash: tokenHash("route-fixture-form"),
          snapshot: { title: "라우트 fixture 폼" }, requestCipher: encrypt({ purpose: "라우트 fixture", reference: "P00-T04" }),
          requestedBy: ownerMember.id, status: "pending", version: 1,
        } });
        await tx.approvalRequest.update({ where: { id: approval.id }, data: {
          status: "approved", version: 2, decidedBy: reviewer.id, decidedAt: new Date("2026-10-03T00:00:00.000Z"),
          decisionCipher: encrypt({ decision: "approved" }),
        } });
        approvalId = approval.id;
      }
      const publication = await tx.publication.create({ data: {
        id: records.publication, tenantId: companies.a, formId: records.form, formVersionId: records.formVersion, approvalId,
        tokenHash: tokenHash(tokens.publicForm), tokenCipher: encrypt(tokens.publicForm), maxResponses: 100, status: "active",
      } });
      if (approvalId) await tx.approvalRequest.update({ where: { id: approvalId }, data: { status: "consumed", version: 3 } });
      return publication;
    });
    await tx.fixedUrl.upsert({ where: { id: records.fixedUrl }, update: {}, create: {
      id: records.fixedUrl, tenantId: companies.a, publicationId: records.publication, slug: fixedSlug, name: "라우트 fixture 고정 URL", status: "active",
    } });
    await tx.submission.upsert({ where: { id: records.submission }, update: {}, create: {
      id: records.submission, tenantId: companies.a, formVersionId: records.formVersion, publicationId: records.publication,
      status: "submitted", retentionUntil: retention, originalRetentionUntil: retention,
    } });
    for (const answer of [
      { id: records.answerName, questionId: records.questionName, value: subjectContact.name },
      { id: records.answerEmail, questionId: records.questionEmail, value: subjectContact.email },
    ]) await tx.answer.upsert({ where: { id: answer.id }, update: {}, create: {
      id: answer.id, tenantId: companies.a, submissionId: records.submission, formVersionId: records.formVersion,
      questionId: answer.questionId, valueCipher: encrypt(answer.value), valueType: "단문형 답변",
    } });
    await tx.consentReceipt.upsert({ where: { id: records.receipt }, update: {}, create: {
      id: records.receipt, tenantId: companies.a, submissionId: records.submission, purpose: "라우트 fixture",
      documentHash: tokenHash("route-fixture-receipt"), retentionDays: 365,
    } });
    const subject = await tx.dataSubject.upsert({
      where: { tenantId_serviceId_identityHash: { tenantId: companies.a, serviceId: services.a, identityHash: hashes.identityHash } },
      update: {}, create: {
        id: records.subject, tenantId: companies.a, serviceId: services.a, identityHash: hashes.identityHash,
        nameHash: hashes.nameHash, emailHash: hashes.emailHash, contactCipher: encrypt(hashes.normalized),
      },
    });
    await tx.submission.update({ where: { id: records.submission }, data: { subjectId: subject.id } });
    await once(() => tx.subjectAccessRequest.findUnique({ where: { id: records.subjectAccess } }), () => tx.subjectAccessRequest.create({ data: {
      id: records.subjectAccess, tokenHash: tokenHash(tokens.subjectAccess), browserHash: tokenHash(tokens.subjectBrowser), expiresAt: subjectAccessExpiry,
    } }));
    await tx.subjectAccessScope.upsert({
      where: { requestId_subjectId: { requestId: records.subjectAccess, subjectId: subject.id } },
      update: {}, create: { requestId: records.subjectAccess, tenantId: companies.a, subjectId: subject.id },
    });
    await once(() => tx.fileObject.findUnique({ where: { id: records.file } }), () => tx.fileObject.create({ data: {
      id: records.file, tenantId: companies.a, serviceId: services.a, ownerKind: "public", storageKey: records.file,
      mime: "text/plain", size: fileBytes.length, sha256: fileHash, nameCipher: encrypt("fixture.txt"),
      publicationId: records.publication, formVersionId: records.formVersion, questionId: records.questionFile,
      uploadTokenHash: tokenHash(tokens.fileUpload), expiresAt: retention, status: "pending", scanStatus: "pending",
    } }));
    const documents = [
      ["consent", records.consentDocument, records.consentVersion, records.consentPublication, tokens.documentConsent, "수집 동의 fixture"],
      ["privacy_policy", records.policyDocument, records.policyVersion, records.policyPublication, tokens.documentPolicy, "처리방침 fixture"],
      ["overseas_transfer", records.overseasDocument, records.overseasVersion, records.overseasPublication, tokens.documentOverseas, "국외이전 fixture"],
    ] as const;
    for (const [type, id, versionId, publicationId, token, title] of documents) {
      await once(() => tx.document.findUnique({ where: { id } }), () => tx.document.create({ data: {
        id, tenantId: companies.a, serviceId: services.a, createdBy: users.ownerA, type, title, body: title + " 본문입니다.",
        effectiveDate: "2026-10-03", status: "published",
      } }));
      const body = snapshot(type, title);
      await once(() => tx.documentVersion.findUnique({ where: { id: versionId } }), () => tx.documentVersion.create({ data: {
        id: versionId, tenantId: companies.a, serviceId: services.a, documentId: id, number: 1, draftRevision: 1, ...body,
      } }));
      await once(() => tx.documentPublication.findUnique({ where: { id: publicationId } }), () => tx.documentPublication.create({ data: {
        id: publicationId, tenantId: companies.a, serviceId: services.a, documentId: id, documentVersionId: versionId,
        tokenHash: tokenHash(token), tokenCipher: encrypt(token), status: "active",
      } }));
    }
    await tx.supportTicket.upsert({ where: { id: records.supportTicket }, update: {}, create: {
      id: records.supportTicket, tenantId: companies.a, serviceId: services.a, authorId: users.ownerA, kind: "inquiry",
      status: "submitted", subjectCipher: encrypt("라우트 fixture 문의"), bodyCipher: encrypt("목록 이동 확인용 문의입니다."),
    } });
    await once(() => tx.messageTemplate.findUnique({ where: { id: records.messageTemplate } }), async () => {
      const content = { subject: "fixture", html: "<p>라우트 fixture</p>" };
      const contentCipher = encrypt(content), contentHash = tokenHash(JSON.stringify(content));
      const row = await tx.messageTemplate.create({ data: {
        id: records.messageTemplate, tenantId: companies.a, serviceId: services.a, creatorId: users.ownerA,
        channel: "email", name: "라우트 fixture 템플릿", contentCipher, contentHash, status: "active", version: 1,
      } });
      await tx.messageTemplateRevision.create({ data: {
        templateId: row.id, tenantId: companies.a, serviceId: services.a, version: 1, name: row.name,
        contentCipher, contentHash, kind: "created", actorId: users.ownerA,
      } });
      return row;
    });
  }, { timeout: 30000 });
  await privateFiles.write(records.file, fileBytes);
  const emptyCompanyForms = await db.form.count({ where: { tenantId: companies.b } });
  const restrictedServiceForms = await db.form.count({ where: { serviceId: services.aRestricted } });
  const roleCount = await db.user.count({ where: { id: { in: actors.map(actor => actor.userId) } } });
  const notice = await db.notice.findUnique({ where: { id: noticeId }, select: { status: true } });
  if (emptyCompanyForms !== 0 || restrictedServiceForms !== 0 || roleCount !== actors.length || notice?.status !== "published")
    throw new Error("역할·빈 회사·공지 fixture 상태가 기대와 다릅니다.");
  return { actors: actors.length, scenarios: externalScenarios.length, noticeId, fileBytes: fileBytes.length, fileSha256: fileHash };
}
