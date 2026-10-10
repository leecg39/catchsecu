"use client";
import { api } from "./api";
import { authorAssetMimeForName, authorAssetUploadInput, type AuthorAssetInfo, type AuthorAssetPurpose, type AuthorAssetReadScope, type AuthorAssetUploadInfo } from "@/contracts/author-assets";

export type AuthorAssetViewScope = AuthorAssetReadScope
  | { kind: "public"; token: string; surface?: "active" | "closed"; proof?: never }
  | { kind: "public"; token: string; surface: "completion"; proof: string }
  | { kind: "viewer"; submissionId: string };
export function authorAssetManifestPath(scope: AuthorAssetViewScope): string {
  if (scope.kind === "public") return "/public/forms/" + encodeURIComponent(scope.token) + "/author-assets?" + new URLSearchParams({
    surface: scope.surface ?? "active", ...(scope.surface === "completion" ? { proof: scope.proof } : {}),
  });
  if (scope.kind === "viewer") return "/viewer/author-assets?" + new URLSearchParams({ submissionId: scope.submissionId });
  return "/author-assets?" + new URLSearchParams(Object.fromEntries(Object.entries(scope).map(([key, value]) => [key, String(value)])));
}
export function authorAssetDownloadPath(scope: AuthorAssetViewScope, id: string): string {
  const manifest = authorAssetManifestPath(scope), [path, query] = manifest.split("?");
  return "/api/v1" + path + "/" + encodeURIComponent(id) + "/download" + (query ? "?" + query : "");
}
export function authorAssetUploadDownloadPath(id: string) {
  return "/api/v1/author-assets/uploads/" + encodeURIComponent(id) + "/download";
}
export type AuthorAssetUploadCache = { fingerprint: string; key: string; upload?: AuthorAssetUploadInfo };
export async function uploadAuthorAsset(file: File, target: { serviceId: string; purpose: AuthorAssetPurpose },
  cache: { current: AuthorAssetUploadCache | undefined }, onStatus: (message: string) => void): Promise<AuthorAssetUploadInfo> {
  const mime = authorAssetMimeForName(file.name, target.purpose);
  // Validate before allocating or reading the full browser buffer.
  const parsed = authorAssetUploadInput.safeParse({ ...target, name: file.name, mime, size: file.size, sha256: "0".repeat(64) });
  if (!parsed.success) throw new Error(!target.serviceId ? "서비스를 먼저 선택해주세요." : !mime ? "지원하는 파일 형식을 선택해주세요." : parsed.error.issues[0]?.message ?? "파일을 확인해주세요.");
  const payload = parsed.data;
  const bytes = await file.arrayBuffer(), digest = await crypto.subtle.digest("SHA-256", bytes);
  payload.sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const fingerprint = JSON.stringify(payload);
  if (cache.current?.fingerprint !== fingerprint) cache.current = { fingerprint, key: crypto.randomUUID() };
  const current = cache.current;
  if (!current.upload) {
    onStatus("업로드 준비 중…");
    current.upload = await api<AuthorAssetUploadInfo>("/author-assets/uploads", {
      method: "POST", headers: { "Idempotency-Key": current.key }, body: JSON.stringify(payload),
    });
  } else {
    // A lost PUT/complete response may have committed. Refresh its state before retrying.
    current.upload = await api<AuthorAssetUploadInfo>("/author-assets/uploads/" + current.upload.id);
  }
  const path = "/author-assets/uploads/" + current.upload.id;
  if (current.upload.status === "pending") {
    onStatus("파일 업로드 중…");
    current.upload = await api<AuthorAssetUploadInfo>(path + "/content", { method: "PUT", headers: { "Content-Type": payload.mime }, body: bytes });
  }
  if (current.upload.status !== "ready") {
    onStatus("파일 검사 중…");
    current.upload = await api<AuthorAssetUploadInfo>(path + "/complete", { method: "POST" });
  }
  if (current.upload.status !== "ready") throw new Error("검사를 완료하지 못했습니다. 파일 상태를 확인해주세요.");
  onStatus("첨부 완료");
  return current.upload;
}
export async function discardAuthorAssetUpload(upload: Pick<AuthorAssetInfo, "id" | "version">) {
  await api("/author-assets/uploads/" + encodeURIComponent(upload.id) + "?" + new URLSearchParams({ version: String(upload.version) }), { method: "DELETE" });
}

export function hasAuthorAssets(questions: { questionImageKey?: string | null; materialList?: { materialType: string }[]; optionDefinitions?: { optionImageKey?: string | null }[] }[]) {
  return questions.some(question => question.questionImageKey || question.materialList?.some(item => item.materialType === "FILE") || question.optionDefinitions?.some(option => option.optionImageKey));
}
export function authorAssetSizeLabel(size: number) {
  return size >= 1024 * 1024 ? `${Math.round(size / (1024 * 1024) * 10) / 10} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}
