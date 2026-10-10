"use client";
import { api } from "./api";
import { MAX_FILE_BYTES, type UploadInfo } from "@/contracts/files";

export type UploadCache = Map<string, { fingerprint: string; key: string; upload?: UploadInfo }>;
const types: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", csv: "text/csv", txt: "text/plain" };
export async function uploadFile(file: File, target: { token: string; questionId: string; participationProof?: string } | { submissionId: string; questionId: string },
  cache: UploadCache, onStatus: (message: string) => void) {
  if (file.size < 1 || file.size > MAX_FILE_BYTES) throw new Error("파일은 1바이트 이상, 10MB 이하로 첨부해주세요.");
  const mime = types[file.name.split(".").at(-1)?.toLowerCase() ?? ""];
  if (!mime) throw new Error("PDF, PNG, JPG, TXT, CSV 파일을 선택해주세요.");
  const bytes = await file.arrayBuffer(), hash = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
  const fingerprint = JSON.stringify({ name: file.name, mime, size: file.size, sha256 });
  let cached = cache.get(target.questionId);
  if (cached?.fingerprint !== fingerprint) cached = undefined;
  if (!cached) { cached = { fingerprint, key: crypto.randomUUID() }; cache.set(target.questionId, cached); }
  if (!cached.upload) {
    onStatus(file.name + " 업로드 준비 중…");
    const payload = { name: file.name, mime, size: file.size, sha256, questionId: target.questionId };
    const upload = await api<UploadInfo>("token" in target ? "/public/forms/" + target.token + "/uploads" : "/uploads/init", {
      method: "POST", headers: { "Idempotency-Key": cached.key,
        ...("token" in target && target.participationProof ? { "X-Participation-Proof": target.participationProof } : {}) },
      body: JSON.stringify("token" in target ? payload : { ...payload, purpose: "submission", submissionId: target.submissionId }),
    });
    cached.upload = upload;
  }
  const headers: Record<string, string> = cached.upload.uploadToken ? { "X-Upload-Token": cached.upload.uploadToken } : {};
  if (cached.upload.status === "pending") {
    onStatus(file.name + " 업로드 중…");
    const uploaded = await api<UploadInfo>("/uploads/" + cached.upload.id + "/content", {
      method: "PUT", body: bytes, headers: { ...headers, "Content-Type": mime },
    });
    cached.upload = { ...cached.upload, ...uploaded };
  }
  if (cached.upload.status !== "ready") {
    onStatus(file.name + " 검사 중…");
    const completed = await api<UploadInfo>("/uploads/" + cached.upload.id + "/complete", { method: "POST", headers });
    cached.upload = { ...cached.upload, ...completed };
  }
  onStatus(file.name + " 첨부 완료");
  return cached.upload;
}
export function fileDownloadUrl(id: string, submissionId: string, questionId: string) {
  return "/api/v1/files/" + encodeURIComponent(id) + "/download?" + new URLSearchParams({ submissionId, questionId });
}

export function sharedFileDownloadUrl(id: string, submissionId: string, questionId: string) {
  return "/api/v1/viewer/files/" + encodeURIComponent(id) + "/download?" + new URLSearchParams({ submissionId, questionId });
}
