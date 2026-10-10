import { z } from "zod";

export const formLanguageCodes = ["ko", "en", "ja", "zh-CN", "zh-TW", "de", "fr", "ru", "es", "pt", "id", "th", "vi", "tr", "it", "ar"] as const;
export const formLanguageSchema = z.enum(formLanguageCodes);
export type FormLanguage = z.infer<typeof formLanguageSchema>;
export const formLanguages: readonly { code: FormLanguage; label: string; nativeName: string; koreanName: string; rtl?: boolean }[] = [
  { code: "ko", label: "한국어(기본)", nativeName: "한국어", koreanName: "한국어" },
  { code: "en", label: "English 영어", nativeName: "English", koreanName: "영어" },
  { code: "ja", label: "日本語 일본어", nativeName: "日本語", koreanName: "일본어" },
  { code: "zh-CN", label: "中文(简体) 중국어(간체)", nativeName: "中文(简体)", koreanName: "중국어(간체)" },
  { code: "zh-TW", label: "中文(繁體) 중국어(번체)", nativeName: "中文(繁體)", koreanName: "중국어(번체)" },
  { code: "de", label: "Deutsch 독일어", nativeName: "Deutsch", koreanName: "독일어" },
  { code: "fr", label: "Français 프랑스어", nativeName: "Français", koreanName: "프랑스어" },
  { code: "ru", label: "Русский 러시아어", nativeName: "Русский", koreanName: "러시아어" },
  { code: "es", label: "Español 스페인어", nativeName: "Español", koreanName: "스페인어" },
  { code: "pt", label: "Português 포루투칼어", nativeName: "Português", koreanName: "포루투칼어" },
  { code: "id", label: "Bahasa Indonesia 인도네시아어", nativeName: "Bahasa Indonesia", koreanName: "인도네시아어" },
  { code: "th", label: "ภาษาไทย 태국어", nativeName: "ภาษาไทย", koreanName: "태국어" },
  { code: "vi", label: "Tiếng Việt 베트남어", nativeName: "Tiếng Việt", koreanName: "베트남어" },
  { code: "tr", label: "Türkçe 튀르키에어", nativeName: "Türkçe", koreanName: "튀르키에어" },
  { code: "it", label: "Italiano 이탈리아어", nativeName: "Italiano", koreanName: "이탈리아어" },
  { code: "ar", label: "العربية 아랍어", nativeName: "العربية", koreanName: "아랍어", rtl: true },
];
// Display fallback only. Writers must use the strict schema rather than coerce invalid codes.
export function effectiveFormLanguage(value?: string | null): FormLanguage { return formLanguageSchema.safeParse(value).data ?? "ko"; }
export function isInternationalFormLanguage(value?: string | null): boolean { return effectiveFormLanguage(value) !== "ko"; }
export function formLanguageLabel(value?: string | null): string { return formLanguages.find(language => language.code === effectiveFormLanguage(value))!.label; }
export function validateFormLanguageVerification(content: { formLanguage?: string | null; verify?: boolean }) {
  if (content.verify && isInternationalFormLanguage(content.formLanguage)) throw new Error("본인인증 및 전자서명은 한국어 폼에서만 사용할 수 있습니다.");
}
