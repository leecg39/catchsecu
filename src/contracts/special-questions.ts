import { z } from "zod";

export const specialQuestionTypes: readonly string[] = ["연락처", "이메일", "이메일 직접 입력", "생년월일"];
export const emailQuestionTypes: readonly string[] = ["이메일", "이메일 직접 입력"];
export const domesticPhonePrefixes = ["010", "070", "02", "031", "032", "033", "041", "042", "043", "044", "051", "052", "053", "054", "055", "061", "062", "063", "064"] as const;
export const emailDomains = ["naver.com", "gmail.com", "hanmail.net", "daum.net", "nate.com"] as const;

export function serializeDomesticPhone(prefix: string, number: string) {
  if (!number) return "";
  return prefix + "-" + (number.length > 4 ? number.slice(0, -4) + "-" + number.slice(-4) : number);
}
export function parseDomesticPhone(value: string) {
  const parts = value.split("-");
  return { prefix: parts.length > 1 ? parts.shift()! : "010", number: parts.join("") };
}
export function isCalendarBirth(value: string) {
  if (!/^\d{8}$/.test(value)) return false;
  const iso = value.slice(0, 4) + "-" + value.slice(4, 6) + "-" + value.slice(6);
  const date = new Date(iso + "T00:00:00.000Z");
  return Number(value.slice(0, 4)) >= 1 && !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === iso;
}
/** Bounded built-in validators, never an arbitrary user-supplied regular expression. */
export function specialAnswerError(type: string, value: string): string | undefined {
  if (!value.trim()) return undefined;
  const text = value.trim();
  if (type === "연락처" && !/^\d{2,4}-\d{3,4}-\d{4}$/.test(text)) return "앞자리와 뒤 번호 7~8자리를 입력해주세요.";
  if (emailQuestionTypes.includes(type)) {
    const max = type === "이메일 직접 입력" ? 100 : 201;
    if (text.length > max || !z.email().safeParse(text).success) return "유효한 이메일 주소를 입력해주세요.";
    const [local, domain] = text.split("@");
    if (local.length > 100 || domain.length > 100) return "이메일 아이디와 도메인은 각각 100자 이내로 입력해주세요.";
  }
  if (type === "생년월일" && !isCalendarBirth(text)) return "생년월일을 유효한 YYYYMMDD 8자리로 입력해주세요.";
  return undefined;
}
