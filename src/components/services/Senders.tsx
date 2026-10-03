"use client";
import { useRef, useState } from "react";
import { api, errorText, useResource } from "@/lib/api";
import type { Paged } from "@/contracts/forms";
import { senderEventLabels, senderStatuses, type SenderRecord } from "@/contracts/senders";
import type { FileInfo } from "@/contracts/files";
import { useApplication } from "../ApplicationContext";
import { ActionButton, Modal, PageHeading, Panel } from "../shared";
import { RemoteTable } from "../RemoteTable";
import "./senders.css";
const when = (v: string | null) => v ? new Date(v).toLocaleString("ko-KR") : "—";

export function SenderManagement({ email = false }: { email?: boolean }) {
  const app = useApplication();
  if (!app.data) return <Panel><p role="status">회사 정보를 불러오는 중입니다.</p></Panel>;
  if (!app.data.capabilities.includes("sender.read")) return <Panel><p role="alert">발신자를 조회할 권한이 없습니다.</p></Panel>;
  if (!app.data.serviceId) return <Panel><p>서비스를 선택해주세요.</p></Panel>;
  return <SenderList key={app.data.serviceId + String(email)} serviceId={app.data.serviceId} email={email} canWrite={app.data.capabilities.includes("sender.manage")} />;
}
function SenderList({ serviceId, email, canWrite }: { serviceId: string; email: boolean; canWrite: boolean }) {
  const [search, setSearch] = useState(""), [query, setQuery] = useState(""), [status, setStatus] = useState("all"), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20);
  const [create, setCreate] = useState(false), [detail, setDetail] = useState<string>();
  const list = useResource<Paged<SenderRecord>>("/senders?" + new URLSearchParams({ serviceId, channel: email ? "email" : "sms", search, status, page: String(page), pageSize: String(pageSize) }));
  return <div className="senders-page"><PageHeading title={email ? "발신 주소 관리" : "발신번호 관리"}><p>{email ? "조직에서 소유한 이메일 주소를 등록하고 확인합니다." : "등록한 발신번호와 공급자의 인증 상태를 관리합니다."}</p></PageHeading>
    <Panel><div className="sender-toolbar"><h2>{email ? "발신 주소 목록" : "발신번호 목록"}</h2>{canWrite && <ActionButton onClick={() => setCreate(true)}>{email ? "발신 주소 등록" : "발신번호 등록"}</ActionButton>}</div>
      <form className="sender-filters" onSubmit={e => { e.preventDefault(); setSearch(query); setPage(1); }}><input className="cs-input" aria-label="발신자 검색" placeholder="이름 또는 정확한 주소·번호" value={query} onChange={e => setQuery(e.target.value)} maxLength={254} />
        <select className="cs-input" aria-label="발신자 상태" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="all">현재 목록 전체</option>{Object.entries(senderStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ActionButton secondary>검색</ActionButton><ActionButton secondary type="button" onClick={list.reload}>새로고침</ActionButton></form>
      <RemoteTable columns={["대표", "발신자 이름", email ? "발신자 주소" : "발신번호", "설명", "인증 상태", "발송 준비", "등록 담당자", "등록일", "관리"]} rows={(list.data?.items ?? []).map(r => ({ id: r.id, cells: [r.isDefault ? "대표" : "—", r.label || "삭제된 발신자", r.address ?? "원문 없음", r.description || "—", <span key="state">{senderStatuses[r.status]}{r.environment === "local" && <small>로컬 검증</small>}<small>{r.expiresAt ? "만료 " + when(r.expiresAt) : ""}</small></span>, r.eligible ? r.environment === "local" ? "로컬 메일" : "준비됨" : r.denial, r.creator, when(r.createdAt), <button key="detail" className="cs-link" onClick={() => setDetail(r.id)}>관리</button>] }))} total={list.data?.total ?? 0} page={page} pageSize={pageSize} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(1); }} loading={list.loading} error={list.error?.message} />
    </Panel>
    <Panel title={email ? "발신 주소 확인 방법" : "발신번호 확인 방법"}><p>{email ? "이메일 인증번호와 도메인의 DNS TXT 값을 모두 확인해야 합니다. 주소를 변경하거나 재인증을 시작하면 기존 인증은 해제됩니다." : "문자 공급자에 등록된 번호의 활성 상태와 만료일을 확인합니다. 심사에 필요한 증빙을 보관하고 교체할 수 있습니다. 증빙 첨부만으로 발신번호 인증이 완료되지는 않습니다."}</p></Panel>
    {create && <SenderCreate serviceId={serviceId} email={email} onClose={() => setCreate(false)} onCreated={id => { setCreate(false); list.reload(); setDetail(id); }} />}
    {detail && <SenderDetail id={detail} canWrite={canWrite} onClose={() => setDetail(undefined)} onChanged={list.reload} />}
  </div>;
}
function SenderCreate({ serviceId, email, onClose, onCreated }: { serviceId: string; email: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""); const pending = useRef<{ body: string; key: string } | null>(null);
  return <Modal title={email ? "발신 주소 등록" : "발신번호 등록"} onClose={() => { if (!busy) onClose(); }}><form className="sender-fields" onSubmit={async e => { e.preventDefault(); if (busy) return; setBusy(true); setError(""); const f = new FormData(e.currentTarget);
    try { const body = JSON.stringify({ serviceId, channel: email ? "email" : "sms", label: f.get("label"), address: f.get("address"), description: f.get("description") }); if (pending.current?.body !== body) pending.current = { body, key: crypto.randomUUID() };
      const r = await api<{ id: string }>("/senders", { method: "POST", body, headers: { "Idempotency-Key": pending.current.key } }); onCreated(r.id);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }}><SenderFields email={email} /><p>등록 후 인증을 진행해주세요.</p>{error && <p role="alert">{error}</p>}<ActionButton disabled={busy}>{busy ? "등록 중…" : "등록"}</ActionButton></form></Modal>;
}
function SenderFields({ email, record }: { email: boolean; record?: SenderRecord }) {
  return <><label>발신자 이름<input className="cs-input" aria-label="발신자 이름" name="label" defaultValue={record?.label} maxLength={100} required /></label><label>{email ? "발신자 주소" : "발신번호"}<input className="cs-input" aria-label={email ? "발신자 주소" : "발신번호"} type={email ? "email" : "tel"} name="address" defaultValue={record?.address ?? ""} maxLength={254} required /></label><label>설명<input className="cs-input" aria-label="발신자 설명" name="description" defaultValue={record?.description} maxLength={1000} /></label></>;
}
function SenderDetail({ id, canWrite, onClose, onChanged }: { id: string; canWrite: boolean; onClose: () => void; onChanged: () => void }) {
  const resource = useResource<SenderRecord>("/senders/" + id), r = resource.data;
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState<"disable" | "renew" | "delete">();
  const changed = () => { resource.reload(); onChanged(); };
  async function action(path: string, extra: object = {}, method = "POST") {
    if (!r || busy) return; setBusy(true); setError(""); setMessage("");
    try { const response = await api<{ verified?: boolean; cleanupPending?: boolean }>("/senders/" + id + (path ? "/" + path : ""), { method, body: JSON.stringify({ version: r.version, ...extra }) });
      setConfirm(undefined); setMessage(response.cleanupPending ? "삭제 요청을 저장했습니다. 파일 정리를 다시 처리 중입니다." : response.verified === false ? "아직 확인되지 않았습니다. 등록 내용과 공급자 상태를 확인해주세요." : "처리했습니다."); changed();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  if (confirm) return <Modal title={confirm === "delete" ? "발신자 삭제" : confirm === "disable" ? "발신자 사용 중지" : "발신자 재인증"} onClose={() => { if (!busy) setConfirm(undefined); }}><div className="sender-fields"><p>{confirm === "delete" ? "발신자 설정의 주소와 증빙 원문을 삭제합니다. 변경 이력과 이미 전달된 메일의 발송 기록은 각 보관 기간에 따라 유지됩니다. 예약 또는 처리 중인 발송이 있으면 먼저 취소해주세요." : "기존 인증과 대표 설정을 해제합니다. 예약된 이전 버전의 발송도 전달 전에 차단됩니다."}</p>{error && <p role="alert">{error}</p>}<div className="sender-actions"><ActionButton secondary disabled={busy} onClick={() => setConfirm(undefined)}>취소</ActionButton><ActionButton disabled={busy} onClick={() => action(confirm === "delete" ? "" : confirm, {}, confirm === "delete" ? "DELETE" : "POST")}>확인</ActionButton></div></div></Modal>;
  const emailProof = r?.verifications?.find(p => p.method === "email" && p.status === "pending" && new Date(p.expiresAt) > new Date());
  const dns = r?.verifications?.find(p => p.method === "dns" && p.status !== "superseded");
  return <Modal title="발신자 관리" onClose={() => { if (!busy) onClose(); }}>{resource.loading ? <p role="status">불러오는 중입니다.</p> : resource.error ? <p role="alert">{resource.error.message}</p> : r && <div className="sender-fields">
    <dl className="sender-detail"><dt>상태</dt><dd>{senderStatuses[r.status]} {r.environment === "local" && "· 로컬 검증"}</dd><dt>발송 준비</dt><dd>{r.eligible ? r.environment === "local" ? "로컬 메일함 전달 가능" : "준비됨" : r.denial}</dd><dt>인증 만료</dt><dd>{when(r.expiresAt)}</dd><dt>버전</dt><dd>{r.version}</dd></dl>
    {r.status !== "deleted" && canWrite ? <form key={r.version} className="sender-fields" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); action("", { label: f.get("label"), address: f.get("address"), description: f.get("description") }, "PATCH"); }}><fieldset className="sender-fields" disabled={busy}><SenderFields email={r.channel === "email"} record={r} /><ActionButton secondary>변경 저장</ActionButton></fieldset></form> : <p>{r.address ?? "주소 원문이 삭제되었습니다."}</p>}
    {canWrite && r.status === "pending" && <section className="sender-fields"><h3>발신자 인증</h3>{r.channel === "email" ? <>
      <ActionButton secondary disabled={busy} onClick={() => action("request-email")}>인증번호 받기</ActionButton>
      {emailProof && <form className="sender-actions" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); action("confirm-email", { verificationId: emailProof.id, code: f.get("code") }); }}><input className="cs-input" aria-label="발신 주소 인증번호" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="6자리 인증번호" required /><ActionButton secondary disabled={busy}>인증번호 확인</ActionButton></form>}
      <ActionButton secondary disabled={busy} onClick={() => action("dns")}>{dns ? "DNS 확인값 다시 발급" : "DNS 확인값 발급"}</ActionButton>
      {dns?.recordValue && <div className="sender-dns"><p>도메인의 DNS에 아래 TXT 레코드를 추가해주세요.</p><dl><dt>이름</dt><dd><code>{dns.recordName}</code></dd><dt>값</dt><dd><code>{dns.recordValue}</code></dd></dl><p>상태: {dns.status === "verified" ? "확인됨" : "확인 대기"} · 확인값 만료 {when(dns.expiresAt)}</p>{dns.status === "pending" && <ActionButton secondary disabled={busy} onClick={() => action("check")}>DNS 확인</ActionButton>}</div>}
    </> : <><p>문자 공급자 계정에 등록한 번호의 인증 상태를 확인합니다.</p><ActionButton secondary disabled={busy} onClick={() => action("check")}>공급자 인증 확인</ActionButton></>}</section>}
    {canWrite && r.status !== "deleted" && <div className="sender-actions">{r.eligible && !r.isDefault && <ActionButton secondary disabled={busy} onClick={() => action("default")}>대표로 설정</ActionButton>}<ActionButton secondary disabled={busy} onClick={() => { setError(""); setConfirm("renew"); }}>재인증 시작</ActionButton>{r.status !== "disabled" && <ActionButton secondary disabled={busy} onClick={() => { setError(""); setConfirm("disable"); }}>사용 중지</ActionButton>}<ActionButton secondary disabled={busy} onClick={() => { setError(""); setConfirm("delete"); }}>발신자 삭제</ActionButton></div>}
    {r.channel === "sms" && r.status !== "deleted" && <SenderEvidence record={r} canWrite={canWrite} onChanged={changed} />}
    {error && <p role="alert">{error}</p>}<p role="status">{message}</p><h3>변경 이력 (최근 100건)</h3><ol className="sender-history">{r.events?.map(e => <li key={e.version}>{senderEventLabels[e.kind] ?? e.kind}<small>v{e.version} · {when(e.createdAt)}</small></li>)}</ol>
  </div>}</Modal>;
}
function SenderEvidence({ record: r, canWrite, onChanged }: { record: SenderRecord; canWrite: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [progress, setProgress] = useState("");
  const pending = useRef<{ key: string; signature: string; file?: FileInfo } | null>(null);
  async function upload(file: File) {
    if (busy) return; setBusy(true); setError(""); setProgress("파일을 준비하고 있습니다.");
    try { if (!file.size || file.size > 10485760 || !["application/pdf", "image/png", "image/jpeg"].includes(file.type)) throw new Error("10MB 이하의 PDF·PNG·JPEG 파일을 선택해주세요.");
      const bytes = await file.arrayBuffer(), sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(b => b.toString(16).padStart(2, "0")).join("");
      const signature = r.id + ":" + r.version + ":" + file.name + ":" + sha256;
      if (pending.current?.signature !== signature) pending.current = { key: crypto.randomUUID(), signature };
      const item = pending.current; item.file ??= await api<FileInfo>("/senders/" + r.id + "/evidence", { method: "POST", headers: { "Idempotency-Key": item.key }, body: JSON.stringify({ version: r.version, name: file.name, size: file.size, mime: file.type, sha256 }) });
      setProgress("파일을 업로드하고 검사합니다.");
      const response = await fetch("/api/v1/uploads/" + item.file.id + "/content", { method: "PUT", headers: { "Content-Type": file.type }, body: bytes }); if (!response.ok) throw new Error((await response.json()).error.message);
      await api("/uploads/" + item.file.id + "/complete", { method: "POST" });
      await api("/senders/" + r.id + "/evidence/" + item.file.id + "/attach", { method: "POST", body: JSON.stringify({ version: r.version }) });
      pending.current = null; setProgress("검사를 통과한 증빙을 첨부했습니다."); onChanged();
    } catch (e) { setError(errorText(e)); setProgress(""); } finally { setBusy(false); }
  }
  async function remove(file: FileInfo | NonNullable<SenderRecord["evidence"]>[number]) {
    if (busy) return; setBusy(true); setError(""); try { const result = await api<{ cleanupPending: boolean }>("/senders/" + r.id + "/evidence/" + file.id, { method: "DELETE", body: JSON.stringify({ version: r.version }) }); setProgress(result.cleanupPending ? "파일 삭제를 다시 처리 중입니다." : "증빙 원문을 삭제했습니다."); onChanged(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function attach(fileId: string) {
    if (busy) return; setBusy(true); setError("");
    try { await api("/senders/" + r.id + "/evidence/" + fileId + "/attach", { method: "POST", body: JSON.stringify({ version: r.version }) }); setProgress("검사를 통과한 증빙을 첨부했습니다."); onChanged(); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <section className="sender-fields"><h3>증빙 파일</h3>{canWrite && <label>증빙 첨부 (최대 5개, 각 10MB)<input type="file" aria-label="발신번호 증빙 파일" accept=".pdf,.png,.jpg,.jpeg" disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} /></label>}
    {!r.evidence?.length && <p>첨부된 증빙이 없습니다.</p>}<ul className="sender-files">{r.evidence?.map(f => <li key={f.id}><span>{f.name}<small>{f.status === "attached" ? "검사 완료" : f.status === "ready" ? "연결 대기" : "업로드 대기"} · {f.size.toLocaleString()} bytes</small></span><div className="sender-actions">{f.status === "attached" && canWrite && <a className="cs-link" href={"/api/v1/senders/" + r.id + "/evidence/" + f.id + "/download"}>다운로드</a>}{f.status === "ready" && canWrite && <button className="cs-link" disabled={busy} onClick={() => attach(f.id)}>첨부 완료</button>}{canWrite && <button className="cs-link" disabled={busy} onClick={() => remove(f)}>파일 삭제</button>}</div></li>)}</ul>{error && <p role="alert">{error}</p>}<p role="status">{progress}</p></section>;
}
