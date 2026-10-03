"use client";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { api, errorText } from "@/lib/api";
import { ActionButton, Panel } from "../shared";
import type { SubjectConsent, SubjectEvent, SubjectPage, SubjectSessionInfo, SubjectWithdrawalRecord } from "@/contracts/subjects";
import "./subjects.css";
const findPath = "/infoOwner/find", historyPath = (id: string) => "/infoOwner/agree-history/" + id;
function headers(id: string) { return { "X-Subject-Session": id }; }
function Frame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div className={"public-auth subject-portal" + (wide ? " subject-history" : "")}><Link href="/login"><Image className="public-logo" width={206} height={40} src="/assets/img/catchsecu/logo/login_logo.png" alt="CATCHSECU" /></Link><Panel>{children}</Panel></div>;
}
function useSubjectResource<T>(path: string | null, id: string) {
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>(), [revision, setRevision] = useState(0);
  const key = path + ":" + id;
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    api<T>(path, { headers: headers(id), signal: controller.signal }).then(data => setState({ key, data })).catch(error => { if (error.name !== "AbortError") setState({ key, error: errorText(error) }); });
    return () => controller.abort();
  }, [path, id, key, revision]);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1), timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh); return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  const current = state?.key === key ? state : undefined;
  return { ...current, loading: !!path && !current, reload: () => { setState(undefined); setRevision(value => value + 1); } };
}
export function SubjectPortal({ path }: { path: string }) {
  if (path === findPath) return <Find />;
  if (path === findPath + "/complete") return <Frame><Image src="/assets/img/catchsecu/signup/mail.png" width={40} height={40} alt="" /><h1>이메일을 확인해주세요.</h1><p>입력하신 이름과 이메일로 동의한 이력이 있다면 인증 메일이 전송됩니다.</p><p>조회한 브라우저에서 10분 이내에 메일의 링크를 열어주세요.</p><Link className="cs-link" href={findPath}>동의이력 조회로 돌아가기</Link></Frame>;
  if (path === "/infoOwner/form-interrupt" || path === "/infoOwner/formComplete") return <Withdrawal path={path} />;
  const [, , kind, id] = path.split("/");
  if (["agree-history", "action-history"].includes(kind) && id) {
    if (/^[A-Za-z0-9_-]{43}$/.test(id)) return <Verify key={id} token={id} />;
    if (/^[0-9a-f-]{36}$/.test(id)) return <History key={path} id={id} events={kind === "action-history"} />;
  }
  return <Frame><h1>동의 이력 조회</h1><p role="alert">유효한 조회 링크를 이용해주세요.</p><Link href={findPath}>다시 조회하기</Link></Frame>;
}
function Find() {
  const router = useRouter(), [english, setEnglish] = useState(false), [name, setName] = useState(""), [email, setEmail] = useState(""), [consent, setConsent] = useState(false);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try { await api("/subjects/access-requests", { method: "POST", body: JSON.stringify({ name, email, consent }) }); router.push(findPath + "/complete"); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <Frame><h1>{english ? "Consent history" : "동의 이력 조회"}</h1><p className="public-subtitle">{english ? "Find your consent history using the information you submitted." : "답변하신 정보로 동의이력을 조회하실 수 있습니다."}</p>
    <form onSubmit={submit} className="cs-stack"><fieldset className="subject-fields" disabled={busy}>
      <label>{english ? "Name" : "이름"} <em>*</em><input className="cs-input" required maxLength={100} autoComplete="name" value={name} onChange={e => setName(e.target.value)} /></label>
      <label>{english ? "Email" : "이메일"} <em>*</em><input className="cs-input" required type="email" maxLength={254} autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
      <details><summary>{english ? "Privacy notice" : "개인정보 수집·이용 안내"}</summary><p>{english ? "We use your name and email to match your consent records and verify your access. The link expires after 10 minutes and access ends after 30 minutes. Authentication requests and sessions are cleaned up after they have expired for 24 hours. You may refuse; without consent, this lookup is unavailable." : "이름과 이메일은 기존 동의 이력 확인과 인증 메일 발송에 사용합니다. 링크는 10분, 조회 인증은 30분간 유효하며 인증 요청·세션은 만료 후 24시간이 지나면 정리합니다. 동의를 거부할 수 있으며 거부하면 이 조회를 이용할 수 없습니다."}</p></details>
      <label className="subject-check"><input type="checkbox" required checked={consent} onChange={e => setConsent(e.target.checked)} /><span>{english ? "Required · Consent to collect and use personal information" : "필수 · 개인정보 수집이용 동의"}</span></label>
      <ActionButton type="submit" disabled={busy}>{busy ? "처리 중…" : english ? "Send verification email" : "인증 메일 받기"}</ActionButton>
    </fieldset>{error && <p role="alert">{error}</p>}</form><div className="public-language"><button aria-pressed={!english} onClick={() => setEnglish(false)}>한국어</button><span>|</span><button aria-pressed={english} onClick={() => setEnglish(true)}>English</button></div></Frame>;
}
function Verify({ token }: { token: string }) {
  const router = useRouter(), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  return <Frame><h1>이메일 인증</h1><p>조회 요청을 보낸 브라우저에서 인증을 완료해주세요.</p><ActionButton disabled={busy} onClick={async () => {
    if (busy) return; setBusy(true); setError("");
    try { const result = await api<SubjectSessionInfo>("/subjects/sessions", { method: "POST", body: JSON.stringify({ token }) }); router.replace(historyPath(result.id)); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }}>{busy ? "인증 중…" : "이메일 인증 완료"}</ActionButton>{error && <p role="alert">{error}</p>}<p><Link className="cs-link" href={findPath}>인증 메일 다시 요청</Link></p></Frame>;
}
const date = (value: string) => new Date(value).toLocaleString("ko-KR");
function History({ id, events }: { id: string; events: boolean }) {
  const router = useRouter(), [page, setPage] = useState(1), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const session = useSubjectResource<SubjectSessionInfo>("/subjects/me", id);
  const records = useSubjectResource<SubjectPage<SubjectConsent | SubjectEvent>>(`/subjects/me/${events ? "events" : "consents"}?page=${page}&pageSize=10`, id);
  async function withdraw(row: SubjectConsent) {
    if (busy) return; setBusy(true); setError("");
    try { const request = await api<SubjectWithdrawalRecord>("/subjects/me/withdrawals", { method: "POST", headers: headers(id), body: JSON.stringify({ submissionId: row.id, version: row.version }) });
      router.push(`/infoOwner/form-interrupt?session=${id}&request=${request.id}`); }
    catch (cause) { setError(errorText(cause)); records.reload(); } finally { setBusy(false); }
  }
  return <Frame wide><h1>{events ? "동의 처리 이력" : "동의 이력"}</h1><nav className="subject-actions" aria-label="동의 이력 메뉴"><Link className={!events ? "active" : ""} href={historyPath(id)}>동의 이력</Link><Link className={events ? "active" : ""} href={"/infoOwner/action-history/" + id}>처리 이력</Link>
    <ActionButton secondary disabled={busy} onClick={() => { session.reload(); records.reload(); }}>새로고침</ActionButton><ActionButton secondary disabled={busy} onClick={async () => { if (busy) return; setBusy(true); try { await api("/subjects/logout", { method: "POST" }); router.replace(findPath); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } }}>조회 종료</ActionButton></nav>
    {session.data && <p>조회 인증 종료: {date(session.data.expiresAt)}</p>}{error && <p role="alert">{error}</p>}
    {session.error || records.error ? <><p role="alert">{session.error || records.error}</p><Link href={findPath} className="cs-link">다시 이메일 인증하기</Link></> : session.loading || records.loading ? <p role="status">동의 이력을 불러오는 중입니다.</p> : records.data && <>
      <p>총 {records.data.total}건</p><div className="subject-records">{records.data.items.map(row => events ? (() => { const event = row as SubjectEvent; return <article className="subject-record" key={event.id}><h2>{event.type === "withdrawn" ? "동의 철회" : event.type === "imported" ? "동의 기록 등록 (CSV)" : "동의 완료"}</h2><p>{event.company} · {event.service}</p><h3>{event.title}</h3><p>{event.purpose}</p><time dateTime={event.createdAt}>{date(event.createdAt)}</time></article>; })() : (() => { const consent = row as SubjectConsent; return <article className="subject-record" key={consent.id}><h2>{consent.title}</h2><p>{consent.company} · {consent.service}</p><p>상태: {consent.status === "withdrawn" ? "철회 완료" : "동의 완료"}</p><p>제출: {date(consent.submittedAt)}<br />보유 종료: {date(consent.retentionUntil)}</p>
        {consent.receipts.map(receipt => <section className="subject-receipt" key={receipt.id}><h3>동의 목적</h3><p>{receipt.purpose}</p><p>동의일: {date(receipt.grantedAt)}{receipt.withdrawnAt && <><br />철회일: {date(receipt.withdrawnAt)}</>}</p></section>)}
        {consent.canWithdraw && <ActionButton secondary disabled={busy} onClick={() => withdraw(consent)}>동의 철회 요청</ActionButton>}</article>; })())}</div>
      {!records.data.items.length && <p>현재 조회할 수 있는 동의 이력이 없습니다.</p>}<div className="cs-pagination"><button disabled={records.data.page <= 1 || busy} onClick={() => setPage(records.data!.page - 1)}>이전</button><span>{records.data.page} / {Math.max(1, Math.ceil(records.data.total / records.data.pageSize))}</span><button disabled={records.data.page * records.data.pageSize >= records.data.total || busy} onClick={() => setPage(records.data!.page + 1)}>다음</button></div>
    </>}</Frame>;
}
function Withdrawal({ path }: { path: string }) {
  const params = useSearchParams(), router = useRouter(), id = params.get("session") ?? "", request = params.get("request") ?? "";
  const valid = /^[0-9a-f-]{36}$/.test(id) && /^[0-9a-f-]{36}$/.test(request), result = useSubjectResource<SubjectWithdrawalRecord>(valid ? "/subjects/me/withdrawals/" + request : null, id);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), completePage = path.endsWith("formComplete");
  async function act(action: "confirm" | "cancel") {
    if (busy) return; setBusy(true); setError("");
    try { await api(`/subjects/me/withdrawals/${request}/${action}`, { method: "POST", headers: headers(id) });
      if (action === "confirm") router.replace(`/infoOwner/formComplete?session=${id}&request=${request}`); else router.replace(historyPath(id)); }
    catch (cause) { setError(errorText(cause)); result.reload(); } finally { setBusy(false); }
  }
  return <Frame><h1>{completePage ? "동의 철회 결과" : "동의 철회 확인"}</h1>{!valid ? <p role="alert">동의 이력에서 철회 요청을 먼저 진행해주세요.</p> : result.loading ? <p role="status">요청을 확인하고 있습니다.</p> : result.error ? <p role="alert">{result.error}</p> : result.data && <>
    <h2>{result.data.title}</h2><p>{result.data.company} · {result.data.service}</p>
    {result.data.status === "completed" ? <><p role="status">동의 철회가 완료되었습니다.</p><p>{result.data.finishedAt && date(result.data.finishedAt)}</p><p>이 서비스에서 해당 이메일로 보내는 후속 발송을 차단했습니다. 이메일 인증 등 필수 안내는 받을 수 있습니다.</p></> : result.data.status === "cancelled" ? <p>취소된 철회 요청입니다.</p> : completePage ? <p role="alert">아직 철회가 완료되지 않았습니다. 확인 화면에서 철회를 진행해주세요.</p> : <><p>이 응답의 동의를 철회하시겠습니까?</p><p>확정하면 이 서비스에서 해당 이메일로 보내는 후속 발송을 차단합니다. 기존 자료의 보유·파기는 별도 보유 정책에 따릅니다.</p><div className="subject-actions"><ActionButton disabled={busy} onClick={() => act("confirm")}>철회 확정</ActionButton><ActionButton secondary disabled={busy} onClick={() => act("cancel")}>철회 취소</ActionButton></div></>}
    {completePage && result.data.status === "requested" && <Link className="cs-link" href={`/infoOwner/form-interrupt?session=${id}&request=${request}`}>철회 확인으로 돌아가기</Link>}
  </>}{error && <p role="alert">{error}</p>}<p><Link className="cs-link" href={valid ? historyPath(id) : findPath}>{valid ? "동의 이력으로 돌아가기" : "동의 이력 조회"}</Link></p></Frame>;
}
