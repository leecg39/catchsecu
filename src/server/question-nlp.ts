import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { matrixTypes } from "@/contracts/questions";
import { NLP_ENGINE_ID, nlpAnalyzeInput, nlpFeedbackInput, type PersonalInformationRule } from "@/contracts/question-nlp";
import { db, type Transaction } from "./db";
import type { Context } from "./context";
import { fail } from "./http";
import { audit } from "./audit";
import { lockServiceActor } from "./service-actor";
import { assertFileDeadlines } from "./file-access";

/**
 * Local deterministic classifier replacing the original product's unobserved NLP
 * service (U02). Ordered Korean dictionary/pattern rules; first match per entity
 * name wins, items keep match order. Non-Korean input and matrix question types
 * return no proposals — matrix questions cannot carry personal classifications.
 */
const rules: PersonalInformationRule[] = [
  { pattern: /주민\s*등록|주민\s*번호|rrn/i, type: "RESIDENT", name: "주민등록번호", suggest: "단문형 답변" },
  { pattern: /여권/, type: "IDENTIFICATION", name: "여권번호" },
  { pattern: /운전\s*면허|면허\s*번호/, type: "IDENTIFICATION", name: "운전면허번호" },
  { pattern: /외국인\s*등록/, type: "IDENTIFICATION", name: "외국인등록번호" },
  { pattern: /건강|병력|진료|질병|질환|장애|임신|수술|알레르기|복용|약물/, type: "SENSITIVE", name: "건강정보" },
  { pattern: /생체|지문|얼굴|홍채|음성/, type: "SENSITIVE", name: "생체정보" },
  { pattern: /위치|gps|좌표/i, type: "SENSITIVE", name: "위치정보" },
  { pattern: /정치|사상|신념|노조|종교/, type: "SENSITIVE", name: "민감정보" },
  { pattern: /계좌|신용\s*카드|카드\s*번호|결제\s*정보/, type: "SENSITIVE", name: "결제정보" },
  { pattern: /이메일|e-?mail/i, type: "PERSONAL_INFORMATION", name: "이메일", suggest: "이메일 직접 입력" },
  { pattern: /휴대\s*(폰|전화)|핸드폰|전화\s*번호|연락처/, type: "PERSONAL_INFORMATION", name: "휴대폰번호", suggest: "연락처" },
  { pattern: /이름|성명|성함/, type: "PERSONAL_INFORMATION", name: "성명" },
  { pattern: /생년월일|생일|출생/, type: "PERSONAL_INFORMATION", name: "생년월일", suggest: "생년월일" },
  { pattern: /주소|거주지|자택/, type: "PERSONAL_INFORMATION", name: "주소", suggest: "주소" },
  { pattern: /소속|회사명|직장|직책|부서|학교|학번|사번/, type: "PERSONAL_INFORMATION", name: "소속정보" },
  { pattern: /아이디|계정|닉네임|sns|소셜/i, type: "PERSONAL_INFORMATION", name: "계정정보" },
];

export function classifyText(input: { label: string; optionLabels?: string[]; questionType: string }) {
  if (matrixTypes.includes(input.questionType)) return { items: [] as { name: string; type: PersonalInformationRule["type"]; position: number; suggest?: string }[] };
  const sources = [{ text: input.label, base: 0 }, ...(input.optionLabels ?? []).map((text, index) => ({ text, base: (index + 1) * 10000 }))];
  const seen = new Set<string>(), hits: { name: string; type: PersonalInformationRule["type"]; position: number; suggest?: string }[] = [];
  for (const source of sources)
    for (const rule of rules) {
      const match = rule.pattern.exec(source.text);
      if (match && !seen.has(rule.name)) {
        seen.add(rule.name);
        hits.push({ name: rule.name, type: rule.type, position: source.base + match.index, suggest: rule.suggest });
      }
    }
  hits.sort((a, b) => a.position - b.position);
  return { items: hits.slice(0, 20) };
}

async function lockService(tx: Transaction, ctx: Context, serviceId: string) {
  const actor = await lockServiceActor(tx, ctx, "form.write");
  const service = await tx.service.findFirst({ where: { AND: [actor.scope, { id: serviceId }] } });
  if (!service) {
    if (!await tx.service.count({ where: { id: serviceId, tenantId: ctx.tenantId } })) fail(404, "NOT_FOUND", "서비스를 찾을 수 없습니다.");
    fail(403, "SERVICE_FORBIDDEN", "해당 서비스에 대한 권한이 없습니다.");
  }
  if (service.status !== "active") fail(409, "SERVICE_ARCHIVED", "보관된 서비스에서는 문항 분석을 사용할 수 없습니다.");
  return actor.deadlines;
}

export async function analyzePersonalInformation(ctx: Context, serviceId: string, input: z.infer<typeof nlpAnalyzeInput>) {
  return db.$transaction(async tx => {
    const deadlines = await lockService(tx, ctx, serviceId);
    assertFileDeadlines(deadlines);
    // Automatic analysis is a Korean-only deterministic suggestion; it is a read-like
    // authoring aid and does not write audit rows per call.
    if (!input.formLanguage.startsWith("ko")) return { engine: NLP_ENGINE_ID, items: [], suggestedType: null };
    const { items } = classifyText(input);
    const suggestedType = items.find(hit => hit.suggest)?.suggest ?? null;
    return { engine: NLP_ENGINE_ID, suggestedType,
      items: items.map(hit => ({ nlpFeedbackId: randomUUID(), personalInformationType: hit.type,
        detectedPersonalInformation: hit.name, personalInformationSource: "NLP" as const })) };
  });
}

export async function recordPersonalInformationFeedback(ctx: Context, serviceId: string, input: z.infer<typeof nlpFeedbackInput>, requestId: string) {
  return db.$transaction(async tx => {
    const deadlines = await lockService(tx, ctx, serviceId);
    // Classification names are personal-information-like values; persist only counts
    // and classification type enums, never the detected names themselves.
    const types = [...new Set(input.corrected.map(item => item.personalInformationType))];
    await audit(tx, ctx, requestId, "form.question_pi_feedback", "service", serviceId,
      types.map(type => "corrected:" + type), serviceId, { count: input.corrected.length });
    assertFileDeadlines(deadlines);
    return { recorded: true };
  });
}
