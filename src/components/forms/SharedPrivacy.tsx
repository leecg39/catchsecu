"use client";
import { AuthorAssetProvider } from "./AuthorAssetProvider";
import { hasAuthorAssets } from "@/lib/author-assets";
import { QuestionMaterials } from "./QuestionMaterials";
import { QuestionImage } from "./QuestionImage";
import { QuestionChoiceSummary } from "./QuestionChoiceSummary";
import "./forms.css";
import { isFileQuestion } from "@/contracts/drawing-questions";
import { formatAnswer } from "@/contracts/questions";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { api, errorText, useResource } from "@/lib/api";
import { ActionButton, Panel } from "../shared";
import type { SharedPage } from "@/contracts/sharing";
import { sharedFileDownloadUrl } from "@/lib/file-upload";
import { richDocumentImages } from "@/contracts/rich-content";
import { OwnedRichDocumentView } from "./OwnedRichDocumentView";
import "./sharing.css";
const storageKey = "catchsecu.viewer.challenge";
function viewerHasAssets(viewer: SharedPage["viewer"]) {
  if (hasAuthorAssets(viewer.questions)) return true;
  return [viewer.formBody?.bodyRich, ...viewer.pages.map(page => page.bodyRich)]
    .some(document => document && richDocumentImages(document).length > 0);
}
function SharedPresentation({ value }: { value: { body: string; bodyRich?: unknown } }) {
  return value.bodyRich ? <OwnedRichDocumentView document={value.bodyRich} className="shared-presentation rich-document" />
    : value.body ? <p className="shared-presentation">{value.body}</p> : null;
}
export function SharedPrivacy({ path }: { path: string }) {
  return path === "/shared-privacy/view" ? <Viewer /> : <Verification path={path} />;
}
function Verification({ path }: { path: string }) {
  const router = useRouter(), params = useSearchParams(), verify = path === "/shared-privacy/email-verify";
  const returnPath = params.get("returnTo"), suffix = returnPath && /^\/file-view\/[A-Za-z0-9/-]+\/shared$/.test(returnPath) ? "?returnTo=" + encodeURIComponent(returnPath) : "";
  const [formCode, setFormCode] = useState(""), [invitationCode, setInvitationCode] = useState(""), [email, setEmail] = useState(""), [consent, setConsent] = useState(false), [code, setCode] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      if (!verify) {
        const result = await api<{ id: string; expiresAt: string }>("/viewer/challenges", { method: "POST", body: JSON.stringify({ formCode: formCode.trim(), invitationCode: invitationCode.trim(), email: email.trim(), consent }) });
        sessionStorage.setItem(storageKey, JSON.stringify(result)); router.push("/shared-privacy/email-verify" + suffix);
      } else {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null") as { id: string; expiresAt: string } | null;
        if (!saved || new Date(saved.expiresAt).getTime() <= Date.now()) throw new Error("인증 요청이 없거나 10분이 지났습니다. 초대 정보를 다시 입력해주세요.");
        await api(`/viewer/challenges/${saved.id}/verify`, { method: "POST", body: JSON.stringify({ code }) });
        sessionStorage.removeItem(storageKey); router.replace(suffix ? returnPath! : "/shared-privacy/view");
      }
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <div className="public-auth"><Link href="/login"><Image width={206} height={40} className="public-logo" src="/assets/img/catchsecu/logo/login_logo.png" alt="CATCHSECU" /></Link><Panel>
    <h1>{verify ? "이메일 인증" : "공유받은 외부 개인정보 열람"}</h1>
    <p className="public-subtitle">{verify ? "초대 정보가 일치하면 인증 메일이 전송됩니다. 요청한 브라우저에서 10분 이내에 코드를 입력해주세요." : "외부 열람자로 초대 받은 메일의 정보로 인증 후 열람할 수 있습니다."}</p>
    <form className="cs-stack" onSubmit={submit}><fieldset className="share-fields" disabled={busy}>{verify ? <label>이메일 인증코드<input className="cs-input" inputMode="numeric" autoComplete="one-time-code" required maxLength={6} minLength={6} pattern="[0-9]{6}" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} placeholder="6자리 인증코드" /></label> : <>
      <label>캐치폼 코드 <em>*</em><input className="cs-input" required maxLength={36} value={formCode} onChange={e => setFormCode(e.target.value)} /></label>
      <label>열람자 인증코드 <em>*</em><input className="cs-input" required maxLength={43} autoComplete="off" value={invitationCode} onChange={e => setInvitationCode(e.target.value)} /></label>
      <label>열람자 이메일 <em>*</em><input className="cs-input" type="email" required maxLength={254} autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
      <details><summary>개인정보 수집·이용 안내</summary><p>이메일을 수집하여 공유받은 응답의 열람자 확인과 인증 메일 발송에 사용합니다. 열람 권한은 공유 종료 또는 회수 시 해제됩니다. 동의를 거부할 수 있으며, 거부하면 외부 열람을 이용할 수 없습니다.</p></details>
      <label className="share-check"><input type="checkbox" required checked={consent} onChange={e => setConsent(e.target.checked)} /><span>필수 · 개인정보 수집이용 동의</span></label>
    </>}<ActionButton type="submit" disabled={busy}>{busy ? "처리 중…" : verify ? "인증 확인" : "이메일 인증"}</ActionButton></fieldset>
      {error && <p role="alert">{error}</p>}
    </form>{verify && <p><Link className="cs-link" href={"/shared-privacy/verify" + suffix}>초대 정보 다시 입력</Link></p>}
  </Panel></div>;
}
function Viewer() {
  const router = useRouter(), [page, setPage] = useState(1), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const resource = useResource<SharedPage>(`/viewer/submissions?page=${page}&pageSize=20`);
  const currentPage = resource.data?.page ?? page;
  const { reload } = resource;
  useEffect(() => {
    const refresh = () => reload(), timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh); return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [reload]);
  async function logout() { if (busy) return; setBusy(true); try { await api("/viewer/logout", { method: "POST" }); router.replace("/shared-privacy/verify"); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } }
  return <div className="public-auth shared-view"><Panel><h1>공유받은 외부 개인정보 열람</h1>
    <div className="forms-actions"><ActionButton secondary onClick={reload}>새로고침</ActionButton><ActionButton secondary disabled={busy} onClick={logout}>열람 종료</ActionButton></div>
    {error && <p role="alert">{error}</p>}{resource.loading ? <p role="status">공유된 응답을 불러오는 중입니다.</p> : resource.error ? <><p role="alert">{resource.error.message}</p><Link className="cs-button" href="/shared-privacy/verify">다시 인증하기</Link></> : resource.data && <>
      <h2>{resource.data.viewer.formTitle} · v{resource.data.viewer.formNumber}</h2>
      <p>인증 종료: {new Date(resource.data.viewer.expiresAt).toLocaleString("ko-KR")}<br />공유 종료: {new Date(resource.data.viewer.grantExpiresAt).toLocaleString("ko-KR")}</p>
      <p>허용된 항목: {resource.data.viewer.questions.map(q => q.label).join(", ")}</p>
      <p>총 {resource.data.total}개 응답</p>
      {resource.data.items.length ? <div className="shared-responses">{resource.data.items.map(row => <AuthorAssetProvider key={row.id} scope={{ kind: "viewer", submissionId: row.id }} enabled={viewerHasAssets(resource.data!.viewer)}><article className="shared-response">
        <h3>{new Date(row.submittedAt).toLocaleString("ko-KR")}</h3><dl>{resource.data!.viewer.questions.map(q => <div key={q.id}><dt>{q.label}<QuestionImage assetKey={q.questionImageKey} /><QuestionMaterials question={q} /><QuestionChoiceSummary question={q} imagesOnly /></dt><dd>{isFileQuestion(q.type) ? (() => {
          const file = row.attachments.find(f => f.questionId === q.id);
          return file ? <a className="cs-link" href={sharedFileDownloadUrl(file.id, row.id, q.id)}>{file.name} 다운로드</a> : "첨부파일 없음";
        })() : formatAnswer(row.values[q.id], q.rows, q.optionDefinitions, q.type)}</dd></div>)}</dl>
        {resource.data!.viewer.formBody && <section className="shared-form-presentation"><h4>폼 안내</h4><SharedPresentation value={resource.data!.viewer.formBody} /></section>}
        {resource.data!.viewer.pages.map(page => <section className="shared-form-presentation" key={page.id}><h4>{page.title || "페이지 안내"}</h4><SharedPresentation value={page} /></section>)}
        {!!row.attachments.length && <Link className="cs-link" href={`/file-view/${row.id}/shared`}>공유 첨부파일 보기</Link>}
      </article></AuthorAssetProvider>)}</div> : <p>현재 열람할 수 있는 응답이 없습니다.</p>}
      <div className="cs-pagination"><button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>이전</button><span>{currentPage} / {Math.max(1, Math.ceil(resource.data.total / 20))}</span><button disabled={currentPage * 20 >= resource.data.total} onClick={() => setPage(currentPage + 1)}>다음</button></div>
    </>}
  </Panel></div>;
}
