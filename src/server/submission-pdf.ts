import type { FileInfo } from "@/contracts/files";
import type { Question } from "@/contracts/forms";
import { fileAnswerId, isFileQuestion } from "@/contracts/drawing-questions";
import { formatAnswer, isEmptyAnswer, type Answers } from "@/contracts/questions";
import type { Context } from "./context";
import { decrypt } from "./crypto";
import { canonicalDocument } from "./documents";
import { db } from "./db";
import { fileInfo, canReadFiles } from "./file-access";
import { contentDto } from "./forms";
import { fail } from "./http";
import { renderPdf, sha256 } from "./pdf-renderer";
import { lockSubmission, requireSubmissionContent } from "./submission-access";
import { audit } from "./audit";

const statusLabels: Record<string, string> = {
  submitted: "제출 완료",
  corrected: "정정",
  withdrawn: "철회",
  pendingDestruction: "파기 요청",
  destroying: "파기 처리 중",
  destroyed: "파기 완료",
};

export type SubmissionPdfProjection = {
  schemaVersion: 1;
  submissionId: string;
  formId: string;
  formTitle: string;
  formVersion: number;
  submissionVersion: number;
  status: string;
  source: "form" | "csv";
  submittedAt: string;
  retentionUntil: string;
  legalHold: boolean;
  questions: Array<{
    id: string;
    type: string;
    label: string;
    required: boolean;
    answer: string;
  }>;
};

type ProjectionInput = {
  submissionId: string;
  formId: string;
  formTitle: string;
  formVersion: number;
  submissionVersion: number;
  status: string;
  source: "form" | "csv";
  submittedAt: Date;
  retentionUntil: Date;
  legalHold: boolean;
  questions: Question[];
  values: Answers;
  attachments: FileInfo[];
};

function answerText(question: Question, value: Answers[string], attachments: FileInfo[]) {
  if (!isFileQuestion(question.type)) return formatAnswer(value, question.rows, question.optionDefinitions, question.type);
  if (isEmptyAnswer(value)) return "-";
  const id = fileAnswerId(value);
  const file = id ? attachments.find(item => item.id === id && item.questionId === question.id) : undefined;
  return file?.name ?? "열람할 수 없는 첨부파일";
}

export function projectSubmissionPdf(input: ProjectionInput): SubmissionPdfProjection {
  return {
    schemaVersion: 1,
    submissionId: input.submissionId,
    formId: input.formId,
    formTitle: input.formTitle,
    formVersion: input.formVersion,
    submissionVersion: input.submissionVersion,
    status: input.status,
    source: input.source,
    submittedAt: input.submittedAt.toISOString(),
    retentionUntil: input.retentionUntil.toISOString(),
    legalHold: input.legalHold,
    questions: input.questions.map(question => ({
      id: question.id,
      type: question.type,
      label: question.label,
      required: question.required,
      answer: answerText(question, input.values[question.id], input.attachments),
    })),
  };
}

export function renderSubmissionPdfText(snapshot: SubmissionPdfProjection) {
  const lines = [
    snapshot.formTitle,
    "응답 ID: " + snapshot.submissionId,
    "폼 ID: " + snapshot.formId,
    "폼 버전: " + snapshot.formVersion,
    "응답 버전: " + snapshot.submissionVersion,
    "상태: " + (statusLabels[snapshot.status] ?? snapshot.status),
    "수집 방식: " + (snapshot.source === "csv" ? "CSV 가져오기" : "공개 폼 제출"),
    "제출 시각: " + snapshot.submittedAt,
    "보유 기한: " + snapshot.retentionUntil,
    "보존 조치: " + (snapshot.legalHold ? "적용" : "미적용"),
    "",
    "응답 내용",
  ];
  for (const [index, question] of snapshot.questions.entries()) {
    lines.push("", `${index + 1}. ${question.label}`, `유형: ${question.type} · ${question.required ? "필수" : "선택"}`, question.answer);
  }
  return lines.join("\n");
}

function values(row: Awaited<ReturnType<typeof lockSubmission>>): Answers {
  const byQuestion = new Map(row.answers.map(answer => [answer.questionId, answer]));
  return Object.fromEntries(row.formVersion.questions.map(question => {
    const answer = byQuestion.get(question.id);
    return [question.stableKey, answer ? decrypt<Answers[string]>(answer.valueCipher) : ""];
  }));
}

async function snapshot(ctx: Context, id: string) {
  return db.$transaction(async tx => {
    const row = await lockSubmission(tx, ctx, id, "submission.read");
    requireSubmissionContent(row);
    const mayReadFiles = await canReadFiles(tx, ctx, row.formVersion.form.serviceId);
    const attachments = mayReadFiles ? await tx.fileObject.findMany({
      where: { tenantId: ctx.tenantId, submissionId: id, status: "attached", scanStatus: "clean" },
      include: { question: { select: { stableKey: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }) : [];
    return {
      serviceId: row.formVersion.form.serviceId,
      formVersionId: row.formVersionId,
      version: row.version,
      mayReadFiles,
      projection: projectSubmissionPdf({
        submissionId: row.id,
        formId: row.formVersion.form.id,
        formTitle: row.formVersion.title,
        formVersion: row.formVersion.number,
        submissionVersion: row.version,
        status: row.status,
        source: row.importJobId ? "csv" : "form",
        submittedAt: row.submittedAt,
        retentionUntil: row.retentionUntil,
        legalHold: row.legalHold,
        questions: contentDto(row.formVersion).questions,
        values: values(row),
        attachments: attachments.map(fileInfo),
      }),
    };
  });
}

export async function privateSubmissionPdf(ctx: Context, id: string, requestId: string) {
  const prepared = await snapshot(ctx, id);
  const canonical = canonicalDocument(prepared.projection), contentHash = sha256(canonical);
  const rendered = await renderPdf({
    title: prepared.projection.formTitle + " 응답",
    author: "Catchsecu",
    text: renderSubmissionPdfText(prepared.projection),
    contentHash,
    version: prepared.version,
    publishedAt: new Date(prepared.projection.submittedAt),
    label: "응답 스냅샷",
  });

  await db.$transaction(async tx => {
    const current = await lockSubmission(tx, ctx, id, "submission.read");
    requireSubmissionContent(current);
    const mayReadFiles = await canReadFiles(tx, ctx, current.formVersion.form.serviceId);
    if (current.version !== prepared.version || current.formVersionId !== prepared.formVersionId || mayReadFiles !== prepared.mayReadFiles)
      fail(409, "SUBMISSION_CHANGED", "PDF를 만드는 동안 응답 또는 열람 권한이 변경되었습니다. 다시 시도해주세요.");
    await audit(tx, ctx, requestId, "submission.pdf_downloaded", "submission", id, [], prepared.serviceId);
  });

  return {
    bytes: rendered.bytes,
    pdfHash: rendered.pdfHash,
    contentHash,
    filename: prepared.projection.formTitle + "-응답-" + id + ".pdf",
  };
}
