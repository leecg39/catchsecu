import { z } from "zod";

/**
 * Source-observed CatchForm information-pattern identifiers. The product never
 * accepts or persists a caller supplied regular expression. Each identifier is
 * bound to one local question type and a fixed, bounded validator.
 */
export const infoPatternIds = [1, 2, 3, 4, 7, 8] as const;
export const infoPatternIdSchema = z.union(infoPatternIds.map(value => z.literal(value)) as [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>, z.ZodLiteral<4>, z.ZodLiteral<7>, z.ZodLiteral<8>]);
export type InfoPatternId = z.infer<typeof infoPatternIdSchema>;

export const infoPatternCatalog: readonly { id: InfoPatternId; name: string; questionTypes: readonly string[] }[] = [
  { id: 1, name: "일반", questionTypes: ["단문형 답변"] },
  { id: 2, name: "추가질의", questionTypes: ["장문형 답변"] },
  { id: 3, name: "주민등록번호", questionTypes: ["단문형 답변"] },
  { id: 4, name: "이메일", questionTypes: ["이메일 직접 입력"] },
  { id: 7, name: "주소", questionTypes: ["주소"] },
  { id: 8, name: "날짜", questionTypes: ["생년월일"] },
];

export function defaultInfoPatternId(type: string): InfoPatternId | undefined {
  if (type === "단문형 답변") return 1;
  if (type === "장문형 답변") return 2;
  if (type === "이메일 직접 입력") return 4;
  if (type === "주소") return 7;
  if (type === "생년월일") return 8;
  return undefined;
}

export function infoPatternError(type: string, infoPatternId?: number | null, subjectRole?: string | null): string | null {
  if (infoPatternId == null) return null;
  const pattern = infoPatternCatalog.find(item => item.id === infoPatternId);
  if (!pattern || !pattern.questionTypes.includes(type)) return "입력 형식은 호환되는 질문 유형에만 지정해주세요.";
  if (infoPatternId === 3 && subjectRole) return "정보주체 이름·이메일 질문에는 주민등록번호 형식을 지정할 수 없습니다.";
  return null;
}

function onlyAsciiDigits(value: string, start: number, end: number) {
  for (let index = start; index < end; index++) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

/** Fixed O(n) validation with a 100-character caller bound; no dynamic RegExp. */
export function infoPatternAnswerError(infoPatternId: number | null | undefined, value: string): string | null {
  const text = value.trim();
  if (!text || infoPatternId == null || infoPatternId === 1 || infoPatternId === 2) return null;
  if (text.length > 100) return "입력 형식을 확인해주세요.";
  if (infoPatternId === 3)
    return text.length === 14 && text.charCodeAt(6) === 45 && onlyAsciiDigits(text, 0, 6) && onlyAsciiDigits(text, 7, 14)
      ? null : "주민등록번호를 000000-0000000 형식으로 입력해주세요.";
  // IDs 4, 7 and 8 are validated by their dedicated question contracts.
  return null;
}

export function formatResidentRegistrationInput(value: string): string {
  let digits = "";
  for (let index = 0; index < value.length && digits.length < 13; index++) {
    const code = value.charCodeAt(index);
    if (code >= 48 && code <= 57) digits += value[index];
  }
  return digits.length > 6 ? digits.slice(0, 6) + "-" + digits.slice(6) : digits;
}
