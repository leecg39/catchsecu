"use client";
import { useEffect, useRef, useState } from "react";
import { BODY_IMAGE_ACCEPT, MATERIAL_FILE_ACCEPT, OPTION_IMAGE_ACCEPT, bodyImagePurposes, type AuthorAssetPurpose, type AuthorAssetUploadInfo } from "@/contracts/author-assets";
import { discardAuthorAssetUpload, uploadAuthorAsset, type AuthorAssetUploadCache } from "@/lib/author-assets";
import { errorText } from "@/lib/api";
import { useUnsavedChanges } from "../ux/navigation-guard";

export type AuthorAssetEditContext = {
  serviceId: string;
  capture: () => unknown;
  isCurrent: (snapshot: unknown) => boolean;
  begin: () => (() => void) | undefined;
  register: (upload: AuthorAssetUploadInfo) => void;
};
/** Cleanup is advisory. A saved historical/current pin may correctly reject it with 409. */
export function discardUnusedAuthorUpload(upload: AuthorAssetUploadCache["upload"]) {
  if (upload) void discardAuthorAssetUpload(upload).catch(() => {});
}
type UploadEvents = {
  context: AuthorAssetEditContext; purpose: AuthorAssetPurpose; isCurrent: () => boolean;
  onComplete: (upload: AuthorAssetUploadInfo) => boolean;
  started: () => void; status: (message: string) => void; success: () => void;
  stale: () => void; error: (message: string) => void; done: () => void;
};
type Attempt = { cache: { current: AuthorAssetUploadCache | undefined }; release: () => void };
/** Request/cache ownership is independent of React scheduling; cancelled attempts keep their own cache. */
export class AuthorAssetUploadSession {
  private cache: Attempt["cache"] = { current: undefined };
  private active?: Attempt;
  cancel() {
    const attempt = this.active; this.active = undefined;
    discardUnusedAuthorUpload(this.cache.current?.upload); this.cache = { current: undefined };
    attempt?.release();
  }
  async run(file: File, events: UploadEvents): Promise<void> {
    if (this.active) return;
    const releaseLock = events.context.begin();
    if (!releaseLock) { events.error("저장이 끝난 뒤 파일을 다시 선택해주세요."); return; }
    let released = false;
    const attempt: Attempt = { cache: this.cache, release: () => { if (released) return; released = true; releaseLock(); } };
    const snapshot = events.context.capture();
    this.active = attempt; events.started();
    const current = () => this.active === attempt && events.isCurrent() && events.context.isCurrent(snapshot);
    try {
      const upload = await uploadAuthorAsset(file, { purpose: events.purpose, serviceId: events.context.serviceId }, attempt.cache,
        message => { if (this.active === attempt) events.status(message); });
      if (!current() || !events.onComplete(upload)) {
        discardUnusedAuthorUpload(upload);
        if (this.cache === attempt.cache) this.cache = { current: undefined };
        if (this.active === attempt) events.stale();
        return;
      }
      events.context.register(upload); this.cache = { current: undefined }; events.success();
    } catch (cause) {
      if (!current()) {
        discardUnusedAuthorUpload(attempt.cache.current?.upload);
        if (this.cache === attempt.cache) this.cache = { current: undefined };
        if (this.active === attempt) events.stale();
      } else events.error(errorText(cause));
    } finally {
      attempt.release();
      if (this.active === attempt) { this.active = undefined; events.done(); }
    }
  }
}

export function AuthorAssetUpload({ purpose, label, targetKey, context, disabled, onComplete }: {
  purpose: AuthorAssetPurpose; label: string; targetKey: string; context?: AuthorAssetEditContext; disabled: boolean;
  onComplete: (upload: AuthorAssetUploadInfo) => boolean;
}) {
  const [file, setFile] = useState<File>(), [pending, setPending] = useState(false), [status, setStatus] = useState(""), [error, setError] = useState("");
  const session = useRef(new AuthorAssetUploadSession()), latest = useRef({ context, disabled, targetKey, onComplete });
  useEffect(() => { latest.current = { context, disabled, targetKey, onComplete }; });
  useEffect(() => { const controller = session.current; return () => controller.cancel(); }, []);
  useUnsavedChanges(pending || !!file, "업로드 중이거나 아직 연결하지 않은 파일이 있습니다.");
  function upload(selected: File) {
    const source = latest.current;
    if (source.disabled || !source.context?.serviceId) return;
    void session.current.run(selected, {
      purpose, context: source.context,
      isCurrent: () => !latest.current.disabled && latest.current.targetKey === source.targetKey
        && latest.current.context?.serviceId === source.context!.serviceId,
      onComplete: result => latest.current.onComplete(result),
      started: () => { setPending(true); setFile(selected); setError(""); setStatus(""); },
      status: setStatus,
      success: () => { setFile(undefined); setStatus("첨부 완료"); },
      stale: () => { setFile(undefined); setStatus(""); setError("편집 내용이 변경되어 업로드 결과를 연결하지 않았습니다. 현재 문항에서 다시 선택해주세요."); },
      error: message => { setError(message); setStatus(""); },
      done: () => setPending(false),
    });
  }
  function cancel() { session.current.cancel(); setPending(false); setFile(undefined); setError(""); setStatus(""); }
  const unavailable = disabled || pending || !context?.serviceId;
  const bodyImage = (bodyImagePurposes as readonly string[]).includes(purpose);
  return <div className="forms-author-upload">
    <label className="cs-label">{label}<input className="cs-input" type="file" aria-label={label}
      accept={purpose === "QUESTION_MATERIAL" ? MATERIAL_FILE_ACCEPT : bodyImage ? BODY_IMAGE_ACCEPT : OPTION_IMAGE_ACCEPT} disabled={unavailable}
      onChange={event => {
        const selected = event.target.files?.[0]; event.target.value = "";
        if (!selected || unavailable) return;
        session.current.cancel(); upload(selected);
      }} /></label>
    <small className="cs-muted">{purpose === "QUESTION_MATERIAL" ? "PDF·DOCX·AI · 파일당 최대 5 MiB" : bodyImage ? "JPG·JPEG·PNG · 이미지당 최대 14 MiB" : "JPG·JPEG·PNG · 이미지당 최대 1 MiB"}</small>
    {!context?.serviceId && <p className="cs-muted">먼저 서비스를 선택해주세요.</p>}
    {file && <p dir="auto">{file.name}</p>}
    {status && <p role="status">{status}</p>}{error && <p role="alert">{error}</p>}
    {file && <div className="forms-actions">
      {!pending && <button type="button" disabled={unavailable} onClick={() => upload(file)}>같은 파일 재시도</button>}
      <button type="button" disabled={disabled} onClick={cancel}>{pending ? "업로드 취소" : "선택 취소"}</button>
    </div>}
  </div>;
}
