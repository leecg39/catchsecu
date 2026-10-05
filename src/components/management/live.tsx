"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError, useResource, errorText } from "@/lib/api";
import { useApplication } from "../ApplicationContext";
import { ActionButton, Modal, PageHeading, Panel } from "../shared";
import { useConfirm } from "../ux/confirm";
import { useUnsavedChanges } from "../ux/navigation-guard";
type Service = { id: string; name: string; externalName: string; description: string; type: string; status: string; version: number; createdAt: string };
type Company = { id: string; name: string; publicName: string; address: string; phone: string; website: string; businessNo: string; billingEmail: string; billingContactName: string; billingContactPhone: string; version: number;
  closureRequestedAt: string | null; closureReason?: string | null; businessFile?: { id: string; name: string; size: number } | null };
type Profile = { id: string; name: string; email: string; phone: string; department: string; jobTitle: string | null; locale: string; version: number; twoFactorEnabled: boolean };
function ErrorNote({ error }: { error?: string }) { return error ? <p className="auth-error" role="alert">{error}</p> : null; }
export function LiveServices() {
  const app = useApplication(), canManage = app.data?.capabilities.includes("service.manage");
  const [query, setQuery] = useState(""), [search, setSearch] = useState(""), [page, setPage] = useState(1);
  const [status, setStatus] = useState("active"), [archive, setArchive] = useState<Service>();
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const result = useResource<{ items: Service[]; total: number; page: number; pageSize: number }>("/services?page=" + page + "&search=" + encodeURIComponent(query) + "&status=" + status);
  return <><PageHeading title="서비스 관리">{canManage && <Link className="cs-button" href="/set/service/modification">서비스 생성</Link>}</PageHeading>
    <Panel><form className="mg-flex mg-search" onSubmit={e => { e.preventDefault(); setQuery(search); setPage(1); }}>
      <input className="cs-input" aria-label="서비스명 검색" placeholder="서비스명 검색" value={search} onChange={e => setSearch(e.target.value)} />
      <select className="cs-input" aria-label="서비스 상태" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="active">운영 중</option><option value="archived">보관</option><option value="all">전체</option></select><ActionButton secondary>검색</ActionButton></form>
      <ErrorNote error={result.error?.message || error} />{result.loading ? <p role="status">서비스를 불러오는 중입니다.</p> :
      <><div className="cs-table-wrap"><table className="cs-table"><thead><tr>{["서비스 명", "외부 공개 서비스 명", "유형", "소개", "상태", "관리"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
        {result.data?.items.map(service => <tr key={service.id}><td>{service.name}</td><td>{service.externalName}</td><td>{service.type}</td><td>{service.description || "-"}</td><td>{service.status === "active" ? "운영 중" : "보관"}</td><td>{canManage && <div className="mg-flex"><Link className="cs-link" href={"/set/service/modification?id=" + service.id}>수정</Link>{service.status === "active" ? <><Link href={"/set/service/consent?serviceId=" + service.id}>동의서 표시</Link><button onClick={() => setArchive(service)}>보관</button></> : <button disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await api("/services/" + service.id, { method: "PATCH", body: JSON.stringify({ version: service.version, status: "active" }) }); result.reload(); app.reload(); } catch (error) { setError(errorText(error)); } finally { setBusy(false); } }}>복원</button>}</div>}</td></tr>)}
        {!result.error && !result.data?.items.length && <tr><td colSpan={6}>등록된 서비스가 없습니다.</td></tr>}</tbody></table></div>
        <div className="cs-pagination"><span>총 {result.data?.total ?? 0}개</span><div><button disabled={page === 1} onClick={() => setPage(page - 1)}>이전</button><span>{page} 페이지</span><button disabled={page * 20 >= (result.data?.total ?? 0)} onClick={() => setPage(page + 1)}>다음</button></div></div></>}
    </Panel>{archive && <Modal title="서비스 보관" onClose={() => { if (!busy) setArchive(undefined); }}><p>“{archive.name}” 서비스를 보관하시겠습니까? 연결된 업무 데이터가 있는 서비스는 보관할 수 없습니다.</p><ErrorNote error={error} />
      <ActionButton disabled={busy} onClick={async () => { setBusy(true); setError(""); try {
        await api("/services/" + archive.id, { method: "DELETE", headers: { "If-Match": String(archive.version) } });
        setArchive(undefined); result.reload(); app.reload();
      } catch (error) { setError(errorText(error)); } finally { setBusy(false); } }}>보관</ActionButton></Modal>}</>;
}
const blankService = { name: "", externalName: "", description: "", type: "website" };
function ServiceForm({ initial }: { initial?: Service }) {
  const [data, setData] = useState(initial ?? blankService), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useUnsavedChanges(JSON.stringify(data) !== JSON.stringify(initial ?? blankService));
  const app = useApplication(), router = useRouter();
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const payload = { name: data.name, externalName: data.externalName, description: data.description, type: data.type,
        ...(initial ? { version: initial.version } : {}) };
      await api("/services" + (initial ? "/" + initial.id : ""), { method: initial ? "PATCH" : "POST", body: JSON.stringify(payload) });
      app.reload(); router.push("/set/service");
    } catch (error) { setError(errorText(error)); } finally { setBusy(false); }
  }
  return <form className="mg-fields" onSubmit={submit}>
    {([["name", "서비스 명"], ["externalName", "외부 공개 서비스 명"], ["description", "한줄 소개"]] as const).map(([key, label]) => <label key={key}><span>{label}</span><input className="cs-input" value={data[key]} required={key !== "description"} maxLength={key === "description" ? 1000 : 100} onChange={e => setData({ ...data, [key]: e.target.value })} /></label>)}
    <label><span>서비스 유형</span><select className="cs-input" value={data.type} onChange={e => setData({ ...data, type: e.target.value })}>{[["website", "웹사이트"], ["app", "앱"], ["offline", "오프라인"], ["other", "기타"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <ErrorNote error={error} /><div className="mg-flex"><Link className="cs-button secondary" href="/set/service">취소</Link><ActionButton disabled={busy}>{busy ? "저장 중…" : "저장"}</ActionButton></div></form>;
}
export function LiveServiceEditor() {
  const id = useSearchParams().get("id"), result = useResource<Service>(id ? "/services/" + id : null);
  return <div className="mg-narrow"><PageHeading title={id ? "서비스 정보 수정" : "서비스 생성"} /><Panel>
    <ErrorNote error={result.error?.message} />{result.loading ? <p>불러오는 중…</p> : !result.error && <ServiceForm key={id ?? "new"} initial={result.data} />}</Panel></div>;
}
const companyFields = [["name", "회사명"], ["publicName", "외부 공개 회사명"], ["address", "주소"], ["phone", "연락처"], ["website", "홈페이지"], ["businessNo", "사업자등록번호"], ["billingEmail", "세금계산서 이메일"], ["billingContactName", "세금계산서 담당자"], ["billingContactPhone", "담당자 연락처"]] as const;
function CompanyForm({ initial, onboarding = false }: { initial?: Company; onboarding?: boolean }) {
  const [data, setData] = useState(initial ?? { name: "", publicName: "", address: "", phone: "", website: "", businessNo: "", billingEmail: "", billingContactName: "", billingContactPhone: "" });
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), router = useRouter(), app = useApplication();
  const [original] = useState(data);
  useUnsavedChanges(JSON.stringify(data) !== JSON.stringify(original));
  return <form className="mg-fields" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const payload = Object.fromEntries(companyFields.map(([key]) => [key, data[key]]));
      await api("/companies" + (initial ? "/" + initial.id : ""), { method: initial ? "PATCH" : "POST", body: JSON.stringify({ ...payload, ...(initial ? { version: initial.version } : {}) }) });
      app.reload(); router.push("/set/company"); router.refresh();
    } catch (error) { setError(errorText(error)); } finally { setBusy(false); }
  }}>{companyFields.map(([key, label]) => <label key={key}><span>{label}</span><input className="cs-input" value={data[key]} type={key === "billingEmail" ? "email" : key === "website" ? "url" : "text"} required={key === "name" || key === "publicName"} onChange={event => setData({ ...data, [key]: event.target.value })} /></label>)}
    {onboarding && <p>사업자등록증은 회사 등록 후 회사 기본 정보에서 첨부할 수 있습니다.</p>}<ErrorNote error={error} /><ActionButton disabled={busy}>{busy ? "저장 중…" : onboarding ? "회사 등록" : "저장"}</ActionButton></form>;
}
function CompanyBusinessFile({ company, reload }: { company: Company; reload: () => void }) {
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [remove, setRemove] = useState(false);
  return <Panel title="사업자등록증"><ErrorNote error={error} />{company.businessFile ? <div className="mg-flex"><a className="cs-link" href={"/api/v1/companies/" + company.id + "/business-file?fileId=" + company.businessFile.id}>{company.businessFile.name}</a><span>{Math.ceil(company.businessFile.size / 1024)} KB</span><ActionButton secondary disabled={busy} onClick={() => setRemove(true)}>첨부 삭제</ActionButton></div> : <p>첨부된 사업자등록증이 없습니다.</p>}
    <label className="mg-fields"><span>{busy ? "처리 중…" : company.businessFile ? "사업자등록증 교체" : "사업자등록증 첨부"}</span><input aria-label="사업자등록증 첨부" type="file" accept=".pdf,.png,.jpg,.jpeg" disabled={busy} onChange={async event => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return;
      setBusy(true); setError("");
      try {
        if (file.size < 1 || file.size > 10 * 1024 * 1024) throw new Error("파일은 1바이트 이상, 10MB 이하로 첨부해주세요.");
        await api("/companies/" + company.id + "/business-file?" + new URLSearchParams({ name: file.name, size: String(file.size) }), { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream", "If-Match": String(company.version) }, body: file });
        reload();
      } catch (error) { setError(errorText(error)); } finally { setBusy(false); }
    }} /></label><small>PDF, PNG, JPG · 최대 10MB · 안전성 검사 후 저장됩니다.</small>
    {remove && <Modal title="사업자등록증 삭제" onClose={() => { if (!busy) setRemove(false); }}><p>첨부된 사업자등록증을 삭제하시겠습니까?</p><ErrorNote error={error} /><ActionButton disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await api("/companies/" + company.id + "/business-file", { method: "DELETE", headers: { "If-Match": String(company.version) } }); setRemove(false); reload(); } catch (error) { setError(errorText(error)); reload(); } finally { setBusy(false); } }}>삭제</ActionButton></Modal>}
  </Panel>;
}
function CompanyClosure({ company, reload }: { company: Company; reload: () => void }) {
  const app = useApplication(), owner = app.data?.company?.role === "owner";
  const [open, setOpen] = useState(false), [confirmation, setConfirmation] = useState(""), [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <Panel title="회사 폐쇄 요청"><ErrorNote error={error} />{company.closureRequestedAt ? <><p>폐쇄 요청 접수: {new Date(company.closureRequestedAt).toLocaleString("ko-KR")}</p><p>{company.closureReason}</p><p>청구·자산·보존 자료 확인을 거쳐 폐쇄가 진행됩니다.</p>{owner && <ActionButton secondary disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await api("/companies/" + company.id + "/closure", { method: "POST", body: JSON.stringify({ version: company.version, action: "cancel" }) }); reload(); } catch (error) { setError(errorText(error)); } finally { setBusy(false); } }}>폐쇄 요청 취소</ActionButton>}</> : <><p>회사 소유자가 폐쇄를 요청할 수 있습니다. 접수 후 청구·자산·보존 자료를 확인합니다.</p>{owner && <ActionButton secondary onClick={() => setOpen(true)}>폐쇄 요청</ActionButton>}</>}
    {open && <Modal title="회사 폐쇄 요청" onClose={() => { if (!busy) setOpen(false); }}><form className="mg-fields" onSubmit={async event => { event.preventDefault(); setBusy(true); setError(""); try { await api("/companies/" + company.id, { method: "DELETE", body: JSON.stringify({ version: company.version, confirmation, reason }) }); setOpen(false); reload(); } catch (error) { setError(errorText(error)); } finally { setBusy(false); } }}><p>“{company.name}” 회사의 폐쇄를 요청합니다.</p><label><span>회사명 확인</span><input className="cs-input" value={confirmation} required maxLength={100} onChange={event => setConfirmation(event.target.value)} /></label><label><span>폐쇄 사유</span><textarea className="cs-input" value={reason} required maxLength={1000} onChange={event => setReason(event.target.value)} /></label><ErrorNote error={error} /><ActionButton disabled={busy}>{busy ? "접수 중…" : "요청 접수"}</ActionButton></form></Modal>}
  </Panel>;
}
export function LiveCompany({ edit = false }: { edit?: boolean }) {
  const app = useApplication(), result = useResource<Company>(app.data?.company ? "/companies/" + app.data.company.id : null);
  return <div className="mg-narrow"><PageHeading title={edit ? "회사 정보 수정" : "회사 기본 정보"}>{!edit && app.data?.capabilities.includes("company.manage") && <Link className="cs-button" href="/set/company/edit">수정</Link>}</PageHeading><Panel>
    <ErrorNote error={result.error?.message} />{result.loading ? <p>회사 정보를 불러오는 중입니다.</p> : result.data && (edit ? <CompanyForm key={result.data.id} initial={result.data} /> :
      <div className="mg-info-grid">{companyFields.map(([key, label]) => <label key={key}><span>{label}</span><strong>{result.data?.[key] || "-"}</strong></label>)}</div>)}</Panel>{!edit && result.data && app.data?.capabilities.includes("company.manage") && <><CompanyBusinessFile company={result.data} reload={result.reload} /><CompanyClosure company={result.data} reload={result.reload} /></>}</div>;
}
export function CompanyOnboarding() {
  const app = useApplication();
  return <div className="mg-narrow"><PageHeading title="회사 등록" /><Panel>{app.data?.company && <p>현재 회사: {app.data.company.name}. 새 회사를 등록하면 새 회사로 전환됩니다.</p>}<CompanyForm onboarding /></Panel></div>;
}
function ProfileForm({ initial }: { initial: Profile }) {
  const [data, setData] = useState(initial), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false), [original, setOriginal] = useState(initial);
  useUnsavedChanges(JSON.stringify(data) !== JSON.stringify(original));
  const lock = useRef(false);
  const app = useApplication(), router = useRouter();
  async function reloadProfile() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { const latest = await api<Profile>("/me"); setData(latest); setOriginal(latest); setConflict(false); }
    catch (cause) { setError(errorText(cause)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <form className="mg-fields" onSubmit={async event => {
    event.preventDefault(); if (lock.current || conflict) return; lock.current = true; setBusy(true); setError("");
    try {
      await api("/me", { method: "PATCH", body: JSON.stringify({ version: data.version, name: data.name, department: data.department ?? "", jobTitle: data.jobTitle ?? "", phone: data.phone ?? "", locale: data.locale }) });
      app.reload(); router.push("/my-page/info");
    } catch (error) { setError(errorText(error)); if (error instanceof ApiError && error.code === "VERSION_CONFLICT") setConflict(true); } finally { lock.current = false; setBusy(false); }
  }}><label><span>회사명</span><input className="cs-input" disabled value={app.data?.company?.name ?? "소속 회사 없음"} /></label>
    {([["name", "이름"], ["department", "부서명"], ["jobTitle", "직책"], ["phone", "연락처"]] as const).map(([key, label]) => <label key={key}><span>{label}</span><input className="cs-input" disabled={busy} maxLength={key === "phone" ? 30 : 100} required={key === "name"} value={data[key] ?? ""} onChange={event => setData({ ...data, [key]: event.target.value })} /></label>)}
    <label><span>이메일</span><input className="cs-input" disabled value={data.email} /></label>
    <label><span>언어</span><select className="cs-input" disabled={busy} value={data.locale} onChange={event => setData({ ...data, locale: event.target.value })}><option value="ko">한국어</option><option value="en">English</option><option value="ja">日本語</option></select></label>
    <ErrorNote error={error} />{conflict && <div><p>다른 곳에서 변경한 프로필을 불러오면 아직 저장하지 않은 입력이 최신 정보로 바뀝니다.</p>
      <ActionButton type="button" secondary disabled={busy} onClick={reloadProfile}>최신 프로필 다시 불러오기</ActionButton></div>}
    <div className="mg-flex"><Link className="cs-link" href="/my-page/delete">회원탈퇴</Link><ActionButton disabled={busy || conflict}>{busy ? "저장 중…" : "저장"}</ActionButton></div></form>;
}
function Sessions() {
  const result = useResource<{ items: { id: string; current: boolean; userAgent: string | null; updatedAt: string }[] }>("/me/sessions");
  const [error, setError] = useState(""), [busy, setBusy] = useState("");
  const ask = useConfirm();
  return <Panel title="로그인한 기기"><ErrorNote error={result.error?.message || error} />{result.data?.items.map(session => <div className="mg-toolbar" key={session.id}><div><strong>{session.current ? "현재 기기" : "다른 기기"}</strong><p>{session.userAgent || "기기 정보 없음"}</p><small>{new Date(session.updatedAt).toLocaleString("ko-KR")}</small></div>
    {!session.current && <ActionButton secondary disabled={!!busy} onClick={async () => { if (!await ask({ title: "다른 기기 로그인 해제", message: "선택한 기기의 로그인을 해제합니다. 그 기기에서 작성 중인 내용은 저장되지 않을 수 있습니다.", confirmLabel: "로그인 해제" })) return; setBusy(session.id); setError(""); try { await api("/me/sessions/" + session.id, { method: "DELETE" }); result.reload(); } catch (error) { setError(errorText(error)); } finally { setBusy(""); } }}>로그인 해제</ActionButton>}</div>)}</Panel>;
}
export function LiveProfile({ edit = false }: { edit?: boolean }) {
  const app = useApplication();
  const result = useResource<Profile>("/me");
  return <div className="mg-narrow"><PageHeading title={edit ? "프로필 편집" : "프로필"}>{!edit && <div className="mg-flex"><Link className="cs-button secondary" href="/my-page/activity-log">나의 활동 로그</Link><Link className="cs-button secondary" href="/my-page/info-activity-log">개인정보 활동 검토 이력</Link><Link className="cs-button" href="/my-page/info/edit">편집</Link></div>}</PageHeading><Panel>
    <ErrorNote error={result.error?.message} />{!result.data ? <p>프로필을 불러오는 중입니다.</p> : edit ? <ProfileForm key={result.data.version} initial={result.data} /> : <div className="mg-info-grid">
      <label><span>회사명</span><strong>{app.data?.company?.name ?? "소속 회사 없음"}</strong></label>
      {([["name", "이름"], ["email", "이메일"], ["department", "부서명"], ["jobTitle", "직책"], ["phone", "연락처"]] as const).map(([key, label]) => <label key={key}><span>{label}</span><strong>{result.data?.[key] || "-"}</strong></label>)}</div>}</Panel>
    {!edit && <><Panel title="로그인 보안"><div className="mg-flex"><Link className="cs-button secondary" href="/password-change-rule">비밀번호 변경</Link><Link className="cs-button secondary" href="/two-step-setting">2단계 인증 {result.data?.twoFactorEnabled ? "관리" : "등록"}</Link></div></Panel><Sessions /></>}</div>;
}
