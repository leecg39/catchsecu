import { z } from "zod";
export const subjectName = z.string().trim().min(1).max(100).refine(value => !/[\u0000-\u001f\u007f]/.test(value), "이름에 제어 문자를 사용할 수 없습니다.");
export const subjectEmail = z.string().trim().toLowerCase().max(254).pipe(z.email());
export const subjectRole = z.enum(["name", "email"]);
export type SubjectRole = z.infer<typeof subjectRole>;
export function normalizeSubjectName(value: string) { return subjectName.parse(value.normalize("NFC").replace(/\s+/g, " ")); }
export function normalizeSubjectEmail(value: string) { return subjectEmail.parse(value); }
export type SubjectQuestion = { subjectRole?: string | null; type: string; required: boolean };
export function checkSubjectQuestions(questions: SubjectQuestion[], publishing = false) {
  const chosen = questions.filter(q => q.subjectRole);
  if (chosen.some(q => q.type !== "단문형 답변" || !q.required)) throw new Error("정보주체 이름·이메일은 필수 단문형 답변에 지정해주세요.");
  if (new Set(chosen.map(q => q.subjectRole)).size !== chosen.length) throw new Error("정보주체 이름과 이메일은 각각 한 번만 지정할 수 있습니다.");
  if (publishing && chosen.length === 1) throw new Error("정보주체 조회를 사용하려면 이름과 이메일을 모두 지정해주세요.");
}

export const subjectAccessInput = z.object({ name: subjectName, email: subjectEmail, consent: z.literal(true) }).strict();
export const subjectSessionInput = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
export const subjectWithdrawalInput = z.object({ submissionId: z.uuid(), version: z.number().int().positive() }).strict();
export type SubjectSessionInfo = { id: string; expiresAt: string };
export type SubjectConsent = { id: string; version: number; company: string; service: string; title: string; status: string;
  submittedAt: string; retentionUntil: string; canWithdraw: boolean;
  receipts: { id: string; purpose: string; grantedAt: string; retentionDays: number; documentHash: string; withdrawnAt: string | null }[] };
export type SubjectEvent = { id: string; type: string; createdAt: string; submissionId: string; title: string; company: string; service: string; purpose: string };
export type SubjectPage<T> = { items: T[]; page: number; pageSize: number; total: number };
export type SubjectWithdrawalRecord = { id: string; sessionId: string; title: string; company: string; service: string; status: string; createdAt: string; finishedAt: string | null };
