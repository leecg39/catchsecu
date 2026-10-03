"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, useResource, errorText } from "@/lib/api";
import { useApplication } from "../ApplicationContext";
import { ActionButton, Modal, PageHeading, Panel } from "../shared";
type Service = { id: string; name: string; externalName: string; description: string; type: string; status: string; version: number; createdAt: string };
type Company = { id: string; name: string; publicName: string; address: string; phone: string; website: string; businessNo: string; billingEmail: string; version: number };
type Profile = { id: string; name: string; email: string; phone: string; department: string; locale: string; version: number; twoFactorEnabled: boolean };
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
        {result.data?.items.map(service => <tr key={service.id}><td>{service.name}</td><td>{service.externalName}</td><td>{service.type}</td><td>{service.description || "-"}</td><td>{service.status === "active" ? "운영 중" : "보관"}</td><td>{canManage && <div className="mg-flex"><Link className="cs-link" href={"/set/service/modification?id=" + service.id}>수정</Link>{service.status === "active" && <><Link href={"/set/service/consent?serviceId=" + service.id}>동의서 표시</Link><button onClick={() => setArchive(service)}>보관</button></>}</div>}</td></tr>)}
        {!result.error && !result.data?.items.length && <tr><td colSpan={6}>등록된 서비스가 없습니다.</td></tr>}</tbody></table></div>
        <div className="cs-pagination"><span>총 {result.data?.total ?? 0}개</span><div><button disabled={page === 1} onClick={() => setPage(page - 1)}>이전</button><span>{page} 페이지</span><button disabled={page * 20 >= (result.data?.total ?? 0)} onClick={() => setPage(page + 1)}>다음</button></div></div></>}
    </Panel>{archive && <Modal title="서비스 보관" onClose={() => { if (!busy) setArchive(undefined); }}><p>“{archive.name}” 서비스를 보관하시겠습니까? 연결된 기록은 유지됩니다.</p>
      <ActionButton disabled={busy} onClick={async () => { setBusy(true); setError(""); try {
        await api("/services/" + archive.id, { method: "DELETE", headers: { "If-Match": String(archive.version) } });
        setArchive(undefined); result.reload(); app.reload();
      } catch (error) { setError(errorText(error)); } finally { setBusy(false); } }}>보관</ActionButton></Modal>}</>;
}
const blankService = { name: "", externalName: "", description: "", type: "website" };
function ServiceForm({ initial }: { initial?: Service }) {
  const [data, setData] = useState(initial ?? blankService), [error, setError] = useState(""), [busy, setBusy] = useState(false);
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
const companyFields = [["name", "회사명"], ["publicName", "외부 공개 회사명"], ["address", "주소"], ["phone", "연락처"], ["website", "홈페이지"], ["businessNo", "사업자등록번호"], ["billingEmail", "세금계산서 이메일"]] as const;
function CompanyForm({ initial, onboarding = false }: { initial?: Company; onboarding?: boolean }) {
  const [data, setData] = useState(initial ?? { name: "", publicName: "", address: "", phone: "", website: "", businessNo: "", billingEmail: "" });
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), router = useRouter(), app = useApplication();
  return <form className="mg-fields" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const payload = Object.fromEntries(companyFields.map(([key]) => [key, data[key]]));
      await api("/companies" + (initial ? "/" + initial.id : ""), { method: initial ? "PATCH" : "POST", body: JSON.stringify({ ...payload, ...(initial ? { version: initial.version } : {}) }) });
      app.reload(); router.push(onboarding ? "/dashboard" : "/set/company"); router.refresh();
    } catch (error) { setError(errorText(error)); } finally { setBusy(false); }
  }}>{companyFields.map(([key, label]) => <label key={key}><span>{label}</span><input className="cs-input" value={data[key]} type={key === "billingEmail" ? "email" : key === "website" ? "url" : "text"} required={key === "name" || key === "publicName"} onChange={event => setData({ ...data, [key]: event.target.value })} /></label>)}
    <ErrorNote error={error} /><ActionButton disabled={busy}>{busy ? "저장 중…" : onboarding ? "회사 등록" : "저장"}</ActionButton></form>;
}
export function LiveCompany({ edit = false }: { edit?: boolean }) {
  const app = useApplication(), result = useResource<Company>(app.data?.company ? "/companies/" + app.data.company.id : null);
  return <div className="mg-narrow"><PageHeading title={edit ? "회사 정보 수정" : "회사 기본 정보"}>{!edit && app.data?.capabilities.includes("company.manage") && <Link className="cs-button" href="/set/company/edit">수정</Link>}</PageHeading><Panel>
    <ErrorNote error={result.error?.message} />{!result.data ? <p>회사 정보를 불러오는 중입니다.</p> : edit ? <CompanyForm initial={result.data} /> :
      <div className="mg-info-grid">{companyFields.map(([key, label]) => <label key={key}><span>{label}</span><strong>{result.data?.[key] || "-"}</strong></label>)}</div>}</Panel></div>;
}
export function CompanyOnboarding() {
  const app = useApplication();
  return <div className="mg-narrow"><PageHeading title="회사 등록" /><Panel>{app.data?.company ? <><p>현재 회사: {app.data.company.name}</p><Link className="cs-button" href="/dashboard">대시보드로 이동</Link></> : <CompanyForm onboarding />}</Panel></div>;
}
function ProfileForm({ initial }: { initial: Profile }) {
  const [data, setData] = useState(initial), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const app = useApplication(), router = useRouter();
  return <form className="mg-fields" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await api("/me", { method: "PATCH", body: JSON.stringify({ version: initial.version, name: data.name, department: data.department ?? "", phone: data.phone ?? "", locale: data.locale }) });
      app.reload(); router.push("/my-page/info");
    } catch (error) { setError(errorText(error)); } finally { setBusy(false); }
  }}>{([["name", "이름"], ["department", "부서명"], ["phone", "연락처"]] as const).map(([key, label]) => <label key={key}><span>{label}</span><input className="cs-input" required={key === "name"} value={data[key] ?? ""} onChange={event => setData({ ...data, [key]: event.target.value })} /></label>)}
    <label><span>이메일</span><input className="cs-input" disabled value={data.email} /></label><ErrorNote error={error} /><ActionButton disabled={busy}>{busy ? "저장 중…" : "저장"}</ActionButton></form>;
}
function Sessions() {
  const result = useResource<{ items: { id: string; current: boolean; userAgent: string | null; updatedAt: string }[] }>("/me/sessions");
  const [error, setError] = useState(""), [busy, setBusy] = useState("");
  return <Panel title="로그인한 기기"><ErrorNote error={result.error?.message || error} />{result.data?.items.map(session => <div className="mg-toolbar" key={session.id}><div><strong>{session.current ? "현재 기기" : "다른 기기"}</strong><p>{session.userAgent || "기기 정보 없음"}</p><small>{new Date(session.updatedAt).toLocaleString("ko-KR")}</small></div>
    {!session.current && <ActionButton secondary disabled={!!busy} onClick={async () => { setBusy(session.id); setError(""); try { await api("/me/sessions/" + session.id, { method: "DELETE" }); result.reload(); } catch (error) { setError(errorText(error)); } finally { setBusy(""); } }}>로그인 해제</ActionButton>}</div>)}</Panel>;
}
export function LiveProfile({ edit = false }: { edit?: boolean }) {
  const result = useResource<Profile>("/me");
  return <div className="mg-narrow"><PageHeading title={edit ? "프로필 편집" : "프로필"}>{!edit && <Link className="cs-button" href="/my-page/info/edit">편집</Link>}</PageHeading><Panel>
    <ErrorNote error={result.error?.message} />{!result.data ? <p>프로필을 불러오는 중입니다.</p> : edit ? <ProfileForm initial={result.data} /> : <div className="mg-info-grid">
      {([["name", "이름"], ["email", "이메일"], ["department", "부서명"], ["phone", "연락처"]] as const).map(([key, label]) => <label key={key}><span>{label}</span><strong>{result.data?.[key] || "-"}</strong></label>)}</div>}</Panel>
    {!edit && <><Panel title="로그인 보안"><div className="mg-flex"><Link className="cs-button secondary" href="/password-change-rule">비밀번호 변경</Link><Link className="cs-button secondary" href="/two-step-setting">2단계 인증 {result.data?.twoFactorEnabled ? "관리" : "등록"}</Link></div></Panel><Sessions /></>}</div>;
}
