import copy from "@/data/form-system-copy.json";
import { effectiveFormLanguage, type FormLanguage } from "./form-language";

export function formSystemCopy(language?: string | null) {
  return copy[effectiveFormLanguage(language)].translate.infoOwnerForm;
}
export function formCopyText(value: string, variables: Readonly<Record<string, string | number>> = {}) {
  // Strip source component markers before interpolation so authored row text stays literal.
  return value.replace(/<\/?\d+\s*\/?\s*>/g, "\n").replace(/\{\{(\w+)\}\}/g,
    (token, key: string) => Object.hasOwn(variables, key) ? String(variables[key]) : token);
}
export function formPhrase(language: string | null | undefined, key: keyof typeof copy.ko.translate.infoOwnerForm.phrase) {
  const phrases: Record<string, string> = formSystemCopy(language).phrase;
  // React renders plain text. Numeric translation-component markers are line breaks, never HTML.
  return formCopyText(phrases[key] ?? copy.ko.translate.infoOwnerForm.phrase[key]);
}
export function formSelectionText(language: string | null | undefined, key: keyof typeof copy.ko.translate.infoOwnerForm.selectLimit,
  variables: Readonly<Record<string, string | number>>) {
  return formCopyText(formSystemCopy(language).selectLimit[key], variables);
}
export function formRequiredLabel(language: string | null | undefined, required: boolean) {
  const labels = copy[effectiveFormLanguage(language)].translate.formConsentView;
  return required ? labels.essential : labels.select;
}
export function formPrivacyPolicyLabel(language?: string | null) {
  return copy[effectiveFormLanguage(language)].translate.spreadConsent.phrase4;
}

// Local fallback messages, not retained-source translations. The source image renderer has no failure/loading copy.
const questionImageMessages: Record<FormLanguage, { loading: string; unavailable: string }> = {
  ko: { loading: "문항 이미지를 불러오는 중…", unavailable: "문항 이미지를 불러올 수 없습니다." },
  en: { loading: "Loading question image…", unavailable: "The question image could not be loaded." },
  ja: { loading: "質問の画像を読み込み中…", unavailable: "質問の画像を読み込めませんでした。" },
  "zh-CN": { loading: "正在加载题目图片…", unavailable: "无法加载题目图片。" },
  "zh-TW": { loading: "正在載入題目圖片…", unavailable: "無法載入題目圖片。" },
  de: { loading: "Bild zur Frage wird geladen…", unavailable: "Das Bild zur Frage konnte nicht geladen werden." },
  fr: { loading: "Chargement de l’image de la question…", unavailable: "L’image de la question n’a pas pu être chargée." },
  ru: { loading: "Загрузка изображения к вопросу…", unavailable: "Не удалось загрузить изображение к вопросу." },
  es: { loading: "Cargando la imagen de la pregunta…", unavailable: "No se pudo cargar la imagen de la pregunta." },
  pt: { loading: "Carregando a imagem da pergunta…", unavailable: "Não foi possível carregar a imagem da pergunta." },
  id: { loading: "Memuat gambar pertanyaan…", unavailable: "Gambar pertanyaan tidak dapat dimuat." },
  th: { loading: "กำลังโหลดรูปภาพประกอบคำถาม…", unavailable: "ไม่สามารถโหลดรูปภาพประกอบคำถามได้" },
  vi: { loading: "Đang tải hình ảnh của câu hỏi…", unavailable: "Không thể tải hình ảnh của câu hỏi." },
  tr: { loading: "Soru görseli yükleniyor…", unavailable: "Soru görseli yüklenemedi." },
  it: { loading: "Caricamento dell’immagine della domanda…", unavailable: "Impossibile caricare l’immagine della domanda." },
  ar: { loading: "جارٍ تحميل صورة السؤال…", unavailable: "تعذّر تحميل صورة السؤال." },
};
export function questionImageCopy(language?: string | null) {
  return questionImageMessages[effectiveFormLanguage(language)];
}
